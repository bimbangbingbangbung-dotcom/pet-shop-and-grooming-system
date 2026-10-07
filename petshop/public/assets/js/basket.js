/**
 * Basket. Quantities, per-line notes and the delivery choice live in
 * browser storage and update the page instantly; the server re-prices every
 * line and holds the stock, so nothing here is trusted — it is all display
 * until checkout actually posts the order.
 */

import { api } from './api.js';
import { cart, checkout } from './cart.js';
import { hydrateChrome, esc, money, announce } from './ui.js';
import { productArt, tintFor } from './art.js';

hydrateChrome();

const layout = document.querySelector('[data-cart-layout]');
const emptyEl = document.querySelector('[data-empty]');
const linesEl = document.querySelector('[data-lines]');
const totalsEl = document.querySelector('[data-totals]');
const meter = document.querySelector('[data-ship-meter] span');
const shipNote = document.querySelector('[data-ship-note]');
const orderNote = document.querySelector('[data-order-note]');

let shop = { shipping_cents: 15000, free_over_cents: 250000 };
let fulfilment = checkout.read().fulfilment === 'collection' ? 'collection' : 'delivery';

/* --------------------------------------------------------------- render -- */

function renderLine(l) {
  const line = JSON.stringify({ slug: l.slug, name: l.name, price_cents: l.price_cents, art: l.art, size: l.size });
  return `
    <div class="cart-line" data-slug="${esc(l.slug)}" data-line='${esc(line)}'>
      <div class="cart-line__media" style="background:${tintFor(l.art)}">${productArt(l.art, l.name)}</div>
      <div>
        <p class="cart-line__name"><a href="/product?slug=${encodeURIComponent(l.slug)}">${esc(l.name)}</a></p>
        <p class="cart-line__meta">${money(l.price_cents)} each${l.size ? ` · ${esc(l.size)}` : ''}</p>
        <label class="field" style="margin-top:.6rem;max-width:34ch">
          <span class="sr-only">Note for ${esc(l.name)}</span>
          <input class="input" type="text" data-note maxlength="120"
                 placeholder="Add a note for this item"
                 value="${esc(l.note || '')}" style="min-height:40px;font-size:.88rem">
        </label>
        <p>
          <button class="cart-remove" type="button" data-remove="${esc(l.slug)}">
            Remove<span class="sr-only"> ${esc(l.name)}</span>
          </button>
        </p>
      </div>
      <div class="cart-line__end">
        <div class="qty">
          <button type="button" data-step="-1" aria-label="One fewer ${esc(l.name)}">−</button>
          <input type="number" value="${l.qty}" min="1" max="99" data-qty
                 aria-label="Quantity of ${esc(l.name)}">
          <button type="button" data-step="1" aria-label="One more ${esc(l.name)}">+</button>
        </div>
        <span class="price">${money(l.price_cents * l.qty)}</span>
      </div>
    </div>`;
}

function shippingFor(subtotal) {
  if (fulfilment === 'collection') return 0;
  return subtotal >= shop.free_over_cents ? 0 : shop.shipping_cents;
}

function renderTotals() {
  const subtotal = cart.subtotal();
  const shipping = shippingFor(subtotal);
  const total = subtotal + shipping;

  totalsEl.innerHTML = `
    <div class="totals"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="totals">
      <span>${fulfilment === 'collection' ? 'Collection' : 'Delivery'}</span>
      <span>${shipping === 0 ? 'Free' : money(shipping)}</span>
    </div>
    <div class="totals totals--grand"><span>Total</span><span>${money(total)}</span></div>`;

  const target = shop.free_over_cents;
  const remaining = Math.max(0, target - subtotal);
  meter.parentElement.style.display = fulfilment === 'collection' ? 'none' : '';
  meter.style.width = `${Math.min(100, (subtotal / target) * 100)}%`;

  if (fulfilment === 'collection') {
    shipNote.textContent = 'Collecting in shop — no delivery charge, ready within the hour.';
  } else if (remaining === 0) {
    shipNote.textContent = 'Delivery is on us.';
  } else {
    shipNote.textContent = `${money(remaining)} more and the delivery is free.`;
  }
}

function render() {
  const lines = cart.lines();

  if (!lines.length) {
    layout.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  layout.hidden = false;
  emptyEl.hidden = true;
  linesEl.innerHTML = lines.map(renderLine).join('');
  renderTotals();
}

/* -------------------------------------------------------------- controls - */

linesEl.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    const name = JSON.parse(remove.closest('[data-line]').dataset.line).name;
    cart.remove(remove.dataset.remove);
    render();
    announce(`${name} removed from your basket.`);
    return;
  }

  const step = event.target.closest('[data-step]');
  if (step) {
    const node = step.closest('[data-slug]');
    const input = node.querySelector('[data-qty]');
    const next = Math.min(99, Math.max(1, (Number(input.value) || 1) + Number(step.dataset.step)));
    cart.setQty(node.dataset.slug, next);
    render();
    announce(`Quantity ${next}.`);
  }
});

linesEl.addEventListener('change', (event) => {
  if (!event.target.matches('[data-qty]')) return;
  const node = event.target.closest('[data-slug]');
  cart.setQty(node.dataset.slug, Math.min(99, Math.max(1, Number(event.target.value) || 1)));
  render();
});

/**
 * Notes save as they are typed but never re-render: the input keeps focus,
 * and a note is display-only until the server reads it back.
 */
linesEl.addEventListener('input', (event) => {
  if (!event.target.matches('[data-note]')) return;
  cart.setNote(event.target.closest('[data-slug]').dataset.slug, event.target.value);
});

document.querySelectorAll('[name="fulfilment"]').forEach((input) => {
  if (input.value === fulfilment) input.checked = true;
  input.addEventListener('change', () => {
    fulfilment = input.value;
    checkout.write({ fulfilment });
    renderTotals();
  });
});

orderNote.value = checkout.read().notes || '';
orderNote.addEventListener('input', () => checkout.write({ notes: orderNote.value }));

window.addEventListener('cart:change', render);

/* ----------------------------------------------------------------- boot -- */

(async function boot() {
  try {
    shop = await api.get('/api/shop');
  } catch (_) {
    /* the defaults above are the same numbers; carry on */
  }
  render();
})();
