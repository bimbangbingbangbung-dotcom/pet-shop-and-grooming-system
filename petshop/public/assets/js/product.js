/**
 * Product page. Everything on it comes from one request; the basket line is
 * assembled here so the card and the detail page agree on what a line is.
 */

import { api } from './api.js';
import { cart } from './cart.js';
import { hydrateChrome, state, wireRetry, esc, money, announce, toast } from './ui.js';
import { renderProductCard, wireAddButtons } from './catalog.js';
import { productArt, tintFor } from './art.js';

hydrateChrome();
wireAddButtons();

const pdp = document.querySelector('[data-pdp]');
const relatedSection = document.querySelector('[data-related-section]');
const relatedSlot = document.querySelector('[data-related]');
const crumb = document.querySelector('[data-crumb-name]');
const slug = new URLSearchParams(location.search).get('slug');

function notFound(message) {
  hideRelated();
  pdp.removeAttribute('aria-busy');
  pdp.style.display = 'block';
  pdp.innerHTML = `<div class="state">
    <p class="state__title">Nothing on that shelf</p>
    <p class="state__body">${esc(message)}</p>
    <a class="btn" href="/shop">Back to the shop</a>
  </div>`;
}

function stockBadge(p) {
  if (p.stock <= 0) return '<span class="badge badge--out">Out of stock</span>';
  if (p.stock <= 10) return `<span class="badge badge--low">Only ${p.stock} left</span>`;
  return '<span class="badge badge--ok">In stock</span>';
}

function render(p) {
  document.title = `${p.name} — Snip & Snout`;
  if (crumb) crumb.textContent = p.name;

  const line = JSON.stringify({
    slug: p.slug, name: p.name, price_cents: p.price_cents, art: p.art, size: p.size,
  });
  const soldOut = p.stock <= 0;

  pdp.removeAttribute('aria-busy');
  pdp.innerHTML = `
    <div class="pdp__media" style="background:${tintFor(p.art)}">${productArt(p.art, p.name)}</div>
    <div>
      <h1 class="pdp__title">${esc(p.name)}</h1>
      <p class="pdp__price">${money(p.price_cents)}</p>
      <div class="pdp__meta">
        <span class="badge">${esc(p.category_name)}</span>
        ${p.size ? `<span class="badge">${esc(p.size)}</span>` : ''}
        ${stockBadge(p)}
      </div>
      <p class="pdp__desc">${esc(p.description)}</p>
      ${p.detail ? `<div class="pdp__spec"><p>${esc(p.detail)}</p></div>` : ''}

      <div class="pdp__buy">
        ${soldOut ? '' : `
          <div class="qty">
            <button type="button" data-step="-1" aria-label="One fewer">−</button>
            <input type="number" value="1" min="1" max="99" data-qty aria-label="Quantity of ${esc(p.name)}">
            <button type="button" data-step="1" aria-label="One more">+</button>
          </div>
          <button class="btn" type="button" data-buy>Add to basket</button>`}
        <a class="btn btn--ghost" href="/shop">Back to the shop</a>
      </div>

      <p class="ship-note">Delivery ₱150, free over ₱2,500. Ordered before 2pm it goes out the same day, or collect in shop within the hour.</p>
    </div>`;

  announce(`${p.name}, ${money(p.price_cents)}.`);

  const qty = pdp.querySelector('[data-qty]');
  pdp.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Math.min(99, Math.max(1, (Number(qty.value) || 1) + Number(btn.dataset.step)));
      qty.value = String(next);
    });
  });

  const buy = pdp.querySelector('[data-buy]');
  if (buy) {
    buy.addEventListener('click', () => {
      const n = Math.min(99, Math.max(1, Number(qty.value) || 1));
      cart.add({ ...JSON.parse(line) }, n);
      toast(n === 1 ? `${p.name} added to your basket.` : `${n} × ${p.name} added to your basket.`, 'ok');
      announce('Added to basket.');
      const original = buy.textContent;
      buy.textContent = 'Added';
      buy.setAttribute('aria-disabled', 'true');
      setTimeout(() => {
        buy.textContent = original;
        buy.removeAttribute('aria-disabled');
      }, 1200);
    });
  }
}

/**
 * The related shelf ships with its placeholder already in the page, so the
 * first paint reserves the space. It is only ever taken back out when there is
 * genuinely nothing to show.
 */
function hideRelated() {
  relatedSlot.innerHTML = '';
  relatedSection.hidden = true;
}

function renderRelated(items) {
  if (!items.length) return hideRelated();
  relatedSlot.innerHTML = items.map(renderProductCard).join('');
  relatedSection.hidden = false;
}

async function load() {
  if (!slug) return notFound('That link does not name a product.');

  try {
    const data = await api.get(`/api/products/${encodeURIComponent(slug)}`);
    render(data.product);
    renderRelated(data.related);
  } catch (err) {
    pdp.removeAttribute('aria-busy');
    if (err.status === 404) {
      notFound(err.message);
      return;
    }
    pdp.style.display = 'block';
    pdp.innerHTML = state.error(err.message, 'product');
    hideRelated();
    wireRetry(pdp, load);
  }
}

load();
