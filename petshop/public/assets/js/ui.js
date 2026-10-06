/**
 * Shared UI helpers: formatting, the four render states, toasts, live-region
 * announcements, and the bits of chrome every page has (nav, cart badge).
 */

import { cart } from './cart.js';

/* ------------------------------------------------------------ format ---- */

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export const money = (cents) => gbp.format((Number(cents) || 0) / 100);

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
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(y, m - 1, d));
}

export function dateShort(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y, m - 1, d));
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
