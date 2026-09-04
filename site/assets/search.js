/* Client-side search and filtering for the recipe index.
   The whole index ships as one small JSON file, so search works
   instantly and needs no server. */

(async function () {
  const results = document.getElementById('results');
  const noResults = document.getElementById('noresults');
  const countLabel = document.getElementById('count');
  const facetHost = document.getElementById('facets');
  const input = document.getElementById('q');
  if (!results || !input) return;

  const index = await fetch('/assets/index.json').then((r) => r.json());
  const cards = new Map(
    [...results.querySelectorAll('.card')].map((card) => [card.getAttribute('href').split('/')[2], card])
  );

  const FACETS = [
    { key: 'foodTypes', param: 'type', label: 'Kind of food' },
    { key: 'cuisines', param: 'cuisine', label: 'Cuisine' },
    { key: 'author', param: 'from', label: 'From' },
    { key: 'tags', param: 'tag', label: 'Tag' },
    { key: 'ingredients', param: 'ingredient', label: 'Ingredient' },
  ];

  const active = {};
  const params = new URLSearchParams(location.search);
  FACETS.forEach((f) => { if (params.get(f.param)) active[f.key] = params.get(f.param); });
  if (params.get('q')) input.value = params.get('q');

  const valuesOf = (recipe, key) => {
    const value = recipe[key];
    return Array.isArray(value) ? value : (value ? [value] : []);
  };

  function tally(key, pool) {
    const counts = new Map();
    for (const recipe of pool) {
      for (const value of valuesOf(recipe, key)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function matches(recipe) {
    for (const [key, wanted] of Object.entries(active)) {
      if (!valuesOf(recipe, key).includes(wanted)) return false;
    }
    const query = input.value.trim().toLowerCase();
    if (!query) return true;
    const haystack = [
      recipe.title, recipe.summary, recipe.author, recipe.publication,
      recipe.tags.join(' '), recipe.foodTypes.join(' '), recipe.cuisines.join(' '),
      recipe.ingredients.join(' '), recipe.text,
    ].join(' ').toLowerCase();
    return query.split(/\s+/).every((word) => haystack.includes(word));
  }

  function score(recipe, query) {
    if (!query) return 0;
    const title = recipe.title.toLowerCase();
    let points = 0;
    for (const word of query.split(/\s+/)) {
      if (title.startsWith(word)) points += 6;
      else if (title.includes(word)) points += 4;
      if (recipe.ingredients.some((i) => i.includes(word))) points += 2;
      if (recipe.tags.includes(word)) points += 2;
    }
    return points;
  }

  function apply() {
    const query = input.value.trim().toLowerCase();
    const shown = index.filter(matches);
    const ranked = query
      ? [...shown].sort((a, b) => score(b, query) - score(a, query))
      : shown;
    const visible = new Set(ranked.map((r) => r.slug));

    for (const [slug, card] of cards) card.hidden = !visible.has(slug);
    ranked.forEach((r) => { const card = cards.get(r.slug); if (card) results.append(card); });

    countLabel.textContent = `${ranked.length} recipe${ranked.length === 1 ? '' : 's'}`;
    noResults.hidden = ranked.length > 0;
    drawFacets(shown);
    syncUrl(query);
  }

  function drawFacets(pool) {
    facetHost.replaceChildren();
    for (const facet of FACETS) {
      // Count against everything except this facet's own filter, so a chosen
      // value never hides its own siblings.
      const others = { ...active };
      delete others[facet.key];
      const pooled = index.filter((recipe) =>
        Object.entries(others).every(([key, wanted]) => valuesOf(recipe, key).includes(wanted)));
      const entries = tally(facet.key, pooled).slice(0, 14);
      if (!entries.length) continue;

      const group = document.createElement('div');
      group.className = 'facet';
      const heading = document.createElement('h3');
      heading.textContent = facet.label;
      group.append(heading);

      const row = document.createElement('div');
      row.className = 'facet-row';
      for (const [value, count] of entries) {
        const button = document.createElement('button');
        button.className = 'chip';
        button.type = 'button';
        button.setAttribute('aria-pressed', String(active[facet.key] === value));
        button.innerHTML = `${value} <span class="n">${count}</span>`;
        button.addEventListener('click', () => {
          if (active[facet.key] === value) delete active[facet.key];
          else active[facet.key] = value;
          apply();
        });
        row.append(button);
      }
      group.append(row);
      facetHost.append(group);
    }

    if (Object.keys(active).length) {
      const clear = document.createElement('button');
      clear.className = 'chip clear';
      clear.type = 'button';
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => {
        for (const key of Object.keys(active)) delete active[key];
        apply();
      });
      facetHost.append(clear);
    }
    void pool;
  }

  function syncUrl(query) {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    for (const facet of FACETS) if (active[facet.key]) next.set(facet.param, active[facet.key]);
    const url = next.toString() ? `?${next}` : location.pathname;
    history.replaceState(null, '', url);
  }

  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 120); });
  apply();
})();
