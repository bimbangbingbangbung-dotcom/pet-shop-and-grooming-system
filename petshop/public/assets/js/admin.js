/**
 * Staff console. Read views are fetched on entry; every mutation is one
 * PATCH that re-fetches what it changed, so a table never drifts.
 *
 * Each view owns static containers in the HTML and writes only into those —
 * clearing the panel itself would take the nodes it writes to along with it.
 */

import { api, ApiError } from './api.js';
import { esc, money, dateShort, isoToday, announce, toast, showFieldError, clearFieldErrors, withBusy } from './ui.js';

const loginWrap = document.querySelector('[data-login]');
const consoleWrap = document.querySelector('[data-console]');
const loginForm = document.querySelector('[data-form="login"]');
const loginAlert = loginForm.querySelector('[data-alert]');
const titleEl = document.querySelector('[data-title]');

const BOOKING_STATUSES = ['confirmed', 'arrived', 'complete', 'cancelled'];
const ORDER_STATUSES = ['paid', 'picking', 'shipped', 'cancelled'];

const TITLES = { today: 'Today', bookings: 'Bookings', orders: 'Orders', stock: 'Stock' };

let currentView = 'today';

const at = (selector) => document.querySelector(selector);
const loading = () => '<p class="muted" style="padding:1rem">Loading…</p>';

/* ------------------------------------------------------------- helpers --- */

function table(headers, rows, empty) {
  if (!rows.length) return `<p class="muted" style="padding:1rem">${esc(empty)}</p>`;
  return `<table class="adm-table">
    <thead><tr>${headers.map((h) => `<th${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function statusSelect(kind, id, status) {
  const list = kind === 'booking' ? BOOKING_STATUSES : ORDER_STATUSES;
  return `<label class="sr-only" for="st-${kind}-${id}">Status</label>
    <select class="select" id="st-${kind}-${id}" data-status="${kind}" data-id="${id}">
      ${list.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
    </select>`;
}

function stamp(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return esc(value);
  return esc(new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date));
}

function paintError(node, err) {
  node.innerHTML = `<div class="state">
    <p class="state__title">That did not load</p>
    <p class="state__body">${esc(err.message)}</p>
    <button class="btn btn--ghost" type="button" data-reload>Try again</button>
  </div>`;
  node.querySelector('[data-reload]').addEventListener('click', () => load(currentView), { once: true });
}

/* ------------------------------------------------------------- mutations - */

async function changeStatus(select) {
  const kind = select.dataset.status;
  const id = select.dataset.id;
  const path = kind === 'booking' ? `/api/admin/bookings/${id}` : `/api/admin/orders/${id}`;

  select.disabled = true;
  try {
    await api.patch(path, { status: select.value });
    toast(`${kind === 'booking' ? 'Booking' : 'Order'} marked ${select.value}.`, 'ok');
    announce('Saved.');
  } catch (err) {
    toast(err.message, 'warn');
    await load(currentView);
  } finally {
    select.disabled = false;
  }
}

async function changeStock(input) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 0) {
    toast('Stock must be 0 or more.', 'warn');
    return;
  }
  input.disabled = true;
  try {
    await api.patch(`/api/admin/products/${input.dataset.id}`, { stock: value });
    toast('Stock saved.', 'ok');
  } catch (err) {
    toast(err.message, 'warn');
    await load('stock');
  } finally {
    input.disabled = false;
  }
}

/* ---------------------------------------------------------------- views -- */

async function loadToday() {
  const statsEl = at('[data-stats]');
  const tableEl = at('[data-today-bookings]');
  const lowEl = at('[data-low-stock]');

  tableEl.innerHTML = loading();
  lowEl.innerHTML = loading();

  try {
    const stats = await api.get('/api/admin/stats');

    statsEl.innerHTML = `
      <div class="stat"><p class="stat__label">Grooms today</p><p class="stat__value">${stats.bookings_today.length}</p></div>
      <div class="stat"><p class="stat__label">Still to come</p><p class="stat__value">${stats.bookings_pending}</p></div>
      <div class="stat"><p class="stat__label">Orders to send</p><p class="stat__value">${stats.orders_open}</p></div>
      <div class="stat stat--accent"><p class="stat__label">Taken all time</p><p class="stat__value">${money(stats.revenue_cents)}</p></div>`;

    tableEl.innerHTML = table(
      [{ label: 'Time' }, { label: 'Pet' }, { label: 'Service' }, { label: 'Owner' }, { label: 'Phone' }, { label: 'Status' }],
      stats.bookings_today.map((b) => `
        <tr>
          <td class="num">${esc(b.start_label)}</td>
          <td><strong>${esc(b.pet_name)}</strong></td>
          <td>${esc(b.service)}</td>
          <td>${esc(b.owner_name)}</td>
          <td>${esc(b.phone)}</td>
          <td>${statusSelect('booking', b.id, b.status)}</td>
        </tr>`),
      'No grooms booked in today.'
    );

    lowEl.innerHTML = table(
      [{ label: 'Product' }, { label: 'Category' }, { label: 'Price', num: true }, { label: 'Left', num: true }],
      stats.low_stock.map((p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${esc(p.category_name)}</td>
          <td class="num">${money(p.price_cents)}</td>
          <td class="num">${p.stock === 0
            ? '<span class="badge badge--out">Out</span>'
            : `<span class="badge badge--low">${p.stock}</span>`}</td>
        </tr>`),
      'Everything is above ten. Rare.'
    );
  } catch (err) {
    paintError(tableEl, err);
    lowEl.innerHTML = '';
  }
}

async function loadBookings() {
  const node = at('[data-bookings]');
  node.innerHTML = loading();

  const status = at('[data-bk-status]').value;
  const from = at('[data-bk-from]').value;
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (from) query.set('from', from);

  try {
    const data = await api.get(`/api/admin/bookings?${query}`);
    node.innerHTML = table(
      [{ label: 'Day' }, { label: 'Time' }, { label: 'Pet' }, { label: 'Service' },
       { label: 'Owner' }, { label: 'Price', num: true }, { label: 'Status' }],
      data.bookings.map((b) => `
        <tr>
          <td class="num">${esc(dateShort(b.date))}</td>
          <td class="num">${esc(b.start_label)}</td>
          <td><strong>${esc(b.pet_name)}</strong><br><span class="muted">${esc(b.pet_size)}</span></td>
          <td>${esc(b.service)}</td>
          <td>${esc(b.owner_name)}<br><span class="muted">${esc(b.phone)}</span></td>
          <td class="num">${money(b.price_cents)}</td>
          <td>${statusSelect('booking', b.id, b.status)}</td>
        </tr>`),
      'No bookings match that filter.'
    );
    at('[data-bk-count]').textContent =
      `${data.bookings.length} booking${data.bookings.length === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

async function loadOrders() {
  const node = at('[data-orders]');
  node.innerHTML = loading();

  try {
    const data = await api.get('/api/admin/orders');
    node.innerHTML = table(
      [{ label: 'Ref' }, { label: 'Customer' }, { label: 'Items' }, { label: 'Total', num: true },
       { label: 'How' }, { label: 'Status' }, { label: 'Placed', num: true }],
      data.orders.map((o) => `
        <tr>
          <td class="tnum">${esc(o.ref)}</td>
          <td>${esc(o.name)}<br><span class="muted">${esc(o.email)}</span></td>
          <td>${o.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('<br>')}</td>
          <td class="num">${money(o.total_cents)}</td>
          <td>${o.fulfilment === 'collection' ? 'Collect' : 'Delivery'}</td>
          <td>${statusSelect('order', o.id, o.status)}</td>
          <td class="num">${stamp(o.created_at)}</td>
        </tr>`),
      'No orders yet.'
    );
    at('[data-order-count]').textContent =
      `${data.orders.length} order${data.orders.length === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

async function loadStock() {
  const node = at('[data-stock-table]');
  node.innerHTML = loading();

  try {
    const data = await api.get('/api/admin/products?all=1');
    node.innerHTML = table(
      [{ label: 'Product' }, { label: 'Category' }, { label: 'Price', num: true },
       { label: 'Stock', num: true }, { label: 'Level' }],
      data.products.map((p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong>${p.active ? '' : ' <span class="badge badge--out">Hidden</span>'}</td>
          <td>${esc(p.category_name)}</td>
          <td class="num">${money(p.price_cents)}</td>
          <td class="num">
            <label class="sr-only" for="stock-${p.id}">Stock for ${esc(p.name)}</label>
            <input class="input" id="stock-${p.id}" type="number" min="0" step="1" value="${p.stock}"
                   data-id="${p.id}" data-stock style="width:96px;min-height:36px;padding:.3rem .5rem">
          </td>
          <td>${p.stock === 0 ? '<span class="badge badge--out">Out of stock</span>'
               : p.stock <= 10 ? '<span class="badge badge--low">Running low</span>'
               : '<span class="badge badge--ok">Healthy</span>'}</td>
        </tr>`),
      'No products in the catalogue.'
    );
    at('[data-stock-count]').textContent =
      `${data.products.length} product${data.products.length === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

const LOADERS = { today: loadToday, bookings: loadBookings, orders: loadOrders, stock: loadStock };

function load(view) {
  const loader = LOADERS[view];
  return loader ? loader() : Promise.resolve();
}

function showView(view) {
  currentView = view;
  titleEl.textContent = TITLES[view] || 'Staff console';

  document.querySelectorAll('[data-view]').forEach((btn) => {
    if (btn.dataset.view === view) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.dataset.active = String(panel.dataset.viewPanel === view);
  });

  load(view);
}

/* ---------------------------------------------------------------- auth --- */

function enter(admin) {
  loginWrap.hidden = true;
  consoleWrap.hidden = false;
  at('[data-who]').innerHTML =
    `${esc(admin.name)}<br><span style="opacity:.75">${esc(admin.email)}</span>`;
  document.title = 'Staff console — Snip & Snout';
  showView('today');
}

function showLogin() {
  consoleWrap.hidden = true;
  loginWrap.hidden = false;
  document.title = 'Staff sign-in — Snip & Snout';
  loginForm.email.focus();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(loginForm);
  loginAlert.dataset.visible = 'false';

  const email = loginForm.email.value.trim();
  const password = loginForm.password.value;

  let ok = true;
  if (!email) { showFieldError(loginForm, 'email', 'Enter your email address.'); ok = false; }
  if (!password) { showFieldError(loginForm, 'password', 'Enter your password.'); ok = false; }
  if (!ok) return;

  const btn = loginForm.querySelector('[type="submit"]');
  try {
    const result = await withBusy(btn, 'Signing in…', () => api.post('/api/admin/login', { email, password }));
    enter(result.admin);
    toast(`Signed in as ${result.admin.name}.`, 'ok');
  } catch (err) {
    loginAlert.dataset.visible = 'true';
    loginAlert.querySelector('[data-alert-text]').textContent = err.message;
    if (err instanceof ApiError) {
      for (const [field, message] of Object.entries(err.fields)) showFieldError(loginForm, field, message);
    }
    loginForm.password.value = '';
    loginForm.password.focus();
  }
});

at('[data-signout]').addEventListener('click', async () => {
  try { await api.post('/api/admin/logout', {}); } catch (_) { /* already gone */ }
  showLogin();
  toast('Signed out.', 'ok');
});

/* --------------------------------------------------------------- wiring -- */

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

at('[data-refresh]').addEventListener('click', () => load(currentView));

at('[data-goto="stock"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  showView('stock');
});

document.addEventListener('change', (event) => {
  const select = event.target.closest('[data-status]');
  if (select) { changeStatus(select); return; }

  const stock = event.target.closest('[data-stock]');
  if (stock) changeStock(stock);
});

at('[data-bk-status]').addEventListener('change', () => load('bookings'));
at('[data-bk-from]').addEventListener('change', () => load('bookings'));
at('[data-bk-from]').min = isoToday();

/* ----------------------------------------------------------------- boot -- */

(async function boot() {
  try {
    const { admin } = await api.get('/api/admin/me');
    if (admin) enter(admin);
    else showLogin();
  } catch (_) {
    showLogin();
  }
})();
