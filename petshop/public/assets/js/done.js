/**
 * Confirmation page, shared by orders and appointments. The reference in the
 * URL is the whole identity here — nothing about the person is shown twice.
 * It doubles as the receipt: order number, receipt number, how it was paid.
 */

import { api } from './api.js';
import {
  hydrateChrome, esc, money, dateLong, stamp, statusTrack, statusBadge, announce,
} from './ui.js';

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

const METHOD_LABEL = {
  card: 'Card', gcash: 'GCash', maya: 'Maya',
  cod: 'Cash on delivery', cash: 'Cash at the shop',
};

/** One <h1> per state: it is the page's heading and its document title. */
function heading(text, documentTitle) {
  if (titleEl) titleEl.textContent = text;
  document.title = documentTitle || `${text} — Snip & Snout`;
}

const CHECK = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5.5 5.5L20 7"/></svg>`;

const row = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

/** Receipts read better in full date form than the medium one used in tables. */
const long = (value) => stamp(value, 'long');

function actions() {
  return `<div class="row" style="margin-top:var(--sp-5)">
    <a class="btn" href="/account">Your account</a>
    <a class="btn btn--ghost" href="/shop">Back to the shop</a>
    <a class="btn btn--ghost" href="/booking">Book a groom</a>
  </div>`;
}

/** The paper trail: receipt number, how it was paid, what it came to. */
function receiptBlock(receipt, options = {}) {
  if (!receipt) return '';

  const lines = options.lines || '';

  const gateway = receipt.reference
    ? `<div class="receipt__line"><span>Gateway reference</span><span class="tnum">${esc(receipt.reference)}</span></div>`
    : '';

  return `<div class="receipt">
    <div class="receipt__head">
      <span class="receipt__ref">${esc(receipt.receipt_ref)}</span>
      <span class="muted" style="font-size:.85rem">Receipt number</span>
    </div>
    ${options.body || ''}
    ${lines}
    <div class="receipt__line receipt__line--total">
      <span>${esc(options.totalLabel || 'Total paid')}</span>
      <span>${money(receipt.amount_cents)}</span>
    </div>
    <div class="receipt__line">
      <span>${esc(options.methodLabel || 'Paid with')}</span>
      <span>${esc(METHOD_LABEL[receipt.method] || receipt.method)}${receipt.detail ? ` · ${esc(receipt.detail)}` : ''}</span>
    </div>
    ${gateway}
    <div class="receipt__line">
      <span>Status</span>
      <span>${statusBadge(receipt.status)}</span>
    </div>
    <div class="receipt__line">
      <span>${receipt.status === 'pending' ? 'Opened' : 'Paid'}</span>
      <span>${long(receipt.created_at)}</span>
    </div>
  </div>`;
}

function renderOrder(o, receipt) {
  const collecting = o.fulfilment === 'collection';
  heading(
    collecting ? 'We will have it ready' : 'Thanks, that is ordered',
    `Order ${o.ref} — Snip & Snout`
  );

  const items = o.items.map((i) =>
    `<div class="receipt__line">
       <span>${i.qty} × ${esc(i.name)}${i.note ? `<br><span class="note-inline">${esc(i.note)}</span>` : ''}</span>
       <span>${money(i.unit_cents * i.qty)}</span>
     </div>`).join('');

  const labels = {
    paid: 'Confirmed',
    picking: 'Packing',
    shipped: collecting ? 'Ready to collect' : 'On the way',
  };

  return `<div class="success">
    ${CHECK}
    <p class="success__lead">${
      collecting
        ? 'Ready within the hour during opening times. Ring the shop if you are running late and we will put it aside.'
        : 'Ordered before 2pm it leaves today. We will email the tracking as soon as it is on its way.'
    }</p>
    <span class="success__ref">${esc(o.ref)}</span>
    <p class="muted" style="margin-top:.5rem">Your order number. Keep it — it is everything we need to find it.</p>

    ${statusTrack(o.status, ['paid', 'picking', 'shipped'], labels)}

    <dl class="confirm-list" style="margin-top:var(--sp-5)">
      ${row('Receipt sent to', esc(o.email))}
      ${row(collecting ? 'Collect from' : 'Deliver to', esc(o.address))}
      ${row('Placed', long(o.created_at))}
      ${o.notes ? row('Your note', esc(o.notes)) : ''}
    </dl>

    ${receiptBlock(receipt, {
      lines: items,
      body: `<div class="receipt__line"><span>Delivery</span><span>${
        o.shipping_cents ? money(o.shipping_cents) : 'Free'
      }</span></div>`,
      totalLabel: 'Order total',
    })}

    ${actions()}
  </div>`;
}

function renderBooking(b, receipt) {
  heading('You are booked in', `Booking ${b.ref} — Snip & Snout`);

  const addons = b.addon_names && b.addon_names.length
    ? row('Extras', b.addon_names.map(esc).join(', '))
    : '';

  return `<div class="success">
    ${CHECK}
    <p class="success__lead">A confirmation is on its way to ${esc(b.email)}. If anything changes, ring the shop and we will sort it.</p>
    <span class="success__ref">${esc(b.ref)}</span>
    <p class="muted" style="margin-top:.5rem">Quote this when you arrive.</p>

    ${statusTrack(b.status, ['confirmed', 'arrived', 'complete'],
      { confirmed: 'Booked in', arrived: 'Arrived', complete: 'Finished' })}

    <dl class="confirm-list" style="margin-top:var(--sp-5)">
      ${row('Service', esc(b.service))}
      ${row('When', `${esc(dateLong(b.date))}, ${esc(b.start_label)} to ${esc(b.end_label)}`)}
      ${row('Pet', `${esc(b.pet_name)} · ${esc(b.pet_type)}${b.breed ? ` · ${esc(b.breed)}` : ''}`)}
      ${row('Size', esc(b.pet_size))}
      ${addons}
      ${b.notes ? row('Your note', esc(b.notes)) : ''}
    </dl>

    ${receiptBlock(receipt, {
      totalLabel: b.status === 'complete' ? 'Paid at the shop' : 'Payable at the shop',
      methodLabel: 'Payment',
    })}

    <p class="ship-note" style="margin-top:var(--sp-4)">
      Grooming is paid when you collect — no deposit, no card details needed to book.
    </p>

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
    slot.innerHTML = kind === 'booking'
      ? renderBooking(data.booking, data.receipt)
      : renderOrder(data.order, data.receipt);
    announce(`${kind === 'booking' ? 'Booking' : 'Order'} ${ref} confirmed.`);
  } catch (err) {
    if (err.status === 404) {
      problem('We cannot find that reference', `Nothing is filed under ${ref}. Check the reference in your email, or ring the shop on 0917 555 0142.`);
      return;
    }
    problem('That did not load', err.message);
  }
}

load();
