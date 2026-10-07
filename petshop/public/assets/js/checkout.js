/**
 * Checkout: details, then payment. Everything is priced by the server — the
 * totals here exist so the customer knows what they are about to authorise,
 * and are re-derived from the database before the order is written.
 */

import { api, ApiError } from './api.js';
import { cart, checkout } from './cart.js';
import {
  hydrateChrome, account, esc, money, announce, toast,
  showFieldError, clearFieldErrors, paintApiError, clearBanner, withBusy,
} from './ui.js';
import { productArt, tintFor } from './art.js';

hydrateChrome();

const layout = document.querySelector('[data-checkout-layout]');
const emptyEl = document.querySelector('[data-empty]');
const linesEl = document.querySelector('[data-lines]');
const totalsEl = document.querySelector('[data-totals]');
const meter = document.querySelector('[data-ship-meter] span');
const shipNote = document.querySelector('[data-ship-note]');
const form = document.querySelector('[data-form="checkout"]');
const banner = document.querySelector('[data-alert]');
const addressField = document.querySelector('[data-address-field]');
const placeBtn = document.querySelector('[data-place]');
const noteField = form.querySelector('[data-order-note]');

const field = (n) => form.querySelector(`[name="${n}"]`);

const DETAIL_COPY = {
  card: {
    label: 'Card number',
    hint: 'Any 12–19 digits will do — this is a demonstration build.',
    placeholder: '4242 4242 4242 4242',
    autocomplete: 'cc-number',
    maxlength: '23',
  },
  gcash: {
    label: 'GCash mobile number',
    hint: 'The 11-digit number on your wallet account.',
    placeholder: '09171234567',
    autocomplete: 'tel-national',
    maxlength: '11',
  },
  maya: {
    label: 'Maya mobile number',
    hint: 'The 11-digit number on your wallet account.',
    placeholder: '09171234567',
    autocomplete: 'tel-national',
    maxlength: '11',
  },
  cod: null,
};

let shop = { shipping_cents: 15000, free_over_cents: 250000 };
let fulfilment = checkout.read().fulfilment === 'collection' ? 'collection' : 'delivery';
let method = checkout.read().payment_method || 'card';

/* --------------------------------------------------------------- render -- */

function renderLines() {
  linesEl.innerHTML = cart.lines().map((l) => `
    <div class="receipt__line">
      <span>${l.qty} × ${esc(l.name)}${l.note ? `<br><span class="note-inline">${esc(l.note)}</span>` : ''}</span>
      <span>${money(l.price_cents * l.qty)}</span>
    </div>`).join('');
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

  const remaining = Math.max(0, shop.free_over_cents - subtotal);
  meter.parentElement.style.display = fulfilment === 'collection' ? 'none' : '';
  meter.style.width = `${Math.min(100, (subtotal / shop.free_over_cents) * 100)}%`;
  shipNote.textContent = fulfilment === 'collection'
    ? 'Collecting in shop — no delivery charge, ready within the hour.'
    : remaining === 0
      ? 'Delivery is on us.'
      : `${money(remaining)} more and the delivery is free.`;
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
  renderLines();
  renderTotals();
  paintButton();
}

/* ------------------------------------------------------- payment choices - */

let paintedMethod = null;

function paintButton() {
  const total = cart.subtotal() + shippingFor(cart.subtotal());
  placeBtn.textContent = method === 'cod' ? 'Place order' : `Pay ${money(total)}`;
}

/**
 * Only wipes the payment field when the method actually changed — a cart
 * re-render must never delete the number being typed.
 */
function paintMethod() {
  const copy = DETAIL_COPY[method];
  const changed = paintedMethod !== method;
  paintedMethod = method;

  form.querySelector('[data-pay-detail]').hidden = !copy;
  form.querySelector('[data-pay-card]').hidden = method !== 'card';
  form.querySelector('[data-pay-cod]').hidden = method !== 'cod';
  paintButton();

  if (copy) {
    form.querySelector('[data-detail-label]').textContent = copy.label;
    form.querySelector('[data-detail-hint]').textContent = copy.hint;
    const input = field('paymentDetail');
    input.placeholder = copy.placeholder;
    input.autocomplete = copy.autocomplete;
    input.maxLength = Number(copy.maxlength);
    if (changed) input.value = '';
  }
  checkout.write({ payment_method: method });
}

document.querySelectorAll('[name="fulfilment"]').forEach((input) => {
  if (input.value === fulfilment) input.checked = true;
  input.addEventListener('change', () => {
    fulfilment = input.value;
    checkout.write({ fulfilment });
    addressField.hidden = fulfilment === 'collection';
    clearBanner(banner);
    renderTotals();
    paintMethod();
  });
});

document.querySelectorAll('[name="payment_method"]').forEach((input) => {
  if (input.value === method) input.checked = true;
  input.addEventListener('change', () => {
    method = input.value;
    clearFieldErrors(form);
    clearBanner(banner);
    paintMethod();
  });
});

window.addEventListener('cart:change', render);

/* ------------------------------------------------------------- validate -- */

function validate() {
  clearFieldErrors(form);
  let ok = true;

  if (field('name').value.trim().length < 2) {
    showFieldError(form, 'name', 'Your name needs at least 2 characters.'); ok = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(field('email').value.trim())) {
    showFieldError(form, 'email', 'Enter an email we can send the receipt to.'); ok = false;
  }
  if (field('phone').value.trim() && !/^[0-9+()\s-]{7,24}$/.test(field('phone').value.trim())) {
    showFieldError(form, 'phone', 'That phone number does not look right.'); ok = false;
  }
  if (fulfilment === 'delivery' && field('address').value.trim().length < 8) {
    showFieldError(form, 'address', 'We need a full address to deliver to.'); ok = false;
  }

  if (method === 'card') {
    const number = field('paymentDetail').value.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(number)) {
      showFieldError(form, 'paymentDetail', 'Enter a 12–19 digit card number.'); ok = false;
    }
    if (field('cardName').value.trim().length < 2) {
      showFieldError(form, 'cardName', 'Enter the name on the card.'); ok = false;
    }
    if (!/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/.test(field('cardExpiry').value.trim())) {
      showFieldError(form, 'cardExpiry', 'Use the expiry as MM/YY.'); ok = false;
    }
    if (!/^\d{3,4}$/.test(field('cardCvv').value.trim())) {
      showFieldError(form, 'cardCvv', 'Enter the 3-digit code on the back.'); ok = false;
    }
  } else if (method === 'gcash' || method === 'maya') {
    if (!/^09\d{9}$/.test(field('paymentDetail').value.replace(/\s/g, ''))) {
      showFieldError(form, 'paymentDetail', 'Enter the 11-digit mobile number for the wallet.'); ok = false;
    }
  }

  if (!ok) {
    banner.dataset.visible = 'true';
    banner.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    banner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    form.querySelector('[data-invalid="true"] input, [data-invalid="true"] textarea')?.focus();
  }
  return ok;
}

/* --------------------------------------------------------------- submit -- */

async function placeOrder() {
  clearBanner(banner);
  const lines = cart.lines();
  if (!lines.length) return;
  if (!validate()) return;

  const payload = {
    items: lines.map((l) => ({ slug: l.slug, qty: l.qty, note: l.note || '' })),
    name: field('name').value.trim(),
    email: field('email').value.trim(),
    phone: field('phone').value.trim(),
    address: field('address').value.trim(),
    fulfilment,
    notes: noteField.value.trim(),
    payment_method: method,
    paymentDetail: field('paymentDetail').value.trim(),
    cardName: field('cardName').value.trim(),
    cardExpiry: field('cardExpiry').value.trim(),
    cardCvv: field('cardCvv').value.trim(),
  };

  try {
    const result = await withBusy(placeBtn, 'Placing order…', () => api.post('/api/orders', payload));
    cart.clear();
    checkout.clear();
    announce(`Order ${result.order.ref} placed.`);
    location.href = `/done?kind=order&ref=${encodeURIComponent(result.order.ref)}`;
  } catch (err) {
    paintApiError(form, banner, err);

    if (err instanceof ApiError) {
      const slugs = new Set(lines.map((l) => l.slug));
      const bad = err.details.find((d) => slugs.has(d.field));
      if (bad) {
        toast('Back to the basket — something in it changed.', 'warn');
        location.href = '/cart';
        return;
      }
      const first = Object.keys(err.fields)[0];
      if (first) form.querySelector(`[name="${CSS.escape(first)}"]`)?.focus();
    }
  }
}

placeBtn.addEventListener('click', placeOrder);

/* ----------------------------------------------------------------- boot -- */

async function boot() {
  try {
    shop = await api.get('/api/shop');
  } catch (_) {
    /* defaults are the same numbers; carry on */
  }

  noteField.value = checkout.read().notes || '';
  noteField.addEventListener('input', () => checkout.write({ notes: noteField.value }));

  // Signed-in customers should not have to type their own address twice.
  try {
    const { customer } = await account();
    if (customer) {
      if (!field('name').value) field('name').value = customer.name || '';
      if (!field('email').value) field('email').value = customer.email || '';
      if (!field('phone').value) field('phone').value = customer.phone || '';
      if (!field('address').value) field('address').value = customer.address || '';
    }
  } catch (_) {
    /* guest checkout is a first-class path */
  }

  addressField.hidden = fulfilment === 'collection';
  render();
  paintMethod();
}

boot();
