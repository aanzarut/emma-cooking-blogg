import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Reads a photographed or scanned recipe and returns structured fields.
 *
 * Entirely optional: with no ANTHROPIC_API_KEY set, `isAvailable()` returns
 * false and the Studio simply hides the "Read this recipe" button. Everything
 * else in the app works the same, typed in by hand.
 */

export const DEFAULT_MODEL = process.env.RECIPE_MODEL || 'claude-opus-5';

export function isAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const RECIPE_TOOL = {
  name: 'save_recipe',
  description: 'Record every field you can read from the recipe images.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title', 'summary', 'sourceAuthor', 'sourcePublication', 'sourceYear',
      'servings', 'prepTime', 'cookTime', 'totalTime', 'difficulty',
      'foodTypes', 'cuisines', 'courses', 'tags', 'ingredients', 'steps',
      'handwrittenNotes', 'unreadable',
    ],
    properties: {
      title: { type: 'string', description: 'Recipe name exactly as written. Empty string if none is visible.' },
      summary: { type: 'string', description: 'One sentence describing the dish. Write it yourself if the card has none.' },
      sourceAuthor: { type: 'string', description: 'Who the recipe is credited to, e.g. "Aunt Marie" or "Julia Child". Empty if not stated.' },
      sourcePublication: { type: 'string', description: 'Cookbook, magazine, or website named on the card. Empty if none.' },
      sourceYear: { type: 'string', description: 'Year written on the card, or empty.' },
      servings: { type: 'string', description: 'e.g. "Serves 6", "12 cookies". Empty if not stated.' },
      prepTime: { type: 'string' },
      cookTime: { type: 'string' },
      totalTime: { type: 'string' },
      difficulty: { type: 'string', enum: ['', 'Easy', 'Medium', 'Involved'] },
      foodTypes: { type: 'array', items: { type: 'string' }, description: 'Dish categories, e.g. ["Dessert","Cake"].' },
      cuisines: { type: 'array', items: { type: 'string' }, description: 'e.g. ["Italian"]. Empty array if unclear.' },
      courses: { type: 'array', items: { type: 'string' }, description: 'e.g. ["Dinner"].' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Short lowercase keywords, e.g. ["make-ahead","holiday"].' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['raw', 'quantity', 'unit', 'name', 'note'],
          properties: {
            raw: { type: 'string', description: 'The whole line exactly as written on the card.' },
            quantity: { type: 'string', description: 'e.g. "2", "1 1/2". Empty if none.' },
            unit: { type: 'string', description: 'e.g. "cup", "tbsp". Empty if none.' },
            name: { type: 'string', description: 'The ingredient itself, singular and lowercase, e.g. "unsalted butter".' },
            note: { type: 'string', description: 'Preparation detail, e.g. "melted", "finely chopped".' },
          },
        },
      },
      steps: { type: 'array', items: { type: 'string' }, description: 'Numbered method, one instruction per entry.' },
      handwrittenNotes: { type: 'string', description: 'Any margin notes, corrections, or personal remarks written on the card, transcribed as-is.' },
      unreadable: {
        type: 'array',
        items: { type: 'string' },
        description: 'Words or lines you could not read with confidence, so a person can check them.',
      },
    },
  },
};

const SYSTEM_PROMPT = `You transcribe photographs of paper recipe cards, handwritten notes, and cookbook pages into structured data.

Rules:
- Transcribe what is actually written. Never invent an ingredient, a quantity, or a step that is not on the page.
- Keep the cook's own wording and measurements. Do not convert units or modernise phrasing.
- If a word is smudged or ambiguous, put your best reading in the field and add the exact uncertain text to "unreadable".
- Several images may be pages or sides of the SAME recipe. Combine them into one result, in reading order.
- Margin notes ("Grandma's trick: chill the bowl") belong in handwrittenNotes, not in the steps.
- Leave a field as an empty string or empty array rather than guessing.`;

/** Downscale before sending: 1600px is plenty for reading text and keeps cost low. */
async function encodeImage(filePath) {
  const buffer = await sharp(filePath)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') },
  };
}

function encodePdf(filePath) {
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: fs.readFileSync(filePath).toString('base64'),
    },
  };
}

/**
 * @param {string[]} files  Absolute paths to images and/or PDFs of one recipe.
 * @returns {Promise<{fields: object, model: string, usage: object}>}
 */
export async function transcribeFiles(files, { model = DEFAULT_MODEL } = {}) {
  if (!isAvailable()) {
    throw new Error('No ANTHROPIC_API_KEY is set, so automatic reading is switched off.');
  }
  if (!files.length) throw new Error('Nothing to read: attach at least one photo or PDF first.');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const content = [];
  for (const file of files.slice(0, 8)) {
    const ext = path.extname(file).toLowerCase();
    content.push(ext === '.pdf' ? encodePdf(file) : await encodeImage(file));
  }
  content.push({
    type: 'text',
    text: 'Transcribe this recipe and call save_recipe with everything you can read.',
  });

  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'save_recipe' },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to read this image. Try a clearer photo, or type it in by hand.');
  }
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'save_recipe');
  if (!call) {
    throw new Error('Could not read a recipe from those images. Try a sharper, better-lit photo.');
  }

  return { fields: call.input, model, usage: response.usage };
}

/** Map the model's output onto the recipe file format, without clobbering good data. */
export function applyTranscription(recipe, fields) {
  const keepIfEmpty = (current, incoming) => (String(current || '').trim() ? current : incoming || '');
  const next = { ...recipe };

  next.title = keepIfEmpty(recipe.title === 'Untitled recipe' ? '' : recipe.title, fields.title) || recipe.title;
  next.summary = keepIfEmpty(recipe.summary, fields.summary);
  next.servings = keepIfEmpty(recipe.servings, fields.servings);
  next.difficulty = keepIfEmpty(recipe.difficulty, fields.difficulty);
  next.source = {
    ...recipe.source,
    author: keepIfEmpty(recipe.source?.author, fields.sourceAuthor),
    publication: keepIfEmpty(recipe.source?.publication, fields.sourcePublication),
    year: keepIfEmpty(recipe.source?.year, fields.sourceYear),
  };
  next.times = {
    prep: keepIfEmpty(recipe.times?.prep, fields.prepTime),
    cook: keepIfEmpty(recipe.times?.cook, fields.cookTime),
    total: keepIfEmpty(recipe.times?.total, fields.totalTime),
  };

  const mergeList = (current, incoming) =>
    current?.length ? current : [...new Set((incoming || []).filter(Boolean))];
  next.foodTypes = mergeList(recipe.foodTypes, fields.foodTypes);
  next.cuisines = mergeList(recipe.cuisines, fields.cuisines);
  next.courses = mergeList(recipe.courses, fields.courses);
  next.tags = mergeList(recipe.tags, fields.tags);

  if (!recipe.ingredients?.length) next.ingredients = fields.ingredients || [];
  if (!recipe.steps?.length) next.steps = fields.steps || [];

  const notes = [fields.handwrittenNotes, (fields.unreadable || []).length
    ? `Words the reader was unsure about: ${fields.unreadable.join(', ')}`
    : '']
    .filter(Boolean)
    .join('\n\n');
  next.notes = recipe.notes?.trim() ? recipe.notes : notes;

  next.status = recipe.status === 'draft' ? 'needs-review' : recipe.status;
  next.transcription = {
    status: 'done',
    model: '',
    at: new Date().toISOString(),
    confidence: (fields.unreadable || []).length ? 'check-marked-words' : 'clean',
  };
  return next;
}
