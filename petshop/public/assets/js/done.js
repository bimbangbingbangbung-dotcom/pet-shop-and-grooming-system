/**
 * Confirmation page, shared by orders and appointments. The reference in the
 * URL is the whole identity here — nothing about the person is shown twice.
 */

import { api } from './api.js';
import { hydrateChrome, esc, money, dateLong, announce } from './ui.js';

hydrateChrome();

const slot = document.querySelector('[data-slot]');
const params = new URLSearchParams(location.search);
const ref = (params.get('ref') || '').toUpperCase();

/**
 * The prefix says what the thing is. `kind` is kept as a fallback so a
 * hand-written or older link still resolves.
 */
const kind = /^GRM-/.test(ref) ? 'booking'
  : /^ORD-/.test(ref) ? 'order'
    : params.get('kind') === 'booking' ? 'booking' : 'order';

const titleEl = document.querySelector('[data-page-title]');

/** One <h1> per state: it is the page's heading and its document title. */
function heading(text, documentTitle) {
  if (titleEl) titleEl.textContent = text;
  document.title = documentTitle || `${text} — Snip & Snout`;
}

const CHECK = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5.5 5.5L20 7"/></svg>`;

const row = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

/** SQLite's datetime('now') is UTC without a zone marker. */
function stamp(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return esc(value);
  return esc(new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(date));
}

function actions() {
  return `<div class="row" style="margin-top:var(--sp-5)">
    <a class="btn" href="/shop">Back to the shop</a>
    <a class="btn btn--ghost" href="/booking">Book a groom</a>
  </div>`;
}

function renderOrder(o) {
  const collecting = o.fulfilment === 'collection';
  heading(
    collecting ? 'We will have it ready' : 'Thanks, that is ordered',
    `Order ${o.ref} — Snip & Snout`
  );

  const items = o.items.map((i) => `${i.qty} × ${esc(i.name)}`).join(', ');

  return `<div class="success">
    ${CHECK}
    <p class="success__lead">${
      collecting
        ? 'Ready within the hour during opening times. Ring the shop if you are running late and we will put it aside.'
        : 'Ordered before 2pm it leaves today. We will email the tracking as soon as it is on its way.'
    }</p>
    <span class="success__ref">${esc(o.ref)}</span>
    <dl class="confirm-list" style="margin-top:var(--sp-5)">
      ${row('Receipt sent to', esc(o.email))}
      ${row('Items', items)}
      ${row(collecting ? 'Collect from' : 'Deliver to', esc(o.address))}
      ${row('Total paid', money(o.total_cents) + (o.shipping_cents ? '' : ' (free delivery)'))}
      ${row('Placed', stamp(o.created_at))}
    </dl>
    ${actions()}
  </div>`;
}

function renderBooking(b) {
  heading('You are booked in', `Booking ${b.ref} — Snip & Snout`);

  return `<div class="success">
    ${CHECK}
    <p class="success__lead">A confirmation is on its way to ${esc(b.email)}. If anything changes, ring the shop and we will sort it.</p>
    <span class="success__ref">${esc(b.ref)}</span>
    <dl class="confirm-list" style="margin-top:var(--sp-5)">
      ${row('Service', esc(b.service))}
      ${row('When', `${esc(dateLong(b.date))}, ${esc(b.start_label)} to ${esc(b.end_label)}`)}
      ${row('Pet', esc(b.pet_name))}
      ${row('Pay at the desk', money(b.price_cents))}
      ${row('Status', esc(b.status[0].toUpperCase() + b.status.slice(1)))}
    </dl>
    ${actions()}
  </div>`;
}

function problem(title, body) {
  heading(title);
  slot.innerHTML = `<div class="state">
    <p class="state__body">${esc(body)}</p>
    <a class="btn" href="/">Back to the shop</a>
  </div>`;
}

async function load() {
  if (!ref) {
    problem('No reference in that link', 'Open it from the email we sent, or start again from the shop.');
    return;
  }

  try {
    const path = kind === 'booking' ? `/api/bookings/${encodeURIComponent(ref)}` : `/api/orders/${encodeURIComponent(ref)}`;
    const data = await api.get(path);
    slot.innerHTML = kind === 'booking' ? renderBooking(data.booking) : renderOrder(data.order);
    announce(`${kind === 'booking' ? 'Booking' : 'Order'} ${ref} confirmed.`);
  } catch (err) {
    if (err.status === 404) {
      problem('We cannot find that reference', `Nothing is filed under ${ref}. Check the reference in your email, or ring the shop on 0117 496 2210.`);
      return;
    }
    problem('That did not load', err.message);
  }
}

load();
