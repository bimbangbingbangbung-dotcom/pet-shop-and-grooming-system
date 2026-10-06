/**
 * Home: the comparison slider, plus the three data-driven sections.
 */

import { api } from './api.js';
import { hydrateChrome, state, wireRetry, esc, announce } from './ui.js';
import { renderMenu, renderProductCard, skeletonGrid, skeletonMenu, wireAddButtons } from './catalog.js';

hydrateChrome();
wireAddButtons();

/* ------------------------------------------------- comparison slider ---- */

function initCompare() {
  const root = document.querySelector('[data-compare]');
  if (!root) return;

  const range = root.querySelector('[data-compare-range]');
  const clip = root.querySelector('[data-clip]');
  const rule = root.querySelector('[data-rule]');

  const paint = (value) => {
    clip.style.clipPath = `inset(0 0 0 ${value}%)`;
    rule.style.left = `${value}%`;
  };

  range.addEventListener('input', () => paint(Number(range.value)));

  paint(Number(range.value));

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    range.value = '45';
    paint(45);
    return;
  }

  // One orchestrated moment on load: the handle sweeps to reveal the groom,
  // then hands control to the slider.
  const from = 100;
  const to = 42;
  const duration = 1100;
  let start = null;

  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const step = (ts) => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / duration);
    const value = from + (to - from) * ease(t);
    range.value = String(Math.round(value));
    paint(value);
    if (t < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(() => requestAnimationFrame(step));
}

/* -------------------------------------------------------- services ------ */

async function loadServices() {
  const slot = document.querySelector('[data-services-slot]');
  if (!slot) return;

  const rows = Number(slot.dataset.rows) || 4;
  slot.innerHTML = skeletonMenu(3);

  try {
    const { services } = await api.get('/api/services');
    slot.innerHTML = renderMenu(services.slice(0, rows), { compact: true });
  } catch (err) {
    slot.innerHTML = state.error(err.message, 'services');
    wireRetry(slot, loadServices);
  }
}

/* ---------------------------------------------------- featured products -- */

async function loadFeatured() {
  const slot = document.querySelector('[data-featured-slot]');
  if (!slot) return;

  const rows = Number(slot.dataset.rows) || 4;
  slot.innerHTML = skeletonGrid(rows);

  try {
    const data = await api.get(`/api/products?per=${rows * 2}&sort=featured`);
    const items = data.items.slice(0, rows);
    if (!items.length) {
      slot.innerHTML = state.empty('Nothing on the shelf', 'The shop is empty right now. Give it a day.');
      return;
    }
    slot.innerHTML = items.map(renderProductCard).join('');
  } catch (err) {
    slot.innerHTML = state.error(err.message, 'featured');
    wireRetry(slot, loadFeatured);
  }
}

/* ------------------------------------------------------------ hours ----- */

async function loadHours() {
  const slot = document.querySelector('[data-hours-slot]');
  if (!slot) return;

  slot.innerHTML = '<div class="skeleton" style="height:18px;width:80%"></div>' +
                   '<div class="skeleton" style="height:18px;width:70%;margin-top:.6rem"></div>' +
                   '<div class="skeleton" style="height:18px;width:75%;margin-top:.6rem"></div>';

  try {
    const shop = await api.get('/api/shop');
    const todayIndex = (new Date().getDay() + 6) % 7; // hours[] starts on Monday

    slot.innerHTML = `<dl class="hours">${shop.hours.map((h, i) => `
      <div data-today="${i === todayIndex}">
        <dt>${esc(h.day)}${i === todayIndex ? ' (today)' : ''}</dt>
        <dd>${h.closed ? 'Closed' : `${esc(h.open)} to ${esc(h.close)}`}</dd>
      </div>`).join('')}</dl>`;
  } catch (err) {
    slot.innerHTML = state.error(err.message, 'hours');
    wireRetry(slot, loadHours);
  }
}

initCompare();
loadServices();
loadFeatured();
loadHours();
announce('Snip and Snout, pet shop and grooming parlour.');
