/**
 * Basket. Stored in localStorage for instant UI feedback; the server
 * re-prices every line from the database at checkout, so anything here
 * is display-only and safe to ignore.
 */

const KEY = 'snout.cart.v1';
const EVENT = 'cart:change';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function write(lines) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch (_) {
    /* private mode or a full quota: the basket just will not persist */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export const cart = {
  lines() {
    return read();
  },

  count() {
    return read().reduce((n, l) => n + l.qty, 0);
  },

  subtotal() {
    return read().reduce((n, l) => n + l.price_cents * l.qty, 0);
  },

  add(line, qty = 1) {
    const lines = read();
    const found = lines.find((l) => l.slug === line.slug);
    if (found) found.qty = Math.min(99, found.qty + qty);
    else lines.push({ ...line, qty: Math.min(99, qty) });
    write(lines);
  },

  setQty(slug, qty) {
    const lines = read();
    const found = lines.find((l) => l.slug === slug);
    if (!found) return;
    if (qty < 1) return cart.remove(slug);
    found.qty = Math.min(99, qty);
    write(lines);
  },

  remove(slug) {
    write(read().filter((l) => l.slug !== slug));
  },

  clear() {
    write([]);
  },
};

/** Button-side helper: one shape for every "add to basket" control. */
export function wireAddButton(btn, getLine) {
  btn.addEventListener('click', () => {
    const line = typeof getLine === 'function' ? getLine() : getLine;
    if (!line) return;
    cart.add(line, Number(btn.dataset.qty) || 1);
    const original = btn.textContent;
    btn.textContent = 'Added';
    btn.setAttribute('aria-disabled', 'true');
    setTimeout(() => {
      btn.textContent = original;
      btn.removeAttribute('aria-disabled');
    }, 1100);
  });
}
