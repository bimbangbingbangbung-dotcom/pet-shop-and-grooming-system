/**
 * Basket. Quantities live in localStorage and update the page instantly;
 * the server re-prices every line and holds the stock, so nothing here is
 * trusted — it is all display until "Place order".
 */

import { api, ApiError } from './api.js';
import { cart } from './cart.js';
import {
  hydrateChrome, esc, money, announce,
  showFieldError, clearFieldErrors, paintApiError, clearBanner, withBusy,
} from './ui.js';
import { productArt, tintFor } from './art.js';

hydrateChrome();

const layout = document.querySelector('[data-cart-layout]');
const emptyEl = document.querySelector('[data-empty]');
const linesEl = document.querySelector('[data-lines]');
const totalsEl = document.querySelector('[data-totals]');
const meter = document.querySelector('[data-ship-meter] span');
const shipNote = document.querySelector('[data-ship-note]');
const form = document.querySelector('[data-form="checkout"]');
const alertBox = document.querySelector('[data-alert]');
const addressField = document.querySelector('[data-address-field]');
const placeBtn = document.querySelector('[data-place]');

/** Forms expose their own `name` property, so named access needs asking twice. */
const field = (n) => form.querySelector(`[name="${n}"]`);

let shop = { shipping_cents: 395, free_over_cents: 4000 };
let fulfilment = 'delivery';

/* --------------------------------------------------------------- render -- */

function renderLine(l) {
  const line = JSON.stringify({ slug: l.slug, name: l.name, price_cents: l.price_cents, art: l.art, size: l.size });
  return `
    <div class="cart-line" data-slug="${esc(l.slug)}" data-line='${esc(line)}'>
      <div class="cart-line__media" style="background:${tintFor(l.art)}">${productArt(l.art, l.name)}</div>
      <div>
        <p class="cart-line__name"><a href="/product?slug=${encodeURIComponent(l.slug)}">${esc(l.name)}</a></p>
        <p class="cart-line__meta">${money(l.price_cents)} each${l.size ? ` · ${esc(l.size)}` : ''}</p>
        <p style="margin-top:.4rem">
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

document.querySelectorAll('[name="fulfilment"]').forEach((input) => {
  input.addEventListener('change', () => {
    fulfilment = input.value;
    addressField.hidden = fulfilment === 'collection';
    clearBanner(alertBox);
    renderTotals();
  });
});

window.addEventListener('cart:change', render);

/* --------------------------------------------------------------- submit --- */

function validate() {
  clearFieldErrors(form);
  let ok = true;

  if (field('name').value.trim().length < 2) {
    showFieldError(form, 'name', 'Your name needs at least 2 characters.');
    ok = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(field('email').value.trim())) {
    showFieldError(form, 'email', 'Enter an email we can send the receipt to.');
    ok = false;
  }
  if (field('phone').value.trim() && !/^[0-9+()\s-]{7,24}$/.test(field('phone').value.trim())) {
    showFieldError(form, 'phone', 'That phone number does not look right.');
    ok = false;
  }
  if (fulfilment === 'delivery' && field('address').value.trim().length < 8) {
    showFieldError(form, 'address', 'We need a full address to deliver to.');
    ok = false;
  }

  if (!ok) {
    alertBox.dataset.visible = 'true';
    alertBox.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.querySelector('[data-invalid="true"] input')?.focus();
  }
  return ok;
}

async function placeOrder() {
  clearBanner(alertBox);
  if (!cart.lines().length) return;
  if (!validate()) return;

  const payload = {
    items: cart.lines().map((l) => ({ slug: l.slug, qty: l.qty })),
    name: field('name').value.trim(),
    email: field('email').value.trim(),
    phone: field('phone').value.trim(),
    address: field('address').value.trim(),
    fulfilment,
  };

  try {
    const result = await withBusy(placeBtn, 'Placing order…', () => api.post('/api/orders', payload));
    cart.clear();
    announce(`Order ${result.order.ref} placed.`);
    location.href = `/done?kind=order&ref=${encodeURIComponent(result.order.ref)}`;
  } catch (err) {
    paintApiError(form, alertBox, err);

    // A line that changed stock: point at the basket line that caused it.
    if (err instanceof ApiError) {
      const slugs = new Set(cart.lines().map((l) => l.slug));
      const bad = err.details.find((d) => slugs.has(d.field));
      if (bad) {
        const node = linesEl.querySelector(`[data-slug="${CSS.escape(bad.field)}"]`);
        if (node) {
          linesEl.querySelector('[data-problem="true"]')?.removeAttribute('data-problem');
          node.setAttribute('data-problem', 'true');
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
  }
}

placeBtn.addEventListener('click', placeOrder);

/* ----------------------------------------------------------------- boot -- */

async function boot() {
  try {
    shop = await api.get('/api/shop');
  } catch (_) {
    /* the defaults above are the same numbers; carry on */
  }
  render();
}

addressField.hidden = false;
boot();
