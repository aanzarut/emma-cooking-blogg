/* Recipe Studio — the whole interface, in one file, no build step.
   Plain DOM. If something here needs changing, it can be read top to bottom. */

/* -------------------------------------------------------------- utilities */

const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list' && typeof value !== 'object') {
      // Some properties are read-only on some elements (textarea has no .type).
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

const mount = (target, ...kids) => {
  target.replaceChildren(...kids.flat(Infinity).filter(Boolean));
  return target;
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, bad = false) {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: `toast${bad ? ' bad' : ''}` }, message);
  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), bad ? 6000 : 3000);
}

function confirmBox({ title, message, confirmLabel = 'Yes, do it', danger = false }) {
  return new Promise((resolve) => {
    const close = (answer) => { backdrop.remove(); resolve(answer); };
    const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && close(false) },
      el('div', { class: 'modal' },
        el('header', {}, el('h1', {}, title)),
        el('div', { class: 'body' }, el('p', {}, message)),
        el('footer', {},
          el('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmLabel))));
    document.body.append(backdrop);
  });
}

const STATUS_LABEL = {
  draft: 'Draft',
  'needs-review': 'Needs checking',
  ready: 'Ready',
  published: 'Published',
};

const statusPill = (status) => el('span', { class: `pill ${status}` }, STATUS_LABEL[status] || status);

const debounce = (fn, ms = 200) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

/* ------------------------------------------------------------------ state */

const state = {
  route: 'inbox',
  boot: null,
  recipes: [],
  inbox: [],
  selected: new Set(),
  filters: { text: '', status: '', foodType: '', cuisine: '', tag: '', author: '', ingredient: '' },
  recipe: null,
  photos: [],
  tab: 'recipe',
  dirty: false,
  busy: false,
  editing: null,
};

async function refreshBoot() {
  state.boot = await api('/api/bootstrap');
}

async function go(route, arg) {
  if (state.dirty && state.route === 'recipe' && route !== 'recipe') {
    const ok = await confirmBox({
      title: 'Leave without saving?',
      message: 'This recipe has changes that have not been saved yet.',
      confirmLabel: 'Leave anyway',
      danger: true,
    });
    if (!ok) return;
    state.dirty = false;
  }
  state.route = route;
  if (route === 'recipe') await loadRecipe(arg);
  if (route === 'recipes') state.recipes = (await api('/api/recipes')).recipes;
  if (route === 'inbox') { state.inbox = (await api('/api/inbox')).items; state.selected = new Set(); }
  await refreshBoot();
  render();
}

async function loadRecipe(slug) {
  const data = await api(`/api/recipes/${encodeURIComponent(slug)}`);
  state.recipe = data.recipe;
  state.photos = data.photos;
  state.dirty = false;
  state.tab = state.tab === 'photos' ? 'photos' : 'recipe';
}

/* ------------------------------------------------------------------- rail */

function renderRail() {
  const counts = state.boot?.counts || { total: 0, inbox: 0 };
  const item = (route, icon, label, badge) =>
    el('button', {
      class: 'nav',
      'aria-current': String(state.route === route || (route === 'recipes' && state.route === 'recipe')),
      onclick: () => go(route),
    },
      el('span', { class: 'icon' }, icon),
      el('span', {}, label),
      badge ? el('span', { class: 'badge' }, badge) : null);

  mount(document.getElementById('rail'),
    el('div', { class: 'brand' },
      el('div', { class: 'mark' }, '\u{1F373}'),
      el('div', {}, el('strong', {}, 'Recipe Studio'), el('span', {}, 'Emma’s cooking blog'))),
    item('inbox', '\u{1F4E5}', 'Inbox', counts.inbox || null),
    item('recipes', '\u{1F4D6}', 'Recipes', counts.total || null),
    item('publish', '\u{1F310}', 'Publish'),
    item('help', '❓', 'How to use this'),
    el('div', { class: 'rail-foot' },
      state.boot?.ai?.available ? 'Recipe reading is on.' : 'Recipe reading is off.',
      el('br'),
      'Everything is saved on this computer.'));
}

function topbar(title, subtitle, ...actions) {
  return el('div', { class: 'topbar' },
    el('div', { class: 'grow' },
      el('h1', {}, title),
      subtitle ? el('div', { class: 'sub' }, subtitle) : null),
    ...actions);
}

/* ------------------------------------------------------------------ inbox */

function viewInbox() {
  const items = state.inbox;
  mount(document.getElementById('topbar'),
    topbar('Inbox', items.length
      ? `${items.length} photo${items.length === 1 ? '' : 's'} waiting to be sorted`
      : 'Nothing waiting',
      el('button', { class: 'btn', onclick: showUploadHelp }, '\u{1F4F1} Send from a phone')));

  if (!items.length) {
    return mount(document.getElementById('view'),
      el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('div', { class: 'big' }, '\u{1F4E5}'),
        el('h2', {}, 'The inbox is empty'),
        el('p', {}, 'Send photos from a phone, or drop image files onto this window.'),
        el('button', { class: 'btn primary', onclick: showUploadHelp }, 'Show me how'))));
  }

  const tiles = items.map((item) =>
    el('button', {
      class: 'tile',
      'aria-pressed': String(state.selected.has(item.file)),
      title: item.file,
      onclick: () => {
        state.selected.has(item.file) ? state.selected.delete(item.file) : state.selected.add(item.file);
        render();
      },
    },
      item.kind === 'pdf'
        ? el('div', { class: 'pdf' }, el('div', { style: { fontSize: '30px' } }, '\u{1F4C4}'), 'PDF')
        : el('img', { src: `${item.src}?w=360`, alt: item.file, loading: 'lazy' }),
      el('span', { class: 'tick' }, '✓')));

  mount(document.getElementById('view'),
    el('div', { class: 'panel' },
      el('header', {},
        el('div', { class: 'grow' }, el('h2', {}, 'Tap the photos you want to file')),
        el('button', { class: 'btn small ghost', onclick: () => { state.selected = new Set(items.map((i) => i.file)); render(); } }, 'Select all'),
        el('button', { class: 'btn small ghost', onclick: () => { state.selected = new Set(); render(); } }, 'Clear')),
      el('div', { class: 'body' }, el('div', { class: 'tiles' }, tiles))),
    state.selected.size ? fileActionBar() : null);
}

function fileActionBar() {
  const n = state.selected.size;
  const roleSelect = el('select', { id: 'assign-role' },
    el('option', { value: 'scan' }, 'Picture of the recipe itself'),
    el('option', { value: 'photo' }, 'Photo of the finished dish'));

  const recipeSelect = el('select', { id: 'assign-target' },
    el('option', { value: '' }, '➕ Start a new recipe'),
    ...state.recipes.map((r) => el('option', { value: r.slug }, r.title)));

  const titleInput = el('input', { type: 'text', id: 'assign-title', placeholder: 'Name it (you can change this later)' });
  const titleWrap = el('div', { style: { flex: '1 1 240px' } }, titleInput);
  recipeSelect.addEventListener('change', () => { titleWrap.hidden = Boolean(recipeSelect.value); });

  return el('div', { class: 'actionbar' },
    el('span', { class: 'count' }, `${n} selected`),
    el('span', { style: { color: 'var(--ink-soft)' } }, 'File as'),
    el('div', { style: { flex: '0 1 250px' } }, roleSelect),
    el('span', { style: { color: 'var(--ink-soft)' } }, 'into'),
    el('div', { style: { flex: '0 1 230px' } }, recipeSelect),
    titleWrap,
    el('span', { class: 'grow' }),
    el('button', {
      class: 'btn danger small',
      onclick: async () => {
        const ok = await confirmBox({
          title: `Discard ${n} photo${n === 1 ? '' : 's'}?`,
          message: 'They move to library/inbox/.discarded, so they can still be recovered from the folder.',
          confirmLabel: 'Discard',
          danger: true,
        });
        if (!ok) return;
        await api('/api/inbox/discard', { method: 'POST', body: { files: [...state.selected] } });
        toast('Moved out of the inbox.');
        go('inbox');
      },
    }, 'Discard'),
    el('button', {
      class: 'btn primary',
      onclick: async () => {
        try {
          const result = await api('/api/inbox/assign', {
            method: 'POST',
            body: {
              files: [...state.selected],
              slug: recipeSelect.value || undefined,
              newTitle: titleInput.value,
              role: roleSelect.value,
            },
          });
          toast(`Filed ${n} photo${n === 1 ? '' : 's'}.`);
          state.selected = new Set();
          state.recipes = (await api('/api/recipes')).recipes;
          await go('recipe', result.slug);
        } catch (err) { toast(err.message, true); }
      },
    }, 'File them →'));
}

async function showUploadHelp() {
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && backdrop.remove() },
    el('div', { class: 'modal' },
      el('header', {}, el('h1', {}, 'Send photos from a phone')),
      el('div', { class: 'body' },
        el('p', {}, 'The phone and this computer must be on the same wifi.'),
        el('ol', { style: { paddingLeft: '20px', marginTop: 0 } },
          el('li', {}, 'Open the camera on the phone and point it at this square.'),
          el('li', {}, 'Tap the link that appears.'),
          el('li', {}, 'Choose photos and tap Send.')),
        el('div', { style: { textAlign: 'center', margin: '18px 0' } },
          el('img', { src: '/api/qr', alt: 'QR code', width: 240, height: 240, style: { border: '1px solid var(--line)', borderRadius: '10px' } })),
        el('p', { class: 'hint', style: { textAlign: 'center' } }, 'Or type this address into the phone’s browser:'),
        el('p', { style: { textAlign: 'center', fontWeight: '600' } }, state.boot?.uploadUrl || '')),
      el('footer', {}, el('button', { class: 'btn primary', onclick: () => backdrop.remove() }, 'Done'))));
  document.body.append(backdrop);
}

/* ---------------------------------------------------------------- recipes */

function matchesFilters(r) {
  const f = state.filters;
  if (f.status && r.status !== f.status) return false;
  if (f.foodType && !r.foodTypes.includes(f.foodType)) return false;
  if (f.cuisine && !r.cuisines.includes(f.cuisine)) return false;
  if (f.tag && !r.tags.includes(f.tag)) return false;
  if (f.author && r.author !== f.author) return false;
  if (f.text) {
    const hay = [r.title, r.summary, r.author, ...r.tags, ...r.foodTypes, ...r.cuisines]
      .join(' ')
      .toLowerCase();
    if (!f.text.toLowerCase().split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

function filterRow(label, key, options, labelFor = (value) => value) {
  if (!options.length) return null;
  return el('div', { style: { marginBottom: '12px' } },
    el('h3', { style: { marginBottom: '7px' } }, label),
    el('div', { class: 'chips' },
      options.slice(0, 24).map(({ value, count }) =>
        el('button', {
          class: 'chip',
          'aria-pressed': String(state.filters[key] === value),
          onclick: () => { state.filters[key] = state.filters[key] === value ? '' : value; render(); },
        }, labelFor(value), el('span', { class: 'n' }, count)))));
}

function viewRecipes() {
  const facets = state.boot?.facets || { tags: [], foodTypes: [], cuisines: [], authors: [] };
  const shown = state.recipes.filter(matchesFilters);
  const active = Object.entries(state.filters).filter(([, v]) => v);

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Search by name, ingredient, cook, tag…',
    value: state.filters.text,
    oninput: debounce((e) => { state.filters.text = e.target.value; renderList(); }, 180),
  });

  mount(document.getElementById('topbar'),
    topbar('Recipes', `${shown.length} of ${state.recipes.length} shown`,
      el('div', { class: 'search', style: { width: '340px' } }, el('span', { class: 'icon' }, '\u{1F50D}'), searchInput),
      el('button', { class: 'btn primary', onclick: newRecipe }, '➕ New recipe')));

  const listHost = el('div');

  function renderList() {
    const rows = state.recipes.filter(matchesFilters);
    document.querySelector('.topbar .sub').textContent = `${rows.length} of ${state.recipes.length} shown`;
    mount(listHost, rows.length
      ? el('div', { class: 'grid' }, rows.map(recipeCard))
      : el('div', { class: 'panel' }, el('div', { class: 'empty' },
          el('div', { class: 'big' }, '\u{1F50D}'),
          el('h2', {}, 'Nothing matches'),
          el('p', {}, 'Try clearing a filter or searching for something shorter.'))));
  }

  mount(document.getElementById('view'),
    el('div', { class: 'panel' },
      el('div', { class: 'body' },
        filterRow('Status', 'status', (state.boot?.statuses || []).map((s) => ({
          value: s, count: state.boot.counts.byStatus[s] || 0,
        })).filter((s) => s.count), (value) => STATUS_LABEL[value] || value),
        filterRow('Kind of food', 'foodType', facets.foodTypes),
        filterRow('Cuisine', 'cuisine', facets.cuisines),
        filterRow('Where it came from', 'author', facets.authors),
        filterRow('Tags', 'tag', facets.tags),
        active.length
          ? el('button', { class: 'btn small ghost', onclick: () => {
              state.filters = { text: '', status: '', foodType: '', cuisine: '', tag: '', author: '', ingredient: '' };
              render();
            } }, `✕ Clear ${active.length} filter${active.length === 1 ? '' : 's'}`)
          : el('div', { class: 'hint' }, 'Tap any chip to narrow the list.'))),
    el('div', { style: { height: '18px' } }),
    listHost);

  renderList();
}

function recipeCard(r) {
  const missing = [];
  if (!r.ingredientCount) missing.push('ingredients');
  if (!r.stepCount) missing.push('method');
  if (!r.photoCount) missing.push('a dish photo');

  return el('button', { class: 'card', onclick: () => go('recipe', r.slug) },
    el('div', {
      class: 'thumb',
      style: r.heroSrc ? { backgroundImage: `url("${r.heroSrc}")` } : {},
    }, r.heroSrc ? null : '\u{1F37D}'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, r.title),
      el('div', { class: 'line' }, r.author ? `From ${r.author}` : (r.summary || 'No description yet')),
      el('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
        statusPill(r.status),
        missing.length ? el('span', { class: 'line', style: { fontSize: '12px' } }, `Needs ${missing.join(', ')}`) : null)));
}

async function newRecipe() {
  const data = await api('/api/recipes', { method: 'POST', body: { title: 'Untitled recipe' } });
  state.recipes = (await api('/api/recipes')).recipes;
  await go('recipe', data.recipe.slug);
}

/* ------------------------------------------------------------ recipe form */

function markDirty() {
  state.dirty = true;
  const btn = document.getElementById('save-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
}

function bind(path, { textarea = false, ...attrs } = {}) {
  const value = path.split('.').reduce((acc, key) => acc?.[key], state.recipe) ?? '';
  const node = textarea
    ? el('textarea', { value, ...attrs })
    : el('input', { type: 'text', value, ...attrs });
  node.value = value;
  node.addEventListener('input', () => {
    const keys = path.split('.');
    let target = state.recipe;
    while (keys.length > 1) target = target[keys.shift()];
    target[keys[0]] = node.value;
    markDirty();
  });
  return node;
}

const field = (label, control, hint) =>
  el('label', { class: 'field' }, el('span', {}, label), control, hint ? el('div', { class: 'hint' }, hint) : null);

function viewRecipe() {
  const r = state.recipe;
  const canRead = state.boot?.ai?.available;
  const scans = state.photos.filter((p) => p.role === 'scan');

  mount(document.getElementById('topbar'),
    topbar(r.title, `Last saved ${new Date(r.updatedAt).toLocaleString()}`,
      el('button', { class: 'btn ghost', onclick: () => go('recipes') }, '← All recipes'),
      canRead && scans.length
        ? el('button', { class: 'btn', id: 'read-btn', onclick: runTranscription },
            '✨ Read the recipe card')
        : null,
      el('button', { class: 'btn primary', id: 'save-btn', disabled: !state.dirty, onclick: saveRecipe },
        state.dirty ? 'Save changes' : 'Saved')));

  const tabs = el('div', { class: 'tabs' },
    ...[['recipe', 'Recipe'], ['story', 'Her story'], ['photos', `Photos (${state.photos.length})`], ['filing', 'Filing & tags']]
      .map(([key, label]) =>
        el('button', {
          'aria-selected': String(state.tab === key),
          onclick: () => { state.tab = key; render(); },
        }, label)));

  const body = el('div', { class: 'body' },
    state.tab === 'recipe' ? tabRecipe() :
    state.tab === 'story' ? tabStory() :
    state.tab === 'photos' ? tabPhotos() : tabFiling());

  mount(document.getElementById('view'),
    el('div', { class: 'editor' },
      el('div', {}, el('div', { class: 'panel' }, tabs, body)),
      el('div', {}, sidePanel())));
}

function tabRecipe() {
  const r = state.recipe;
  return el('div', {},
    field('Recipe name', bind('title', { placeholder: 'Grandma’s apple cake' })),
    field('One-line description', bind('summary', { placeholder: 'A soft, buttery cake that uses up windfall apples.' })),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0 14px' } },
      field('Serves', bind('servings', { placeholder: '8' })),
      field('Prep time', bind('times.prep', { placeholder: '20 min' })),
      field('Cook time', bind('times.cook', { placeholder: '45 min' })),
      field('Total time', bind('times.total', { placeholder: '1 hr 5 min' }))),

    el('h3', { style: { margin: '22px 0 10px' } }, 'Ingredients'),
    ingredientRows(),
    el('button', { class: 'btn small', onclick: () => { r.ingredients.push({ raw: '', quantity: '', unit: '', name: '', note: '' }); markDirty(); render(); } },
      '➕ Add an ingredient'),

    el('h3', { style: { margin: '26px 0 10px' } }, 'Method'),
    stepRows(),
    el('button', { class: 'btn small', onclick: () => { r.steps.push(''); markDirty(); render(); } }, '➕ Add a step'),

    el('h3', { style: { margin: '26px 0 10px' } }, 'Notes from the card'),
    field('', bind('notes', { textarea: true, placeholder: 'Anything written in the margins.' }),
      'Margin notes, corrections, and reminders that were on the paper.'));
}

function ingredientRows() {
  const r = state.recipe;
  if (!r.ingredients.length) {
    return el('p', { class: 'hint', style: { margin: '0 0 12px' } },
      'None yet. Add them by hand, or use “Read the recipe card” to fill them in from the photo.');
  }
  const units = state.boot?.taxonomy?.units || [];
  return el('div', { class: 'rows', style: { marginBottom: '12px' } },
    r.ingredients.map((ing, i) => {
      const set = (key) => (e) => { ing[key] = e.target.value; markDirty(); };
      const unitList = el('select', { onchange: set('unit') },
        ...[...new Set([ing.unit || '', ...units])].map((u) =>
          el('option', { value: u, selected: u === (ing.unit || '') }, u || '—')));
      return el('div', { class: 'row' },
        el('input', { type: 'text', value: ing.quantity || '', placeholder: '2', oninput: set('quantity'), 'aria-label': 'Amount' }),
        unitList,
        el('input', { type: 'text', value: ing.name || '', placeholder: 'plain flour', oninput: set('name'), 'aria-label': 'Ingredient' }),
        el('input', { type: 'text', value: ing.note || '', placeholder: 'sifted', oninput: set('note'), 'aria-label': 'Note' }),
        el('button', { class: 'del', title: 'Remove', onclick: () => { r.ingredients.splice(i, 1); markDirty(); render(); } }, '✕'));
    }));
}

function stepRows() {
  const r = state.recipe;
  if (!r.steps.length) return el('p', { class: 'hint', style: { margin: '0 0 12px' } }, 'No method written down yet.');
  return el('div', { class: 'rows', style: { marginBottom: '12px' } },
    r.steps.map((text, i) =>
      el('div', { class: 'row step' },
        el('div', { class: 'num' }, i + 1),
        el('textarea', {
          rows: 2, value: text, placeholder: 'Cream the butter and sugar until pale.',
          oninput: (e) => { r.steps[i] = e.target.value; markDirty(); },
          style: { minHeight: '56px' },
        }),
        el('button', { class: 'del', title: 'Remove', onclick: () => { r.steps.splice(i, 1); markDirty(); render(); } }, '✕'))));
}

function tabStory() {
  return el('div', {},
    el('p', { class: 'hint', style: { marginTop: 0 } },
      'This is the part that makes it a blog rather than a filing cabinet — who gave her the recipe, what she changed, when she makes it. It appears above the ingredients on the website.'),
    el('textarea', {
      rows: 16,
      value: state.recipe.commentary || '',
      placeholder: 'My grandmother made this every October…',
      oninput: (e) => { state.recipe.commentary = e.target.value; markDirty(); },
      style: { fontFamily: 'var(--serif)', fontSize: '16px', lineHeight: '1.7' },
    }),
    el('div', { class: 'hint' }, 'Blank lines start a new paragraph. **Bold** and *italic* work too.'));
}

function tabPhotos() {
  const dish = state.photos.filter((p) => p.role === 'photo');
  const scans = state.photos.filter((p) => p.role === 'scan');

  const group = (title, list, note) => el('div', { style: { marginBottom: '26px' } },
    el('h3', { style: { marginBottom: '4px' } }, title),
    el('p', { class: 'hint', style: { marginTop: 0 } }, note),
    list.length
      ? el('div', { class: 'photostrip' }, list.map(photoTile))
      : el('p', { class: 'hint' }, 'None yet — send some from the Inbox.'));

  return el('div', {},
    group('Photos of the finished dish', dish, 'These appear on the website. Click one to touch it up.'),
    group('Pictures of the recipe itself', scans, 'The paper card or page. Kept as a record and used to read the recipe.'),
    el('button', { class: 'btn', onclick: () => go('inbox') }, '\u{1F4E5} Go to the Inbox to add more'));
}

function photoTile(photo) {
  const isHero = state.recipe.heroImage === photo.name;
  const preview = photo.editedSrc || photo.thumb;
  return el('figure', { class: isHero ? 'isHero' : '' },
    photo.kind === 'pdf'
      ? el('div', { style: { display: 'grid', placeItems: 'center', aspectRatio: '1', fontSize: '30px', background: '#ece8e2' } }, '\u{1F4C4}')
      : el('img', { src: preview, alt: photo.name, loading: 'lazy' }),
    el('figcaption', {},
      photo.role === 'photo' && photo.kind === 'image'
        ? el('button', { class: 'btn small', onclick: () => { state.editing = photo.name; render(); } }, '\u{1F58C} Touch up')
        : null,
      photo.role === 'photo'
        ? el('button', {
            class: 'btn small ghost',
            onclick: async () => {
              await api(`/api/recipes/${state.recipe.slug}/hero`, { method: 'POST', body: { name: isHero ? '' : photo.name } });
              await loadRecipe(state.recipe.slug);
              render();
            },
          }, isHero ? '★ Main photo' : 'Make main')
        : null,
      photo.hasEdited ? el('span', { class: 'pill ready' }, 'Edited') : null,
      el('button', {
        class: 'btn small ghost',
        style: { marginLeft: 'auto', color: 'var(--danger)' },
        onclick: async () => {
          const ok = await confirmBox({ title: 'Delete this photo?', message: `${photo.name} will be removed from this recipe.`, confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await api(`/api/recipes/${state.recipe.slug}/photos/${encodeURIComponent(photo.name)}`, { method: 'DELETE' });
          await loadRecipe(state.recipe.slug);
          render();
        },
      }, '✕')));
}

function tabFiling() {
  const r = state.recipe;
  const tax = state.boot?.taxonomy || {};

  const multi = (label, key, options, hint) => {
    const chosen = r[key] || [];
    const picker = el('select', {
      onchange: (e) => {
        if (e.target.value && !chosen.includes(e.target.value)) { chosen.push(e.target.value); markDirty(); render(); }
        e.target.value = '';
      },
    }, el('option', { value: '' }, `➕ Add ${label.toLowerCase()}…`),
       ...options.filter((o) => !chosen.includes(o)).map((o) => el('option', { value: o }, o)));

    return el('div', { style: { marginBottom: '20px' } },
      el('h3', { style: { marginBottom: '6px' } }, label),
      hint ? el('p', { class: 'hint', style: { marginTop: 0 } }, hint) : null,
      el('div', { class: 'chips', style: { marginBottom: '8px' } },
        chosen.length
          ? chosen.map((value) => el('button', {
              class: 'chip removable', 'aria-pressed': 'true',
              onclick: () => { r[key] = chosen.filter((v) => v !== value); markDirty(); render(); },
            }, value, el('span', { class: 'x' }, '✕')))
          : el('span', { class: 'hint' }, 'Nothing chosen yet.')),
      picker);
  };

  const tagInput = el('input', {
    type: 'text',
    placeholder: 'Type a tag and press Enter',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = e.target.value.trim().toLowerCase();
      if (value && !r.tags.includes(value)) { r.tags.push(value); markDirty(); render(); }
      e.target.value = '';
    },
  });

  return el('div', {},
    el('h3', { style: { marginBottom: '6px' } }, 'Where it came from'),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 14px' } },
      field('Cook or author', bind('source.author', { placeholder: 'Aunt Marie' }), 'Searchable on the website.'),
      field('Book, magazine or site', bind('source.publication', { placeholder: 'Silver Palate Cookbook' })),
      field('Year', bind('source.year', { placeholder: '1982' })),
      field('Link', bind('source.url', { placeholder: 'https://…' }))),

    multi('Kind of food', 'foodTypes', tax.foodTypes || [], 'Dessert, main course, soup…'),
    multi('Cuisine', 'cuisines', tax.cuisines || []),
    multi('When it is eaten', 'courses', tax.courses || []),

    el('h3', { style: { marginBottom: '6px' } }, 'Tags'),
    el('div', { class: 'chips', style: { marginBottom: '8px' } },
      r.tags.length
        ? r.tags.map((tag) => el('button', {
            class: 'chip removable', 'aria-pressed': 'true',
            onclick: () => { r.tags = r.tags.filter((t) => t !== tag); markDirty(); render(); },
          }, tag, el('span', { class: 'x' }, '✕')))
        : el('span', { class: 'hint' }, 'No tags yet.')),
    tagInput,
    el('div', { class: 'hint', style: { marginBottom: '10px' } }, 'Suggestions:'),
    el('div', { class: 'chips' },
      (tax.suggestedTags || []).filter((t) => !r.tags.includes(t)).slice(0, 16).map((t) =>
        el('button', { class: 'chip', onclick: () => { r.tags.push(t); markDirty(); render(); } }, '➕ ', t))));
}

function sidePanel() {
  const r = state.recipe;
  const checks = [
    ['A name of its own', r.title && r.title !== 'Untitled recipe'],
    ['Ingredients', r.ingredients.length > 0],
    ['Method', r.steps.length > 0],
    ['A photo of the dish', state.photos.some((p) => p.role === 'photo')],
    ['Her story', Boolean(r.commentary?.trim())],
    ['At least one tag or category', r.tags.length + r.foodTypes.length > 0],
  ];
  const ready = checks.every(([, ok]) => ok);

  return el('div', {},
    el('div', { class: 'panel' },
      el('header', {}, el('h2', {}, 'Status')),
      el('div', { class: 'body' },
        el('select', {
          value: r.status,
          onchange: (e) => { r.status = e.target.value; markDirty(); render(); },
        }, ...(state.boot?.statuses || []).map((s) =>
          el('option', { value: s, selected: s === r.status }, STATUS_LABEL[s]))),
        el('p', { class: 'hint' }, 'Only recipes marked Ready or Published appear on the website.'),
        r.transcription?.status === 'done'
          ? el('div', { class: `note ${r.transcription.confidence === 'clean' ? 'info' : 'warn'}`, style: { marginTop: '12px' } },
              r.transcription.confidence === 'clean'
                ? 'Read from the photo. Please check it against the card.'
                : 'Read from the photo, but some words were unclear — they are listed in the notes.')
          : null)),

    el('div', { class: 'panel' },
      el('header', {}, el('h2', {}, 'Before publishing')),
      el('div', { class: 'body' },
        el('div', { class: 'kv' },
          checks.flatMap(([label, ok]) => [
            el('dt', { style: { color: ok ? 'var(--good)' : 'var(--ink-faint)' } }, ok ? '✓' : '○'),
            el('dd', { style: { color: ok ? 'var(--ink)' : 'var(--ink-soft)' } }, label),
          ])),
        ready
          ? el('div', { class: 'note good', style: { marginTop: '12px' } }, 'This one is ready to go.')
          : null)),

    el('div', { class: 'panel' },
      el('div', { class: 'body' },
        el('button', {
          class: 'btn danger',
          style: { width: '100%' },
          onclick: async () => {
            const ok = await confirmBox({
              title: 'Delete this recipe?',
              message: 'It moves to library/.trash, photos and all, so nothing is lost for good.',
              confirmLabel: 'Delete it',
              danger: true,
            });
            if (!ok) return;
            await api(`/api/recipes/${r.slug}`, { method: 'DELETE' });
            state.dirty = false;
            state.recipes = (await api('/api/recipes')).recipes;
            toast('Moved to the trash folder.');
            go('recipes');
          },
        }, 'Delete this recipe'))));
}

async function saveRecipe() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const result = await api(`/api/recipes/${state.recipe.slug}`, { method: 'PUT', body: { recipe: state.recipe } });
    state.recipe = result.recipe;
    state.photos = result.photos;
    state.dirty = false;
    state.recipes = (await api('/api/recipes')).recipes;
    await refreshBoot();
    toast('Saved.');
    render();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
}

async function runTranscription() {
  const filled = state.recipe.ingredients.length || state.recipe.steps.length;
  if (filled) {
    const ok = await confirmBox({
      title: 'Read the card again?',
      message: 'Anything already typed in is kept. Only empty fields get filled.',
      confirmLabel: 'Read it',
    });
    if (!ok) return;
  }
  const btn = document.getElementById('read-btn');
  btn.disabled = true;
  mount(btn, el('span', { class: 'spin' }), ' Reading…');
  try {
    await api(`/api/recipes/${state.recipe.slug}/transcribe`, { method: 'POST', body: {} });
    await loadRecipe(state.recipe.slug);
    state.tab = 'recipe';
    toast('Read it. Please check it against the card before publishing.');
    render();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = '✨ Read the recipe card';
  }
}

/* ---------------------------------------------------------- photo editor */

const ADJUSTMENTS = [
  { key: 'brightness', label: 'Brightness', min: 0.6, max: 1.5, step: 0.01, base: 1 },
  { key: 'contrast', label: 'Contrast', min: 0.6, max: 1.5, step: 0.01, base: 1 },
  { key: 'saturation', label: 'Colour', min: 0, max: 1.8, step: 0.01, base: 1 },
  { key: 'warmth', label: 'Warmth', min: -0.3, max: 0.3, step: 0.01, base: 0 },
  { key: 'sharpen', label: 'Sharpness', min: 0, max: 3, step: 0.1, base: 0 },
  { key: 'straighten', label: 'Straighten', min: -15, max: 15, step: 0.5, base: 0 },
];

function viewPhotoEditor() {
  const photo = state.photos.find((p) => p.name === state.editing);
  if (!photo) { state.editing = null; return render(); }

  const edit = {
    rotate: 0, straighten: 0, flipH: false, crop: null,
    brightness: 1, contrast: 1, saturation: 1, warmth: 0, sharpen: 0, autoLevels: false,
    ...(photo.edit || {}),
  };
  let cropping = Boolean(edit.crop);
  let aspect = 'free';

  const base = `/api/recipes/${state.recipe.slug}/photos/${encodeURIComponent(photo.name)}/geometry`;
  const geometryUrl = () =>
    `${base}?edit=${encodeURIComponent(JSON.stringify({ rotate: edit.rotate, straighten: edit.straighten, flipH: edit.flipH }))}`;

  const img = el('img', { src: geometryUrl(), alt: photo.name, draggable: false });
  const cropBox = el('div', { class: 'cropbox', hidden: true },
    el('span', { class: 'handle nw', 'data-handle': 'nw' }),
    el('span', { class: 'handle se', 'data-handle': 'se' }));
  const frame = el('div', { class: 'frame' }, img, cropBox);
  const stage = el('div', { class: 'stage' }, frame);

  /* --- colour preview, applied live with CSS so the sliders feel instant --- */
  const applyColour = () => {
    img.style.filter = [
      `brightness(${edit.brightness})`,
      `contrast(${edit.contrast})`,
      `saturate(${edit.saturation})`,
      edit.autoLevels ? 'contrast(1.06) brightness(1.02)' : '',
      edit.warmth > 0 ? `sepia(${edit.warmth * 1.8})` : '',
      edit.warmth < 0 ? `hue-rotate(${edit.warmth * 40}deg) saturate(1.05)` : '',
    ].filter(Boolean).join(' ');
  };

  /* --- turning is rendered by the server, so what you see is what you get --- */
  const refreshGeometry = debounce(() => { img.src = geometryUrl(); }, 120);

  /* ------------------------------------------------------------ crop box */

  const drawCrop = () => {
    cropBox.hidden = !cropping || !edit.crop;
    if (!edit.crop) return;
    const { x, y, w, h } = edit.crop;
    Object.assign(cropBox.style, {
      left: `${x * 100}%`, top: `${y * 100}%`,
      width: `${w * 100}%`, height: `${h * 100}%`,
    });
  };

  const ratioFor = () => {
    if (aspect === 'free') return null;
    const box = img.getBoundingClientRect();
    return { pixels: aspect, frameW: box.width, frameH: box.height };
  };

  const clampCrop = (c) => {
    const x = Math.min(Math.max(c.x, 0), 0.98);
    const y = Math.min(Math.max(c.y, 0), 0.98);
    return {
      x, y,
      w: Math.min(Math.max(c.w, 0.05), 1 - x),
      h: Math.min(Math.max(c.h, 0.05), 1 - y),
    };
  };

  const startCrop = () => {
    cropping = true;
    if (!edit.crop) edit.crop = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    applyAspect();
    drawCrop();
  };

  function applyAspect() {
    const r = ratioFor();
    if (!r || !edit.crop) return;
    // Work in displayed pixels so the box looks like the ratio it claims.
    const wPx = edit.crop.w * r.frameW;
    const targetHPx = wPx / r.pixels;
    edit.crop = clampCrop({ ...edit.crop, h: targetHPx / r.frameH });
    drawCrop();
  }

  let drag = null;
  const onDown = (event) => {
    if (!cropping || !edit.crop) return;
    const handle = event.target.getAttribute?.('data-handle');
    if (!handle && event.target !== cropBox) return;
    event.preventDefault();
    drag = { handle, startX: event.clientX, startY: event.clientY, origin: { ...edit.crop }, box: img.getBoundingClientRect() };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onMove = (event) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.box.width;
    const dy = (event.clientY - drag.startY) / drag.box.height;
    const o = drag.origin;

    if (!drag.handle) {
      edit.crop = {
        x: Math.min(Math.max(o.x + dx, 0), 1 - o.w),
        y: Math.min(Math.max(o.y + dy, 0), 1 - o.h),
        w: o.w, h: o.h,
      };
    } else if (drag.handle === 'nw') {
      const x = Math.min(Math.max(o.x + dx, 0), o.x + o.w - 0.05);
      const y = Math.min(Math.max(o.y + dy, 0), o.y + o.h - 0.05);
      edit.crop = clampCrop({ x, y, w: o.x + o.w - x, h: o.y + o.h - y });
    } else {
      edit.crop = clampCrop({ x: o.x, y: o.y, w: o.w + dx, h: o.h + dy });
    }
    if (aspect !== 'free') applyAspect();
    drawCrop();
  };

  const onUp = () => {
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  cropBox.addEventListener('pointerdown', onDown);

  /* ---------------------------------------------------------- the panel */

  const sliders = ADJUSTMENTS.map((cfg) => {
    const out = el('b', {}, formatAdjust(cfg, edit[cfg.key]));
    const input = el('input', {
      type: 'range', min: cfg.min, max: cfg.max, step: cfg.step, value: edit[cfg.key],
      oninput: (e) => {
        edit[cfg.key] = Number(e.target.value);
        out.textContent = formatAdjust(cfg, edit[cfg.key]);
        if (cfg.key === 'straighten') refreshGeometry(); else applyColour();
      },
    });
    return el('div', { class: 'slider' }, el('div', { class: 'lbl' }, el('span', {}, cfg.label), out), input);
  });

  const turn = (degrees) => {
    edit.rotate = (edit.rotate + degrees + 360) % 360;
    if (edit.crop && degrees % 180 !== 0) edit.crop = null; // the frame changed shape
    refreshGeometry();
    drawCrop();
  };

  const aspectButtons = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' } },
    ...[['free', 'Free'], [1, 'Square'], [4 / 3, 'Landscape'], [3 / 4, 'Portrait']].map(([value, label]) =>
      el('button', {
        class: 'chip', 'aria-pressed': String(aspect === value),
        onclick: (e) => {
          aspect = value;
          [...aspectButtons.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          startCrop();
        },
      }, label)));

  const cropPanel = el('div', { hidden: !cropping },
    aspectButtons,
    el('button', {
      class: 'btn small', style: { width: '100%' },
      onclick: () => { edit.crop = null; cropping = false; cropPanel.hidden = true; cropToggle.setAttribute('aria-pressed', 'false'); drawCrop(); },
    }, 'Remove the crop'),
    el('p', { class: 'hint' }, 'Drag inside the box to move it, or the white corners to resize.'));

  const cropToggle = el('button', {
    class: 'btn small', 'aria-pressed': String(cropping),
    onclick: () => {
      cropping = !cropping;
      cropPanel.hidden = !cropping;
      cropToggle.setAttribute('aria-pressed', String(cropping));
      if (cropping) startCrop(); else drawCrop();
    },
  }, '⛶ Crop');

  mount(document.getElementById('topbar'),
    topbar('Touch up photo', photo.name,
      el('button', { class: 'btn ghost', onclick: () => { state.editing = null; render(); } }, '← Back to the recipe')));

  mount(document.getElementById('view'),
    el('div', { class: 'darkroom' },
      stage,
      el('div', { class: 'panel' },
        el('div', { class: 'body' },
          el('h3', { style: { marginBottom: '10px' } }, 'Turn and crop'),
          el('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
            el('button', { class: 'btn small', onclick: () => turn(-90) }, '↺ Left'),
            el('button', { class: 'btn small', onclick: () => turn(90) }, '↻ Right'),
            el('button', { class: 'btn small', onclick: () => { edit.flipH = !edit.flipH; refreshGeometry(); } }, '⇄ Flip'),
            cropToggle),
          cropPanel,

          el('h3', { style: { margin: '18px 0 10px' } }, 'Adjust'),
          ...sliders,

          el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0 18px' } },
            el('input', {
              type: 'checkbox', checked: edit.autoLevels, style: { width: 'auto' },
              onchange: (e) => { edit.autoLevels = e.target.checked; applyColour(); },
            }),
            el('span', {}, 'Auto-brighten dull photos')),

          el('div', { style: { display: 'flex', gap: '8px' } },
            el('button', {
              class: 'btn', style: { flex: '1' },
              onclick: () => {
                Object.assign(edit, { rotate: 0, straighten: 0, flipH: false, crop: null, brightness: 1, contrast: 1, saturation: 1, warmth: 0, sharpen: 0, autoLevels: false });
                render();
              },
            }, 'Start over'),
            el('button', { class: 'btn primary', style: { flex: '1' }, id: 'apply-edit', onclick: () => applyEdit(photo, edit) }, 'Save photo')),
          el('p', { class: 'hint' },
            'The original photo is never changed — the touched-up copy is saved beside it, so you can always start over.')))));

  applyColour();
  img.addEventListener('load', drawCrop);
  drawCrop();
}

function formatAdjust(cfg, value) {
  if (cfg.key === 'straighten') return `${value > 0 ? '+' : ''}${value}°`;
  if (cfg.key === 'sharpen') return value ? `+${value.toFixed(1)}` : 'off';
  if (cfg.key === 'warmth') return value === 0 ? 'neutral' : (value > 0 ? `warm +${Math.round(value * 100)}` : `cool ${Math.round(value * 100)}`);
  return `${Math.round(value * 100)}%`;
}

async function applyEdit(photo, edit) {
  const btn = document.getElementById('apply-edit');
  btn.disabled = true;
  mount(btn, el('span', { class: 'spin' }), ' Saving…');
  try {
    const result = await api(`/api/recipes/${state.recipe.slug}/photos/${encodeURIComponent(photo.name)}/edit`,
      { method: 'POST', body: { edit } });
    state.photos = result.photos;
    state.editing = null;
    state.tab = 'photos';
    toast('Photo saved.');
    render();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Save photo';
  }
}

/* ---------------------------------------------------------------- publish */

function viewPublish() {
  mount(document.getElementById('topbar'), topbar('Publish', 'Turn the library into the website'));

  const logBox = el('pre', { class: 'log' }, 'Not built yet in this session.');
  const status = el('div');

  const build = async () => {
    mount(status, el('div', { class: 'note info' }, el('span', { class: 'spin' }), ' Building the website…'));
    await api('/api/publish', { method: 'POST' });
    const poll = setInterval(async () => {
      const s = await api('/api/publish/status');
      logBox.textContent = s.log || 'Working…';
      if (!s.running) {
        clearInterval(poll);
        mount(status, s.ok
          ? el('div', { class: 'note good' }, 'Website built. ',
              el('a', { href: state.boot?.previewUrl || '/', target: '_blank' }, 'Open the preview →'))
          : el('div', { class: 'note bad' }, 'The build stopped with an error — see the log below.'));
        await refreshBoot();
      }
    }, 900);
  };

  const readyCount = (state.boot?.counts?.byStatus?.ready || 0) + (state.boot?.counts?.byStatus?.published || 0);

  mount(document.getElementById('view'),
    el('div', { class: 'panel' },
      el('header', {}, el('h2', {}, 'Step 1 — Build the website')),
      el('div', { class: 'body' },
        el('p', {}, `${readyCount} recipe${readyCount === 1 ? '' : 's'} ${readyCount === 1 ? 'is' : 'are'} marked Ready or Published and will be included. Drafts stay private.`),
        el('button', { class: 'btn primary', onclick: build }, '\u{1F528} Build the website'),
        el('div', { style: { height: '14px' } }),
        status,
        el('div', { style: { height: '14px' } }),
        logBox)),

    el('div', { class: 'panel' },
      el('header', {}, el('h2', {}, 'Step 2 — Put it online')),
      el('div', { class: 'body' },
        el('p', {}, 'The finished website is the ', el('code', {}, 'dist'), ' folder. To publish it, open a terminal in the project folder and run:'),
        el('pre', { class: 'log' }, 'git add -A\ngit commit -m "New recipes"\ngit push'),
        el('p', { class: 'hint' }, 'See PUBLISHING.md in the project folder for how to connect it to a web address the first time.'))));
}

/* ------------------------------------------------------------------- help */

function viewHelp() {
  mount(document.getElementById('topbar'), topbar('How to use this', 'The whole system in five steps'));
  const step = (n, title, ...body) =>
    el('div', { class: 'panel' },
      el('header', {}, el('div', { class: 'mark', style: { width: '26px', height: '26px', borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent-dark)', display: 'grid', placeItems: 'center', fontWeight: '700', fontSize: '13px' } }, n), el('h2', {}, title)),
      el('div', { class: 'body' }, ...body));

  mount(document.getElementById('view'),
    step(1, 'Photograph the recipe',
      el('p', {}, 'Lay the card flat in good light and take a photo with any phone. Take a second photo of the back if there is one.')),
    step(2, 'Send the photos here',
      el('p', {}, 'On the phone, open the camera and point it at the QR code in the Inbox. Choose the photos and tap Send. They appear in the Inbox on this computer.'),
      el('button', { class: 'btn', onclick: showUploadHelp }, 'Show the QR code')),
    step(3, 'File each photo',
      el('p', {}, 'In the Inbox, tap the photos that belong together, say whether they are the recipe card or the finished dish, and file them into a new or existing recipe.')),
    step(4, 'Read and check',
      el('p', {}, state.boot?.ai?.available
        ? 'Open the recipe and press "Read the recipe card". The ingredients and method are filled in from the photo. Read them against the card and fix anything that is wrong — it is a good reader, not a perfect one.'
        : 'Type the ingredients and method in. (Automatic reading is switched off because no key is set up — see SETUP.md.)'),
      el('p', {}, 'Add her story, tags and categories, pick a main photo, then set the status to Ready.')),
    step(5, 'Publish',
      el('p', {}, 'Go to Publish and press Build. Look at the preview, and when it looks right, push it online.')));
}

/* ------------------------------------------------------------------ render */

function render() {
  renderRail();
  if (state.editing && state.route === 'recipe') return viewPhotoEditor();
  if (state.route === 'inbox') return viewInbox();
  if (state.route === 'recipes') return viewRecipes();
  if (state.route === 'recipe') return viewRecipe();
  if (state.route === 'publish') return viewPublish();
  if (state.route === 'help') return viewHelp();
}

/* -------------------------------------------------------- drag-and-drop */

['dragenter', 'dragover'].forEach((type) =>
  document.addEventListener(type, (e) => { e.preventDefault(); document.body.style.outline = '3px solid var(--accent)'; }));
['dragleave', 'drop'].forEach((type) =>
  document.addEventListener(type, () => { document.body.style.outline = ''; }));

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  const data = new FormData();
  files.forEach((f) => data.append('photos', f, f.name));
  toast(`Adding ${files.length} file${files.length === 1 ? '' : 's'}…`);
  const res = await fetch('/api/inbox/upload', { method: 'POST', body: data });
  const result = await res.json();
  toast(`${(result.saved || []).length} added to the Inbox.`);
  await go('inbox');
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* -------------------------------------------------------------------- boot */

(async function start() {
  await refreshBoot();
  state.recipes = (await api('/api/recipes')).recipes;
  state.inbox = (await api('/api/inbox')).items;
  state.route = state.inbox.length ? 'inbox' : (state.recipes.length ? 'recipes' : 'help');
  render();
})();
