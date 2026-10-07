/**
 * Shared UI helpers: formatting, the four render states, toasts, live-region
 * announcements, and the bits of chrome every page has (nav, cart badge).
 */

import { cart } from './cart.js';

/* ------------------------------------------------------------ format ---- */

const PHP = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** Values are integer centavos: ₱1,590 is stored as 159000. */
export const money = (cents) => PHP.format((Number(cents) || 0) / 100);

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dateLong(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(y, m - 1, d));
}

export function dateShort(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y, m - 1, d));
}

/**
 * Stamp a database timestamp for a human.
 *
 * SQLite's `datetime('now')` is UTC with no zone marker, while the payment
 * ledger writes real ISO-8601 (`…Z`). Accept both, then show the same instant
 * in local Philippine time so nothing on the site reads as machine output.
 */
export function stamp(value, dateStyle = 'medium') {
  const raw = String(value ?? '');
  if (!raw) return '';
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return esc(raw);
  return esc(new Intl.DateTimeFormat('en-PH', { dateStyle, timeStyle: 'short' }).format(date));
}

export function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------- announcements */

let liveRegion;

function live() {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(liveRegion);
  }
  return liveRegion;
}

export function announce(message) {
  const region = live();
  region.textContent = '';
  window.setTimeout(() => { region.textContent = message; }, 40);
}

/* --------------------------------------------------------------- toast --- */

let toastRegion;

export function toast(message, tone = 'info') {
  if (!toastRegion) {
    toastRegion = document.createElement('div');
    toastRegion.className = 'toast-region';
    toastRegion.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastRegion);
  }

  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.tone = tone;
  node.textContent = message;
  toastRegion.appendChild(node);

  window.setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    window.setTimeout(() => node.remove(), 260);
  }, 3600);
}

/* ------------------------------------------------------ render states ---- */

/**
 * Every async region renders exactly one of these four. Keeping them in one
 * place is what stops an empty screen from looking like a broken one.
 */
export const state = {
  loading(rows = 3) {
    let out = '<div class="stack-3" aria-busy="true" aria-label="Loading">';
    for (let i = 0; i < rows; i++) {
      out += '<div class="skeleton" style="height:22px;width:' + (90 - i * 14) + '%"></div>' +
             '<div class="skeleton" style="height:14px;width:' + (70 - i * 10) + '%"></div>';
    }
    return out + '</div>';
  },

  error(message, retryTarget) {
    return `<div class="state">
      <p class="state__title">That did not load</p>
      <p class="state__body">${esc(message)}</p>
      <button class="btn btn--ghost" type="button" data-retry="${esc(retryTarget)}">Try again</button>
    </div>`;
  },

  empty(title, body) {
    return `<div class="state">
      <p class="state__title">${esc(title)}</p>
      <p class="state__body">${esc(body)}</p>
    </div>`;
  },
};

/** Wire up every `[data-retry]` button inside `root` to call `fn`. */
export function wireRetry(root, fn) {
  root.querySelectorAll('[data-retry]').forEach((btn) => {
    btn.addEventListener('click', fn, { once: true });
  });
}

/* ---------------------------------------------------------- validation --- */

export function showFieldError(form, field, message) {
  const input = form.querySelector(`[name="${CSS.escape(field)}"]`);
  const wrapper = input && input.closest('.field');
  if (!wrapper) return;
  wrapper.dataset.invalid = 'true';
  const slot = wrapper.querySelector('.field__error');
  if (slot) slot.textContent = message;
  input.setAttribute('aria-invalid', 'true');
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.field[data-invalid="true"]').forEach((wrapper) => {
    wrapper.dataset.invalid = 'false';
    const input = wrapper.querySelector('[name]');
    if (input) input.removeAttribute('aria-invalid');
  });
}

/** Paint an ApiError: summary banner first, then inline field messages. */
export function paintApiError(form, banner, err) {
  clearFieldErrors(form);
  const fields = err.fields || {};
  for (const [name, message] of Object.entries(fields)) showFieldError(form, name, message);

  if (banner) {
    banner.dataset.visible = 'true';
    banner.classList.toggle('form-alert--ok', err.status === 0 ? false : false);
    const text = banner.querySelector('[data-alert-text]');
    if (text) text.textContent = err.message;
    banner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function clearBanner(banner) {
  if (!banner) return;
  banner.dataset.visible = 'false';
}

/* ------------------------------------------------------------- account -- */

let accountPromise = null;

/**
 * One session probe per page load, shared by everyone who asks. A signed-out
 * visitor gets a normal 200 with `customer: null`, so the probe never logs an
 * error on a page that has nothing to do with accounts.
 */
export function account() {
  if (!accountPromise) {
    accountPromise = fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : { customer: null }))
      .catch(() => ({ customer: null }));
  }
  return accountPromise;
}

export function setAccount(customer) {
  accountPromise = Promise.resolve({ customer, authenticated: !!customer });
  paintAccount(customer);
}

function paintAccount(customer) {
  document.querySelectorAll('[data-account-link]').forEach((link) => {
    link.dataset.signedIn = String(!!customer);
    if (customer) {
      link.textContent = customer.name.split(' ')[0] || 'Account';
      link.setAttribute('aria-label', `Your account, signed in as ${customer.name}`);
    } else {
      link.textContent = 'Sign in';
      link.removeAttribute('aria-label');
    }
  });
}

export async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (_) {
    /* already signed out as far as the browser is concerned */
  }
  setAccount(null);
}

/** Send a signed-out visitor to the sign-in page and remember where they were. */
export async function requireAccount() {
  const { customer } = await account();
  if (customer) return customer;
  const next = location.pathname + location.search;
  location.replace(`/login?next=${encodeURIComponent(next === '/login' ? '/' : next)}`);
  return null;
}

/* ---------------------------------------------------------- status track */

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/**
 * One bar per stage of an order or appointment, filled as far as it has got.
 */
export function statusTrack(current, steps, labels = {}) {
  const labelFor = (step) => labels[step] || cap(step);

  // A cancelled record never reads as "part-way through": the other stages
  // would only invite someone to ask where their parcel is.
  if (current === 'cancelled') {
    return `<ol class="track">
      <li class="track__step" data-state="cancelled">
        <span class="track__bar"></span>
        <span class="track__label">Cancelled</span>
      </li>
    </ol>`;
  }

  const at = steps.indexOf(current);
  const reached = at === -1 ? 0 : at;
  return `<ol class="track">${steps.map((step, i) => `
    <li class="track__step" data-state="${i < reached ? 'done' : i === reached ? 'current' : 'todo'}">
      <span class="track__bar"></span>
      <span class="track__label">${esc(labelFor(step))}</span>
    </li>`).join('')}</ol>`;
}

/** Badge text and tone for a status, shared by the console and the account. */
export function statusBadge(status) {
  const tone = {
    complete: 'ok', shipped: 'ok', paid: 'ok', arrived: 'live',
    picking: 'low', confirmed: 'low', pending: 'low',
    cancelled: 'out', refunded: 'out',
  }[status] || '';
  return `<span class="badge${tone ? ` badge--${tone}` : ''}">${esc(cap(status))}</span>`;
}

/* ------------------------------------------------------------- chrome ---- */

function hydrateNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.dataset.open === 'true';
      nav.dataset.open = String(!open);
      toggle.setAttribute('aria-expanded', String(!open));
    });
  }

  const here = location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('[data-nav] a[href]').forEach((link) => {
    const target = new URL(link.href).pathname.replace(/\/$/, '') || '/';
    if (target === here) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function refreshCartBadge() {
  const count = cart.count();
  document.querySelectorAll('[data-cart-count]').forEach((node) => {
    node.textContent = String(count);
    node.dataset.empty = String(count === 0);
  });
}

export function hydrateChrome() {
  hydrateNav();
  refreshCartBadge();
  account().then(({ customer }) => paintAccount(customer));
  window.addEventListener('cart:change', refreshCartBadge);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const nav = document.querySelector('[data-nav]');
      if (nav && nav.dataset.open === 'true') {
        nav.dataset.open = 'false';
        document.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
      }
    }
  });
}

/* ---------------------------------------------------------------- misc --- */

export function withBusy(button, label, fn) {
  const original = button.innerHTML;
  button.setAttribute('aria-disabled', 'true');
  button.textContent = label || 'Working…';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      button.innerHTML = original;
      button.removeAttribute('aria-disabled');
    });
}
