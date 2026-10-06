/**
 * Shop: category filter, search, sort and paging. All four live in the query
 * string, so a filtered shop can be linked, bookmarked and reloaded.
 */

import { api } from './api.js';
import { hydrateChrome, state, wireRetry, esc, announce } from './ui.js';
import { renderProductCard, skeletonGrid, wireAddButtons } from './catalog.js';

hydrateChrome();
wireAddButtons();

const grid = document.querySelector('[data-grid]');
const filters = document.querySelector('[data-filters]');
const countEl = document.querySelector('[data-count]');
const searchEl = document.querySelector('[data-search]');
const sortEl = document.querySelector('[data-sort]');
const pager = document.querySelector('[data-pager]');

const SORTS = ['featured', 'price-asc', 'price-desc', 'name'];

const params = new URLSearchParams(location.search);
const view = {
  category: params.get('category') || '',
  q: params.get('q') || '',
  sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'featured',
  page: Math.max(1, Number(params.get('page')) || 1),
};

function syncUrl() {
  const next = new URLSearchParams();
  if (view.category) next.set('category', view.category);
  if (view.q) next.set('q', view.q);
  if (view.sort !== 'featured') next.set('sort', view.sort);
  if (view.page > 1) next.set('page', String(view.page));
  const qs = next.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

function query() {
  const q = new URLSearchParams({ sort: view.sort, page: String(view.page), per: '12' });
  if (view.category) q.set('category', view.category);
  if (view.q) q.set('q', view.q);
  return `/api/products?${q}`;
}

/* ------------------------------------------------------------ filters --- */

let categories = [];
const counts = {};          // slug (or 'all') -> total

const key = (slug) => slug || 'all';

function renderFilters() {
  const chip = (slug, label) => `
    <button class="filter-chip" type="button" data-cat="${esc(slug)}"
            aria-pressed="${String(slug === view.category)}">
      ${esc(label)}<span>${counts[key(slug)] ?? ''}</span>
    </button>`;

  filters.innerHTML = chip('', 'Everything') + categories.map((c) => chip(c.slug, c.name)).join('');

  filters.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (view.category === btn.dataset.cat) return;
      view.category = btn.dataset.cat;
      view.page = 1;
      syncUrl();

      // Move the pressed state rather than rebuilding: focus must not jump
      // away from the chip the user just pressed.
      filters.querySelectorAll('[data-cat]').forEach((other) => {
        other.setAttribute('aria-pressed', String(other.dataset.cat === view.category));
      });

      load();
    });
  });
}

/** Counts arrive separately so the chips are usable before they land. */
async function loadCounts() {
  const slugs = ['all', ...categories.map((c) => c.slug)];

  await Promise.all(slugs.map(async (slug) => {
    try {
      const data = await api.get(`/api/products?per=1${slug === 'all' ? '' : `&category=${encodeURIComponent(slug)}`}`);
      counts[slug] = data.total;
      const idx = slugs.indexOf(slug);
      const chip = filters.querySelectorAll('[data-cat]')[idx];
      const slot = chip && chip.querySelector('span');
      if (slot) slot.textContent = String(data.total);
    } catch (_) {
      /* a missing count is not worth an error message */
    }
  }));
}

/* ----------------------------------------------------------- products --- */

async function load() {
  grid.setAttribute('aria-busy', 'true');
  grid.innerHTML = skeletonGrid(8);
  pager.hidden = true;

  try {
    const data = await api.get(query());
    grid.setAttribute('aria-busy', 'false');

    const noun = data.total === 1 ? 'product' : 'products';
    const where = view.q ? ` for “${view.q}”` : '';
    countEl.textContent = `${data.total} ${noun}${where}`;

    if (!data.items.length) {
      grid.innerHTML = state.empty(
        'Nothing matches that',
        view.q ? 'Try a shorter word, or clear the search.' : 'This shelf is empty right now.'
      );
      return;
    }

    grid.innerHTML = data.items.map(renderProductCard).join('');
    renderPager(data);
    announce(`${data.total} ${noun}.`);
  } catch (err) {
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = state.error(err.message, 'products');
    wireRetry(grid, load);
  }
}

function renderPager(data) {
  if (data.pages <= 1) return;

  const button = (page, label, disabled) => `
    <button class="btn btn--quiet" type="button" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  const numbers = [];
  for (let p = 1; p <= data.pages; p++) {
    if (p === 1 || p === data.pages || Math.abs(p - data.page) <= 2) {
      numbers.push(`<button class="btn btn--quiet" type="button" data-page="${p}"
        ${p === data.page ? 'aria-current="page"' : ''}>${p}</button>`);
    } else if (numbers[numbers.length - 1] !== '<span>…</span>') {
      numbers.push('<span>…</span>');
    }
  }

  pager.innerHTML =
    button(data.page - 1, 'Previous', data.page <= 1) +
    numbers.join('') +
    button(data.page + 1, 'Next', data.page >= data.pages);
  pager.hidden = false;

  pager.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (!Number.isInteger(page) || page === view.page) return;
      view.page = page;
      syncUrl();
      load();
      document.querySelector('.shop-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* --------------------------------------------------------------- wiring - */

let debounce;
searchEl.value = view.q;
searchEl.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const next = searchEl.value.trim().slice(0, 60);
    if (next === view.q) return;
    view.q = next;
    view.page = 1;
    syncUrl();
    load();
  }, 300);
});

sortEl.value = view.sort;
sortEl.addEventListener('change', () => {
  view.sort = sortEl.value;
  view.page = 1;
  syncUrl();
  load();
});

async function boot() {
  renderFilters();
  load();

  try {
    const data = await api.get('/api/categories');
    categories = data.categories || [];
    renderFilters();
    loadCounts();
  } catch (_) {
    // The chips still filter by nothing at all; products load regardless.
  }
}

boot();
