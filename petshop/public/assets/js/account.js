/**
 * Customer account. One guard at the top — a signed-out visitor is sent to
 * the sign-in page with `?next=` — and then four lazy-loaded panels.
 */

import { api } from './api.js';
import {
  hydrateChrome, requireAccount, signOut, setAccount,
  esc, money, dateLong, stamp, statusTrack, statusBadge,
  state, wireRetry, announce, toast,
  showFieldError, clearFieldErrors, paintApiError, clearBanner, withBusy,
} from './ui.js';

hydrateChrome();

const at = (selector) => document.querySelector(selector);

const ORDER_STEPS = ['paid', 'picking', 'shipped'];
const ORDER_LABELS = { paid: 'Confirmed', picking: 'Packing', shipped: 'On the way' };
const BOOKING_STEPS = ['confirmed', 'arrived', 'complete'];
const BOOKING_LABELS = { confirmed: 'Booked in', arrived: 'Arrived', complete: 'Finished' };

const KIND_LABEL = { order: 'Shop order', booking: 'Grooming appointment' };

/* ------------------------------------------------------------- renderers - */

function orderRow(o) {
  const items = o.items.map((i) => `${i.qty} × ${esc(i.name)}`).join(', ');
  const labels = { ...ORDER_LABELS };
  if (o.fulfilment === 'collection') labels.shipped = 'Ready to collect';
  const headline = o.fulfilment === 'collection' ? 'Collect in shop' : 'Delivery';

  return `<article class="acct-row">
    <div class="acct-row__main">
      <p class="acct-row__ref">${esc(o.ref)}</p>
      <p class="acct-row__title">${items}</p>
      <p class="acct-row__meta">${headline} · ${esc(o.address)}</p>
      <p class="acct-row__meta">Placed ${stamp(o.created_at)}</p>
      ${statusTrack(o.status, ORDER_STEPS, labels)}
    </div>
    <div class="acct-row__end">
      <span class="acct-row__amount">${money(o.total_cents)}</span>
      ${statusBadge(o.status)}
      <a class="linkish" href="/done?kind=order&ref=${encodeURIComponent(o.ref)}">Receipt &amp; status</a>
    </div>
  </article>`;
}

function bookingRow(b) {
  return `<article class="acct-row">
    <div class="acct-row__main">
      <p class="acct-row__ref">${esc(b.ref)}</p>
      <p class="acct-row__title">${esc(b.service)} for ${esc(b.pet_name)}</p>
      <p class="acct-row__meta">${esc(dateLong(b.date))} · ${esc(b.start_label)} to ${esc(b.end_label)}</p>
      <p class="acct-row__meta">${esc(b.pet_type)}${b.breed ? ` · ${esc(b.breed)}` : ''} · ${esc(b.pet_size)}</p>
      ${statusTrack(b.status, BOOKING_STEPS, BOOKING_LABELS)}
    </div>
    <div class="acct-row__end">
      <span class="acct-row__amount">${money(b.price_cents)}</span>
      ${statusBadge(b.status)}
      <a class="linkish" href="/done?kind=booking&ref=${encodeURIComponent(b.ref)}">Appointment details</a>
    </div>
  </article>`;
}

function paymentRow(p) {
  const amount = `${p.status === 'refunded' ? '−' : ''}${money(p.amount_cents)}`;
  return `<article class="acct-row">
    <div class="acct-row__main">
      <p class="acct-row__ref">${esc(p.ref)}</p>
      <p class="acct-row__title">${esc(KIND_LABEL[p.kind] || p.kind)}</p>
      <p class="acct-row__meta">${esc(p.method.toUpperCase())} · ${esc(p.detail || '—')}</p>
      <p class="acct-row__meta">${stamp(p.paid_at || p.created_at)}${p.reference ? ` · ref ${esc(p.reference)}` : ''}</p>
    </div>
    <div class="acct-row__end">
      <span class="acct-row__amount">${esc(amount)}</span>
      ${statusBadge(p.status)}
      ${p.order_ref ? `<a class="linkish" href="/done?kind=order&ref=${encodeURIComponent(p.order_ref)}">View order</a>` : ''}
      ${p.booking_ref ? `<a class="linkish" href="/done?kind=booking&ref=${encodeURIComponent(p.booking_ref)}">View appointment</a>` : ''}
    </div>
  </article>`;
}

function empty(title, body) {
  return state.empty(title, body);
}

/* ---------------------------------------------------------------- panels - */

const panels = {
  orders: {
    node: at('[data-orders]'),
    load: async () => {
      const data = await api.get('/api/account/orders');
      panels.orders.node.innerHTML = data.orders.length
        ? data.orders.map(orderRow).join('')
        : empty('No orders yet', 'When you order something, it shows up here with its receipt and where it has got to.');
    },
  },
  bookings: {
    node: at('[data-bookings]'),
    load: async () => {
      const data = await api.get('/api/account/bookings');
      panels.bookings.node.innerHTML = data.bookings.length
        ? data.bookings.map(bookingRow).join('')
        : empty('No appointments yet', 'Pick a day that suits you and the grooming table is yours.');
    },
  },
  payments: {
    node: at('[data-payments]'),
    load: async () => {
      const data = await api.get('/api/account/payments');
      panels.payments.node.innerHTML = data.payments.length
        ? data.payments.map(paymentRow).join('')
        : empty('Nothing paid yet', 'Receipts for shop orders and grooming appointments collect here.');
    },
  },
  details: { node: at('[data-panel="details"]'), load: async () => {} },
};

const loaded = new Set();

async function openPanel(name) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  });
  for (const [key, panel] of Object.entries(panels)) {
    if (panel.node) panel.node.closest('[role="tabpanel"]').hidden = key !== name;
  }

  if (loaded.has(name)) return;
  const panel = panels[name];
  if (!panel) return;
  panel.node.setAttribute('aria-busy', 'true');
  try {
    await panel.load();
    loaded.add(name);
  } catch (err) {
    panel.node.innerHTML = state.error(err.message, name);
    wireRetry(panel.node, () => { loaded.delete(name); openPanel(name); });
  } finally {
    panel.node.removeAttribute('aria-busy');
  }
}

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => openPanel(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const list = [...document.querySelectorAll('[data-tab]')];
    const next = list[(list.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.focus();
    openPanel(next.dataset.tab);
  });
});

/* --------------------------------------------------------------- forms --- */

const detailsForm = at('[data-form="details"]');
const passwordForm = at('[data-form="password"]');

/** Forms expose their own `name` property, so named access needs asking twice. */
const fieldOf = (form, n) => form.querySelector(`[name="${n}"]`);

detailsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const banner = detailsForm.querySelector('[data-alert]');
  clearFieldErrors(detailsForm);
  clearBanner(banner);

  const name = fieldOf(detailsForm, 'name').value.trim();
  if (name.length < 2) {
    showFieldError(detailsForm, 'name', 'Your name needs at least 2 characters.');
    banner.dataset.visible = 'true';
    banner.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    return;
  }

  try {
    const result = await withBusy(detailsForm.querySelector('[type="submit"]'), 'Saving…', () =>
      api.patch('/api/account', {
        name,
        phone: fieldOf(detailsForm, 'phone').value.trim(),
        address: fieldOf(detailsForm, 'address').value.trim(),
      }));
    setAccount(result.customer);
    banner.dataset.visible = 'true';
    banner.classList.add('form-alert--ok');
    banner.querySelector('[data-alert-text]').textContent = 'Saved.';
    toast('Details saved.', 'ok');
    announce('Your details were saved.');
  } catch (err) {
    paintApiError(detailsForm, banner, err);
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const banner = passwordForm.querySelector('[data-alert]');
  clearFieldErrors(passwordForm);
  clearBanner(banner);
  banner.classList.remove('form-alert--ok');

  const current = fieldOf(passwordForm, 'current').value;
  const password = fieldOf(passwordForm, 'password').value;
  let ok = true;
  if (!current) { showFieldError(passwordForm, 'current', 'Enter your current password.'); ok = false; }
  if (password.length < 8) { showFieldError(passwordForm, 'password', 'Use at least 8 characters.'); ok = false; }
  if (!ok) {
    banner.dataset.visible = 'true';
    banner.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    return;
  }

  try {
    await withBusy(passwordForm.querySelector('[type="submit"]'), 'Changing…', () =>
      api.post('/api/account/password', { current, password }));
    passwordForm.reset();
    banner.dataset.visible = 'true';
    banner.classList.add('form-alert--ok');
    banner.querySelector('[data-alert-text]').textContent = 'Password changed.';
    toast('Password changed.', 'ok');
  } catch (err) {
    paintApiError(passwordForm, banner, err);
  }
});

at('[data-signout]').addEventListener('click', async () => {
  await signOut();
  toast('Signed out.', 'ok');
  location.href = '/login';
});

/* ----------------------------------------------------------------- boot -- */

(async function boot() {
  const customer = await requireAccount();
  if (!customer) return;

  at('[data-account-title]').textContent = `Hello, ${customer.name.split(' ')[0]}`;
  at('[data-account-lede]').textContent =
    `${customer.email} — your orders, receipts and appointments in one place.`;
  document.title = 'Your account — Snip & Snout';

  fieldOf(detailsForm, 'name').value = customer.name || '';
  fieldOf(detailsForm, 'phone').value = customer.phone || '';
  fieldOf(detailsForm, 'address').value = customer.address || '';

  await openPanel('orders');
})();
