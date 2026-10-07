/**
 * Staff console. Read views are fetched on entry; every mutation is one
 * PATCH that re-fetches what it changed, so a table never drifts.
 *
 * Each view owns static containers in the HTML and writes only into those —
 * clearing the panel itself would take the nodes it writes to along with it.
 */

import { api, ApiError } from './api.js';
import {
  esc, money, dateShort, isoToday, announce, toast, statusBadge, stamp,
  showFieldError, clearFieldErrors, paintApiError, clearBanner, withBusy,
} from './ui.js';

const loginWrap = document.querySelector('[data-login]');
const consoleWrap = document.querySelector('[data-console]');
const loginForm = document.querySelector('[data-form="login"]');
const loginAlert = loginForm.querySelector('[data-alert]');
const titleEl = document.querySelector('[data-title]');

const BOOKING_STATUSES = ['confirmed', 'arrived', 'complete', 'cancelled'];
const ORDER_STATUSES = ['paid', 'picking', 'shipped', 'cancelled'];

const ORDER_LABELS = { paid: 'Confirmed', picking: 'Packing', shipped: 'Shipped', cancelled: 'Cancelled' };

const PAYMENT_LABELS = { card: 'Card', gcash: 'GCash', maya: 'Maya', cod: 'Cash on delivery', cash: 'Cash' };

const TITLES = {
  today: 'Today',
  bookings: 'Bookings',
  orders: 'Orders',
  products: 'Products',
  transactions: 'Transactions',
  report: 'Sales report',
};

let currentView = 'today';
let productRows = [];

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
  const label = (s) => (kind === 'order' ? ORDER_LABELS[s] : s[0].toUpperCase() + s.slice(1));
  return `<label class="sr-only" for="st-${kind}-${id}">Status</label>
    <select class="select" id="st-${kind}-${id}" data-status="${kind}" data-id="${id}">
      ${list.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}
    </select>`;
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
    await load('products');
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
      <div class="stat stat--accent"><p class="stat__label">Taken all time</p><p class="stat__value">${money(stats.revenue_cents)}</p></div>
      <div class="stat"><p class="stat__label">Shop</p><p class="stat__value">${money(stats.revenue_shop_cents)}</p></div>
      <div class="stat"><p class="stat__label">Grooming</p><p class="stat__value">${money(stats.revenue_grooming_cents)}</p></div>`;

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
       { label: 'Owner' }, { label: 'Price', num: true }, { label: 'Paid' }, { label: 'Status' }],
      data.bookings.map((b) => `
        <tr>
          <td class="num">${esc(dateShort(b.date))}</td>
          <td class="num">${esc(b.start_label)}</td>
          <td><strong>${esc(b.pet_name)}</strong><br><span class="muted">${esc(b.pet_size)}</span></td>
          <td>${esc(b.service)}</td>
          <td>${esc(b.owner_name)}<br><span class="muted">${esc(b.phone)}</span></td>
          <td class="num">${money(b.price_cents)}</td>
          <td>${statusBadge(b.payment_status || 'pending')}</td>
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
    const wanted = at('[data-or-status]').value;
    const orders = wanted ? data.orders.filter((o) => o.status === wanted) : data.orders;

    node.innerHTML = table(
      [{ label: 'Ref' }, { label: 'Customer' }, { label: 'Items' }, { label: 'Total', num: true },
       { label: 'How' }, { label: 'Payment' }, { label: 'Status' }, { label: 'Placed', num: true }],
      orders.map((o) => `
        <tr>
          <td class="tnum">${esc(o.ref)}</td>
          <td>${esc(o.name)}<br><span class="muted">${esc(o.email)}</span></td>
          <td>${o.items.map((i) => `${i.qty} × ${esc(i.name)}${i.note ? `<br><span class="note-inline">${esc(i.note)}</span>` : ''}`).join('<br>')}</td>
          <td class="num">${money(o.total_cents)}</td>
          <td>${o.fulfilment === 'collection' ? 'Collect' : 'Delivery'}<br><span class="muted">${esc(o.payment_method || '')}</span></td>
          <td>${statusBadge(o.payment_status || 'pending')}</td>
          <td>${statusSelect('order', o.id, o.status)}</td>
          <td class="num">${stamp(o.created_at)}</td>
        </tr>`),
      'No orders match that filter.'
    );
    at('[data-order-count]').textContent =
      `${orders.length} of ${data.orders.length} order${data.orders.length === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

async function loadProducts() {
  const node = at('[data-stock-table]');
  node.innerHTML = loading();

  try {
    const data = await api.get('/api/admin/products?all=1');
    productRows = data.products;

    const wanted = at('[data-pd-cat]').value;
    const list = wanted ? data.products.filter((p) => p.category === wanted) : data.products;

    node.innerHTML = table(
      [{ label: 'Product' }, { label: 'Category' }, { label: 'Price', num: true },
       { label: 'Stock', num: true }, { label: 'Level' }, { label: '', num: true }],
      list.map((p) => `
        <tr>
          <td>
            <strong>${esc(p.name)}</strong>
            ${p.featured ? ' <span class="badge badge--live">Featured</span>' : ''}
            ${p.active ? '' : ' <span class="badge badge--out">Hidden</span>'}
            ${p.size ? `<br><span class="muted">${esc(p.size)} · /product?slug=${esc(p.slug)}</span>` : ''}
          </td>
          <td>${esc(p.category_name)}</td>
          <td class="num">${money(p.price_cents)}</td>
          <td class="num">
            <label class="sr-only" for="stock-${p.id}">Stock for ${esc(p.name)}</label>
            <input class="input" id="stock-${p.id}" type="number" min="0" step="1" value="${p.stock}"
                   data-id="${p.id}" data-stock style="width:88px;min-height:36px;padding:.3rem .5rem">
          </td>
          <td>${p.stock === 0 ? '<span class="badge badge--out">Out of stock</span>'
               : p.stock <= 10 ? '<span class="badge badge--low">Running low</span>'
               : '<span class="badge badge--ok">Healthy</span>'}</td>
          <td class="num">
            <span class="row row--end" style="gap:.4rem">
              <button class="icon-btn" type="button" data-product-edit="${p.id}">Edit<span class="sr-only"> ${esc(p.name)}</span></button>
              <button class="icon-btn" type="button" data-product-toggle="${p.id}">${p.active ? 'Hide' : 'Show'}<span class="sr-only"> ${esc(p.name)}</span></button>
              <button class="icon-btn" type="button" data-tone="danger" data-product-del="${p.id}">Delete<span class="sr-only"> ${esc(p.name)}</span></button>
            </span>
          </td>
        </tr>`),
      'No products match that filter.'
    );
    at('[data-stock-count]').textContent =
      `${list.length} of ${data.products.length} product${data.products.length === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

async function loadTransactions() {
  const node = at('[data-transactions]');
  node.innerHTML = loading();

  const query = new URLSearchParams();
  const kind = at('[data-tx-kind]').value;
  const status = at('[data-tx-status]').value;
  const from = at('[data-tx-from]').value;
  const to = at('[data-tx-to]').value;
  if (kind) query.set('kind', kind);
  if (status) query.set('status', status);
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  try {
    const data = await api.get(`/api/admin/payments?${query}`);
    const t = data.totals || {};
    const split = (key) => t[key] || 0;

    at('[data-tx-totals]').innerHTML = `
      <div class="stat"><p class="stat__label">Paid</p><p class="stat__value">${money(split('paid'))}</p></div>
      <div class="stat"><p class="stat__label">Pending</p><p class="stat__value">${money(split('pending'))}</p></div>
      <div class="stat"><p class="stat__label">Refunded</p><p class="stat__value">${money(split('refunded'))}</p></div>
      <div class="stat stat--accent"><p class="stat__label">Shop / grooming</p>
        <p class="stat__value" style="font-size:var(--step-3)">${money(split('order_paid'))} / ${money(split('booking_paid'))}</p>
      </div>`;

    node.innerHTML = table(
      [{ label: 'Receipt' }, { label: 'Type' }, { label: 'Who' }, { label: 'What' },
       { label: 'Method' }, { label: 'Amount', num: true }, { label: 'Status' }, { label: 'When', num: true }],
      data.payments.map((p) => `
        <tr>
          <td class="tnum">${esc(p.ref)}</td>
          <td>${p.kind === 'order' ? 'Shop order' : 'Grooming'}<br>
              <span class="tnum">${esc(p.order_ref || p.booking_ref || '')}</span></td>
          <td>${esc(p.customer_name || 'Guest')}<br><span class="muted">${esc(p.customer_email || '')}</span></td>
          <td>${p.service ? `<strong>${esc(p.service)}</strong><br>` : ''}<span class="muted">${esc(p.detail || '—')}</span></td>
          <td>${esc(PAYMENT_LABELS[p.method] || p.method)}${p.reference ? `<br><span class="muted tnum">${esc(p.reference)}</span>` : ''}</td>
          <td class="num">${money(p.amount_cents)}</td>
          <td>${statusBadge(p.status)}</td>
          <td class="num">${stamp(p.paid_at || p.created_at)}</td>
        </tr>`),
      'No transactions match that filter.'
    );
    at('[data-tx-count]').textContent =
      `${data.count} transaction${data.count === 1 ? '' : 's'}`;
  } catch (err) {
    paintError(node, err);
  }
}

/* ---------------------------------------------------------- sales report - */

function reportChart(days) {
  const max = Math.max(1, ...days.map((d) => d.revenue_cents));
  const every = Math.max(1, Math.ceil(days.length / 12));

  const bars = days.map((d) => {
    const pct = d.revenue_cents === 0 ? 0 : Math.max(2, Math.round((d.revenue_cents / max) * 100));
    return `<div class="bars__col" title="${esc(dateShort(d.date))}: ${money(d.revenue_cents)}">
      <div class="bars__bar" style="height:${pct}%" data-zero="${d.revenue_cents === 0}"></div>
    </div>`;
  }).join('');

  const labels = days.map((d, i) => {
    const day = Number(d.date.slice(8, 10));
    const show = i % every === 0 || i === days.length - 1;
    const text = show ? (d.date.slice(5, 7) === '01' || i === 0 ? d.date.slice(5) : String(day)) : '';
    return `<span>${esc(text)}</span>`;
  }).join('');

  const peak = days.reduce((best, d) => (d.revenue_cents > best.revenue_cents ? d : best), days[0]);

  return `<div class="bars-axis"><div class="bars" aria-hidden="true">${bars}</div></div>
    <div class="bars-x">${labels}</div>
    <div class="bars-scale"><span>₱0</span><span>${money(max)}</span></div>
    <p class="muted" style="font-size:.82rem;margin-top:.5rem">
      Quietest day: ${esc(dateShort(days[0].date))}. Best day: ${esc(dateShort(peak.date))}, ${money(peak.revenue_cents)}.
    </p>`;
}

async function loadReport() {
  const totalsEl = at('[data-rp-totals]');
  const chartEl = at('[data-rp-chart]');

  const from = at('[data-rp-from]').value;
  const to = at('[data-rp-to]').value;
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  chartEl.innerHTML = loading();

  try {
    const data = await api.get(`/api/admin/report?${query}`);
    const t = data.totals;

    totalsEl.innerHTML = `
      <div class="stat stat--accent"><p class="stat__label">Total taken</p><p class="stat__value">${money(t.revenue_cents)}</p></div>
      <div class="stat"><p class="stat__label">Shop</p><p class="stat__value">${money(t.shop_cents)}</p></div>
      <div class="stat"><p class="stat__label">Grooming</p><p class="stat__value">${money(t.grooming_cents)}</p></div>
      <div class="stat"><p class="stat__label">Transactions</p><p class="stat__value">${t.transaction_count}</p></div>
      <div class="stat"><p class="stat__label">Average sale</p><p class="stat__value">${money(t.average_order_cents)}</p></div>
      <div class="stat"><p class="stat__label">Units sold</p><p class="stat__value">${t.units_sold}</p></div>`;

    at('[data-rp-range]').textContent = `${data.range.from} to ${data.range.to} · ${data.days.length} days`;
    chartEl.innerHTML = reportChart(data.days);

    at('[data-rp-products]').innerHTML = table(
      [{ label: 'Product' }, { label: 'Units', num: true }, { label: 'Revenue', num: true }],
      data.top_products.map((p) => `
        <tr><td><strong>${esc(p.name)}</strong></td>
        <td class="num">${p.units}</td>
        <td class="num">${money(p.revenue_cents)}</td></tr>`),
      'Nothing sold in that window.'
    );

    at('[data-rp-services]').innerHTML = table(
      [{ label: 'Service' }, { label: 'Grooms', num: true }, { label: 'Revenue', num: true }],
      data.top_services.map((s) => `
        <tr><td><strong>${esc(s.name)}</strong></td>
        <td class="num">${s.bookings}</td>
        <td class="num">${money(s.revenue_cents)}</td></tr>`),
      'No grooms completed in that window.'
    );

    at('[data-rp-categories]').innerHTML = table(
      [{ label: 'Category' }, { label: 'Units', num: true }, { label: 'Revenue', num: true }],
      data.by_category.map((c) => `
        <tr><td>${esc(c.category)}</td>
        <td class="num">${c.units}</td>
        <td class="num">${money(c.revenue_cents)}</td></tr>`),
      'Nothing sold in that window.'
    );

    at('[data-rp-methods]').innerHTML = table(
      [{ label: 'Method' }, { label: 'Count', num: true }, { label: 'Revenue', num: true }],
      data.by_method.map((m) => `
        <tr><td>${esc(m.label)}</td>
        <td class="num">${m.count}</td>
        <td class="num">${money(m.revenue_cents)}</td></tr>`),
      'No payments in that window.'
    );

    at('[data-rp-peak]').textContent = `Paid only · refunds ${money(t.refunded_cents)} · expected ${money(t.expected_cents)}`;
  } catch (err) {
    paintError(chartEl, err);
    totalsEl.innerHTML = '';
  }
}

/* ----------------------------------------------------------- product CRUD */

const sheet = at('[data-sheet]');
const sheetForm = at('[data-form="product"]');
let editingId = null;
let sheetReturnFocus = null;

/** Forms expose their own `name` property, so named access needs asking twice. */
const f = (n) => sheetForm.querySelector(`[name="${n}"]`);

function fillSelect(select, options, chosen) {
  select.innerHTML = options.map((o) =>
    `<option value="${esc(o.value)}" ${o.value === chosen ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

async function ensureSheetOptions() {
  if (sheetForm.category.options.length > 1) return;
  try {
    const { categories } = await api.get('/api/categories');
    fillSelect(sheetForm.category,
      categories.map((c) => ({ value: c.slug, label: c.name })), '');
  } catch (_) {
    fillSelect(sheetForm.category, [{ value: '', label: '—' }], '');
  }
}

async function openSheet(product) {
  await ensureSheetOptions();
  editingId = product ? product.id : null;
  sheetReturnFocus = document.activeElement;

  sheetForm.reset();
  clearFieldErrors(sheetForm);
  clearBanner(sheetForm.querySelector('[data-alert]'));

  at('[data-sheet-title]').textContent = product ? 'Edit product' : 'Add a product';
  at('[data-sheet-sub]').textContent = product
    ? 'Changes appear in the shop as soon as you save.'
    : 'It appears in the shop as soon as you save.';
  at('[data-sheet-delete]').hidden = !product;

  if (product) {
    f('name').value = product.name;
    f('slug').value = product.slug;
    f('slug').readOnly = true;
    f('category').value = product.category;
    f('price').value = (product.price_cents / 100).toFixed(2);
    f('stock').value = product.stock;
    f('size').value = product.size || '';
    f('art').value = product.art || 'bag';
    f('featured').checked = !!product.featured;
    f('blurb').value = product.blurb || '';
    f('description').value = product.description || '';
    f('detail').value = product.detail || '';
  } else {
    f('slug').readOnly = false;
    f('category').value = sheetForm.category.options[0]?.value || '';
    f('price').value = '';
    f('stock').value = '0';
    f('art').value = 'bag';
  }

  sheet.hidden = false;
  f('name').focus();
}

function closeSheet() {
  sheet.hidden = true;
  editingId = null;
  sheetReturnFocus?.focus?.();
}

sheetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const banner = sheetForm.querySelector('[data-alert]');
  clearFieldErrors(sheetForm);
  clearBanner(banner);

  const slug = f('slug').value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const payload = {
    name: f('name').value.trim(),
    slug: slug || f('name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    category: f('category').value,
    price: Number(f('price').value),
    stock: Number(f('stock').value),
    size: f('size').value.trim(),
    art: f('art').value,
    featured: f('featured').checked,
    blurb: f('blurb').value.trim(),
    description: f('description').value.trim(),
    detail: f('detail').value.trim(),
  };

  const button = at('[data-sheet-save]');
  try {
    if (editingId) {
      await withBusy(button, 'Saving…', () => api.patch(`/api/admin/products/${editingId}`, payload));
      toast('Product updated.', 'ok');
    } else {
      await withBusy(button, 'Adding…', () => api.post('/api/admin/products', payload));
      toast('Product added to the shop.', 'ok');
    }
    closeSheet();
    await load('products');
  } catch (err) {
    paintApiError(sheetForm, banner, err);
    if (err instanceof ApiError) {
      const first = Object.keys(err.fields)[0];
      if (first) f(first)?.focus();
    }
  }
});

at('[data-sheet-delete]').addEventListener('click', async () => {
  if (!editingId) return;
  const product = productRows.find((p) => p.id === editingId);
  if (!product) return;
  if (!confirm(`Take "${product.name}" off the shop? Existing orders keep their copy.`)) return;

  try {
    await api.del(`/api/admin/products/${editingId}`);
    toast(`${product.name} removed from the shop.`, 'ok');
    closeSheet();
    await load('products');
  } catch (err) {
    toast(err.message, 'warn');
  }
});

document.querySelectorAll('[data-sheet-close]').forEach((btn) => {
  btn.addEventListener('click', closeSheet);
});

sheet.addEventListener('click', (event) => {
  if (event.target === sheet) closeSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !sheet.hidden) closeSheet();
});

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

/* --------------------------------------------------------------- views --- */

const LOADERS = {
  today: loadToday,
  bookings: loadBookings,
  orders: loadOrders,
  products: loadProducts,
  transactions: loadTransactions,
  report: loadReport,
};

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

/* --------------------------------------------------------------- wiring -- */

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

at('[data-refresh]').addEventListener('click', () => load(currentView));

at('[data-goto="products"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  showView('products');
});

document.addEventListener('change', (event) => {
  const select = event.target.closest('[data-status]');
  if (select) { changeStatus(select); return; }

  const stock = event.target.closest('[data-stock]');
  if (stock) { changeStock(stock); return; }

  if (event.target.matches('[data-or-status]')) load('orders');
  if (event.target.matches('[data-pd-cat]')) load('products');
  if (event.target.matches('[data-tx-kind], [data-tx-status], [data-tx-from], [data-tx-to]')) load('transactions');
});

document.addEventListener('click', (event) => {
  const edit = event.target.closest('[data-product-edit]');
  if (edit) {
    openSheet(productRows.find((p) => p.id === Number(edit.dataset.productEdit)));
    return;
  }

  const toggle = event.target.closest('[data-product-toggle]');
  if (toggle) {
    const product = productRows.find((p) => p.id === Number(toggle.dataset.productToggle));
    if (!product) return;
    api.patch(`/api/admin/products/${product.id}`, { active: !product.active })
      .then(() => { toast(`${product.name} ${product.active ? 'hidden from' : 'shown in'} the shop.`, 'ok'); load('products'); })
      .catch((err) => toast(err.message, 'warn'));
    return;
  }

  const remove = event.target.closest('[data-product-del]');
  if (remove) {
    const product = productRows.find((p) => p.id === Number(remove.dataset.productDel));
    if (!product) return;
    if (!confirm(`Take "${product.name}" off the shop? Existing orders keep their copy.`)) return;
    api.del(`/api/admin/products/${product.id}`)
      .then(() => { toast(`${product.name} removed from the shop.`, 'ok'); load('products'); })
      .catch((err) => toast(err.message, 'warn'));
    return;
  }

  if (event.target.closest('[data-product-new]')) openSheet(null);
});

at('[data-bk-status]').addEventListener('change', () => load('bookings'));
at('[data-bk-from]').addEventListener('change', () => load('bookings'));
at('[data-bk-from]').min = isoToday();

/* ------------------------------------------------------------ report UI --- */

function setRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  at('[data-rp-from]').value = key(from);
  at('[data-rp-to]').value = key(to);
  document.querySelectorAll('[data-range]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(Number(btn.dataset.range) === days));
  });
  if (currentView === 'report') load('report');
}

document.querySelectorAll('[data-range]').forEach((btn) => {
  btn.addEventListener('click', () => setRange(Number(btn.dataset.range)));
});

at('[data-rp-from]').addEventListener('change', () => load('report'));
at('[data-rp-to]').addEventListener('change', () => load('report'));
at('[data-rp-from]').min = '2024-01-01';
at('[data-rp-to]').min = '2024-01-01';

/* ----------------------------------------------------------------- boot -- */

(async function boot() {
  setRange(30);
  await ensureSheetOptions();
  try {
    const { admin } = await api.get('/api/admin/me');
    if (admin) enter(admin);
    else showLogin();
  } catch (_) {
    showLogin();
  }
})();
