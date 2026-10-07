'use strict';

/**
 * HTTP API for Snip & Snout.
 *
 * Conventions:
 *  - Success: 2xx with a JSON body.
 *  - Failure: JSON `{ error: { code, message, details? } }` where `details`
 *    is an array of `{ field, message }` for anything the caller can fix.
 *  - Prices are computed here, from the database. A client-sent price is
 *    never trusted.
 *  - Every mutation that touches a slot runs inside BEGIN IMMEDIATE so two
 *    browsers cannot book the last appointment at the same time.
 */

const crypto = require('node:crypto');
const { db } = require('./db');
const { ADMIN_EMAIL, hashPassword } = require('./seed');

/* ------------------------------------------------------------------ errors */

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, 'validation_error', message, details);
const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);
const conflict = (message, details) => new HttpError(409, 'conflict', message, details);

/* ------------------------------------------------------------- shop config */

const HOURS = {
  0: [10 * 60, 15 * 60], // Sunday
  1: null,               // Monday - closed
  2: [9 * 60, 18 * 60],
  3: [9 * 60, 18 * 60],
  4: [9 * 60, 18 * 60],
  5: [9 * 60, 18 * 60],
  6: [9 * 60, 17 * 60],
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_STEP = 30;
const CAPACITY = 2;          // grooms running at once
const SHIPPING_FLAT = 15000;   // ₱150 flat delivery, free over ₱2,500
const FREE_OVER = 250000;
const LEAD_MINUTES = 60;     // same-day bookings need an hour's notice
const SESSION_TTL = 8 * 60 * 60 * 1000;              // staff: one shift
const CUSTOMER_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

/** Payment methods offered at checkout, in the order they are shown. */
const PAYMENT_METHODS = ['card', 'gcash', 'maya', 'cod'];

const SHOP = {
  name: 'Snip & Snout',
  strapline: 'Pet shop & grooming parlour',
  address: '128 Maginhawa Street, Teachers Village East, Diliman, Quezon City 1101',
  phone: '0917 555 0142',
  email: 'hello@snipandsnout.ph',
  currency: 'PHP',
  shipping_cents: SHIPPING_FLAT,
  free_over_cents: FREE_OVER,
  hours: [
    { day: 'Monday', closed: true },
    { day: 'Tuesday', open: '9:00 am', close: '6:00 pm' },
    { day: 'Wednesday', open: '9:00 am', close: '6:00 pm' },
    { day: 'Thursday', open: '9:00 am', close: '6:00 pm' },
    { day: 'Friday', open: '9:00 am', close: '6:00 pm' },
    { day: 'Saturday', open: '9:00 am', close: '5:00 pm' },
    { day: 'Sunday', open: '10:00 am', close: '3:00 pm' },
  ],
};

/* ------------------------------------------------------------- validation */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+()\s-]{7,24}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SIZES = ['small', 'medium', 'large'];
const BOOKING_STATUSES = ['confirmed', 'arrived', 'complete', 'cancelled'];
const ORDER_STATUSES = ['paid', 'picking', 'shipped', 'cancelled'];

/** camelCase field name -> something a customer would recognise. */
const FIELD_LABELS = {
  petName: "Your pet's name", petType: 'What they are', breed: 'Breed', coat: 'Coat type',
  ownerName: 'Your name', email: 'Email', phone: 'Phone', address: 'Delivery address',
  serviceId: 'Service', petSize: 'Size', addonIds: 'Extras', start: 'Time', date: 'Date',
  notes: 'Notes', items: 'Basket', price: 'Price', stock: 'Stock', slug: 'URL slug',
  category: 'Category', blurb: 'Short description', description: 'Description',
  detail: 'Care notes', size: 'Size', artwork: 'Artwork', art: 'Artwork', status: 'Status',
  name: 'Name', fulfilment: 'Collection or delivery', password: 'Password',
  payment_method: 'Payment method', paymentDetail: 'Card number',
  amount: 'Amount', kind: 'Type', method: 'Method', from: 'From', to: 'To',
};

function labelFor(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const sentence = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function fail(field, message) {
  throw badRequest(message, [{ field, message }]);
}

function need(cond, field, message) {
  if (!cond) throw badRequest(message, [{ field, message }]);
}

function cleanText(value, { max = 500, min = 0, field = 'field', required = true } = {}) {
  const label = labelFor(field);
  if (value === undefined || value === null || value === '') {
    if (required) fail(field, `${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') fail(field, `${label} must be text.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length < min) fail(field, `${label} needs at least ${min} character${min === 1 ? '' : 's'}.`);
  if (text.length > max) fail(field, `Keep ${label.toLowerCase()} under ${max} characters.`);
  return text;
}

function moneyToInteger(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(field, 'Enter a valid amount.');
  return Math.round(n * 100);
}

function parseDate(value, field = 'date') {
  const m = DATE_RE.exec(String(value || ''));
  if (!m) throw badRequest('Choose a valid date.', [{ field, message: 'Use the format YYYY-MM-DD.' }]);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw badRequest('Choose a valid date.', [{ field, message: 'That date does not exist.' }]);
  }
  return { key: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, date };
}

function hhmmToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) throw badRequest('Choose a start time.', [{ field: 'start', message: 'Choose a start time.' }]);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes % SLOT_STEP !== 0) {
    throw badRequest('Choose a start time.', [{ field: 'start', message: 'Appointments start on the half hour.' }]);
  }
  return minutes;
}

function minutesToLabel(min) {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${suffix}`;
}

/* --------------------------------------------------------------- selectors */

function serializeProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    category_name: row.category_name,
    price_cents: row.price_cents,
    compare_at_cents: row.compare_at_cents,
    blurb: row.blurb,
    description: row.description,
    detail: row.detail,
    size: row.size,
    art: row.art,
    stock: row.stock,
    featured: !!row.featured,
    active: !!row.active,
  };
}

function serializeService(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    summary: row.summary,
    duration_min: row.duration_min,
    flat_price: !!row.flat_price,
    prices: {
      small: row.price_small,
      medium: row.price_medium,
      large: row.price_large,
    },
    includes: JSON.parse(row.includes || '[]'),
    note: row.note,
  };
}

function serializeAddon(row) {
  return { id: row.id, slug: row.slug, name: row.name, summary: row.summary, price_cents: row.price_cents };
}

const ADDON_BY_ID = new Map();
function loadAddons() {
  ADDON_BY_ID.clear();
  for (const a of db.all('SELECT * FROM addons')) ADDON_BY_ID.set(a.id, a);
  return ADDON_BY_ID;
}

function addonName(id) {
  const a = ADDON_BY_ID.get(id) || loadAddons().get(id);
  return a ? a.name : `Extra #${id}`;
}

function serializeBooking(row) {
  const addonIds = JSON.parse(row.addon_ids || '[]');
  return {
    id: row.id,
    ref: row.ref,
    date: row.date,
    start_min: row.start_min,
    start_label: minutesToLabel(row.start_min),
    end_label: minutesToLabel(row.start_min + row.duration_min),
    duration_min: row.duration_min,
    service: row.service_name,
    service_slug: row.service_slug,
    pet_name: row.pet_name,
    pet_type: row.pet_type,
    breed: row.breed,
    pet_size: row.pet_size,
    coat: row.coat,
    owner_name: row.owner_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    addon_ids: addonIds,
    addon_names: addonIds.map(addonName),
    price_cents: row.price_cents,
    status: row.status,
    payment_ref: row.pay_ref ?? row.payment_ref ?? '',
    payment_status: firstDefined(row.pay_status, row.payment_status),
    payment_method: firstDefined(row.pay_method, row.payment_method),
    customer_id: row.customer_id ?? null,
    created_at: row.created_at,
  };
}

function serializeOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    email: row.email,
    name: row.name,
    phone: row.phone,
    address: row.address,
    items: JSON.parse(row.items || '[]'),
    subtotal_cents: row.subtotal_cents,
    shipping_cents: row.shipping_cents,
    total_cents: row.total_cents,
    status: row.status,
    fulfilment: row.fulfilment,
    notes: row.notes || '',
    payment_ref: row.pay_ref ?? row.payment_ref ?? '',
    payment_status: firstDefined(row.pay_status, row.payment_status),
    payment_method: firstDefined(row.pay_method, row.payment_method),
    payment_detail: firstDefined(row.pay_detail, row.payment_detail),
    payment_reference: firstDefined(row.pay_reference, row.payment_reference),
    customer_id: row.customer_id ?? null,
    created_at: row.created_at,
  };
}

/** Order/booking reads that also need the payment they produced. */
const ORDER_PAY = `
  SELECT o.*, p.ref AS pay_ref, p.status AS pay_status, p.method AS pay_method,
                p.detail AS pay_detail, p.reference AS pay_reference
  FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.kind = 'order'`;

const BOOKING_PAY = `
  SELECT b.*, s.name AS service_name, s.slug AS service_slug,
         p.status AS pay_status, p.method AS pay_method
  FROM bookings b JOIN services s ON s.id = b.service_id
  LEFT JOIN payments p ON p.booking_id = b.id AND p.kind = 'booking'`;

/**
 * Payments are joined in as `pay_*` by ORDER_PAY/BOOKING_PAY. Fall back to
 * `payment_*` so a bare table row still serialises sensibly.
 */
const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null) ?? null;

/* ----------------------------------------------------------- availability */

function dayHours(dateObj) {
  return HOURS[dateObj.getDay()];
}

function countOverlapping(dateKey, startMin, durationMin) {
  const row = db.get(
    `SELECT COUNT(*) AS n FROM bookings
      WHERE date = ? AND status != 'cancelled'
        AND start_min < ? AND (start_min + duration_min) > ?`,
    dateKey, startMin + durationMin, startMin
  );
  return row.n;
}

/**
 * Availability is derived, never stored: open hours minus bookings that
 * overlap the window. Returns a normal (200) response for closed days
 * because "we are shut on Mondays" is a state, not an error.
 */
function availability(dateKey, dateObj, durationMin) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dateObj < today) {
    return { date: dateKey, closed: true, reason: 'in_the_past', message: 'That day has already been and gone.', slots: [] };
  }

  const hours = dayHours(dateObj);
  if (!hours) {
    return {
      date: dateKey, closed: true, reason: 'closed_today',
      message: `We are closed on ${DAY_NAMES[dateObj.getDay()]}. Try another day.`, slots: [],
    };
  }

  const [open, close] = hours;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = dateObj.getTime() === new Date().setHours(0, 0, 0, 0);
  const earliest = isToday ? nowMinutes + LEAD_MINUTES : -1;

  const slots = [];
  for (let start = open; start + durationMin <= close; start += SLOT_STEP) {
    if (start < earliest) continue;
    const taken = countOverlapping(dateKey, start, durationMin);
    const free = Math.max(0, CAPACITY - taken);
    slots.push({
      minutes: start,
      start: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
      label: minutesToLabel(start),
      free,
      available: free > 0,
    });
  }

  return { date: dateKey, closed: false, reason: null, message: null, capacity: CAPACITY, slots };
}

function priceBooking(service, addonRows, petSize) {
  const base = service.flat_price ? service.price_small : service[`price_${petSize}`];
  const addons = addonRows.reduce((sum, a) => sum + a.price_cents, 0);
  return base + addons;
}

/* ------------------------------------------------------------- auth layer */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Unguessable reference for an order, booking or receipt. Uniqueness is
 * checked against the table the prefix belongs to, so an ORD and a GRM may
 * share a suffix without collision.
 */
function newRef(prefix, table = 'bookings') {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  do {
    out = '';
    for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  } while (db.get(`SELECT 1 AS x FROM ${table} WHERE ref = ?`, `${prefix}-${out}`));
  return `${prefix}-${out}`;
}

function createSession(res, admin) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.run('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)',
    hash, admin.id, Date.now() + SESSION_TTL);
  res.setHeader('Set-Cookie',
    `snout_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}; ${secureFlag()}`);
  return token;
}

function secureFlag() {
  return process.env.COOKIE_SECURE === '1' ? 'Secure; ' : '';
}

function currentAdmin(req) {
  const token = parseCookies(req.headers.cookie).snout_session;
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.get(
    `SELECT s.expires_at, a.id, a.email, a.name
       FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash = ?`, hash);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

function requireAdmin(req) {
  const admin = currentAdmin(req);
  if (!admin) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  return admin;
}

/* The customer session lives in its own table behind its own cookie, so a
   shopper's sign-in can never be replayed against an admin route. */

function createCustomerSession(res, customer) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.run('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)',
    hash, customer.id, Date.now() + CUSTOMER_SESSION_TTL);
  res.setHeader('Set-Cookie',
    `snout_customer=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CUSTOMER_SESSION_TTL / 1000}; ${secureFlag()}`);
}

function currentCustomer(req) {
  const token = parseCookies(req.headers.cookie).snout_customer;
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.get(
    `SELECT s.expires_at, c.id, c.email, c.name, c.phone, c.address
       FROM customer_sessions s JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = ?`, hash);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run('DELETE FROM customer_sessions WHERE token_hash = ?', hash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, address: row.address };
}

function requireCustomer(req) {
  const customer = currentCustomer(req);
  if (!customer) throw new HttpError(401, 'unauthorized', 'Sign in to see your account.');
  return customer;
}

/** Verify a password against a row holding pass_hash/pass_salt. */
function checkPassword(row, password) {
  const hash = row
    ? hashPassword(String(password), row.pass_salt)
    : crypto.scryptSync(String(password), 'decoy', 64).toString('hex');
  return !!row && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.pass_hash, 'hex'));
}

/**
 * Every peso that moves gets a ledger row. Orders are written inside the
 * checkout transaction; bookings start `pending` and are settled when the
 * appointment is completed.
 */
function recordPayment({ kind, orderId = null, bookingId = null, customerId = null,
  amountCents, method = 'card', detail = '', reference = '', status = 'paid', paidAt = null }) {
  const ref = newRef('RCP', 'payments');
  db.run(
    `INSERT INTO payments (ref, kind, order_id, booking_id, customer_id, amount_cents,
                           method, detail, reference, status, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ref, kind, orderId, bookingId, customerId, amountCents,
    method, detail, reference, status, paidAt);
  return ref;
}

/**
 * Card and wallet details are validated for shape, then thrown away: this is
 * a simulated gateway, so nothing downstream ever sees a card number.
 */
function describePayment(method, body) {
  if (method === 'card') {
    const number = String(body.paymentDetail || '').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(number)) {
      fail('paymentDetail', 'Enter a 12–19 digit card number.');
    }
    const name = cleanText(body.cardName, { min: 2, max: 60, field: 'cardName' });
    const expiry = String(body.cardExpiry || '').trim();
    if (!/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/.test(expiry)) {
      fail('cardExpiry', 'Use the expiry as MM/YY.');
    }
    const cvv = String(body.cardCvv || '');
    if (!/^\d{3,4}$/.test(cvv)) fail('cardCvv', 'Enter the 3-digit code on the back.');
    return { detail: `•••• ${number.slice(-4)} · ${name}`, reference: gatewayRef() };
  }
  if (method === 'gcash' || method === 'maya') {
    const wallet = String(body.paymentDetail || '').replace(/\s/g, '');
    if (!/^09\d{9}$/.test(wallet)) {
      fail('paymentDetail', 'Enter the 11-digit mobile number for the wallet.');
    }
    return { detail: `${method === 'gcash' ? 'GCash' : 'Maya'} · ${wallet.slice(0, 4)} ${wallet.slice(-4)}`, reference: gatewayRef() };
  }
  // Cash on delivery: settled on the doorstep, no gateway reference yet.
  return { detail: 'Paid when the order arrives', reference: '' };
}

function gatewayRef() {
  const alphabet = '0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `SIM${out}`;
}

function serializePayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    kind: row.kind,
    order_ref: row.order_ref || null,
    booking_ref: row.booking_ref || null,
    booking_date: row.booking_date || null,
    service: row.service_name || null,
    customer_name: row.customer_name || (row.order_name || row.booking_owner || null),
    customer_email: row.customer_email || row.order_email || row.booking_email || null,
    amount_cents: row.amount_cents,
    method: row.method,
    detail: row.detail,
    reference: row.reference,
    status: row.status,
    created_at: row.created_at,
    paid_at: row.paid_at,
  };
}

/* brute-force guard, per process. Scoped so a shopper fat-fingering their
   password cannot lock the front desk out of their own console. */
const loginAttempts = new Map();
function throttle(ip, scope) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const key = `${scope}|${ip}`;
  const entry = (loginAttempts.get(key) || []).filter((t) => now - t < windowMs);
  loginAttempts.set(key, entry);
  if (entry.length >= 5) {
    throw new HttpError(429, 'rate_limited', 'Too many sign-in attempts. Try again in 15 minutes.');
  }
  return entry;
}

/* ------------------------------------------------------------- the router */

const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, n) => {
    names.push(n);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, rx, names, handler });
}

/* ---------------------------------------------------------------- shop */

route('GET', '/api/shop', () => SHOP);

route('GET', '/api/categories', () => ({
  // Never return a bare array here: the dispatcher reads one as
  // `[payload, status]`, which turns a category into a status code.
  categories: db.all('SELECT slug, name, sort FROM categories ORDER BY sort')
    .map((c) => ({ slug: c.slug, name: c.name })),
}));

route('GET', '/api/services', () => {
  const rows = db.all('SELECT * FROM services WHERE active = 1 ORDER BY sort');
  return { services: rows.map(serializeService) };
});

route('GET', '/api/addons', () => ({
  addons: db.all('SELECT * FROM addons WHERE active = 1 ORDER BY sort').map(serializeAddon),
}));

route('GET', '/api/products', (ctx) => {
  const q = ctx.url.searchParams;
  const category = q.get('category');
  const term = (q.get('q') || '').trim().slice(0, 60);
  const sort = q.get('sort') || 'featured';
  const page = Math.max(1, Number(q.get('page')) || 1);
  const perPage = Math.min(48, Math.max(1, Number(q.get('per')) || 12));

  const where = ['p.active = 1'];
  const args = [];
  if (category) {
    where.push('c.slug = ?');
    args.push(category);
  }
  if (term) {
    where.push('(p.name LIKE ? OR p.blurb LIKE ? OR p.description LIKE ?)');
    const like = `%${term}%`;
    args.push(like, like, like);
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const order = {
    featured: 'p.featured DESC, p.name ASC',
    'price-asc': 'p.price_cents ASC',
    'price-desc': 'p.price_cents DESC',
    name: 'p.name ASC',
  }[sort] || 'p.featured DESC, p.name ASC';

  const total = db.get(`SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id ${clause}`, ...args).n;
  const rows = db.all(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...args, perPage, (page - 1) * perPage);

  return {
    items: rows.map(serializeProduct),
    total,
    page,
    per_page: perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
});

route('GET', '/api/products/:slug', (ctx) => {
  const row = db.get(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ? AND p.active = 1`, ctx.params.slug);
  if (!row) throw notFound('That product has moved on.');
  const related = db.all(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 AND p.category_id = ? AND p.id != ? ORDER BY p.featured DESC LIMIT 4`,
    row.category_id, row.id);
  return { product: serializeProduct(row), related: related.map(serializeProduct) };
});

/* ---------------------------------------------------------- availability */

route('GET', '/api/availability', (ctx) => {
  const { key, date } = parseDate(ctx.url.searchParams.get('date'));
  const serviceId = Number(ctx.url.searchParams.get('serviceId'));
  const service = db.get('SELECT * FROM services WHERE id = ? AND active = 1', serviceId);
  if (!service) throw notFound('Unknown service.');
  return { ...availability(key, date, service.duration_min), service: serializeService(service) };
});

/* -------------------------------------------------------------- bookings */

route('POST', '/api/bookings', (ctx) => {
  const b = ctx.body || {};

  const service = db.get('SELECT * FROM services WHERE id = ? AND active = 1', Number(b.serviceId));
  need(service, 'serviceId', 'Choose a grooming service.');

  const petSize = cleanText(b.petSize, { max: 10, field: 'petSize' });
  need(SIZES.includes(petSize), 'petSize', 'Tell us how big your dog is.');

  const { key, date } = parseDate(b.date);
  const startMin = hhmmToMinutes(b.start);

  const addonIds = Array.isArray(b.addonIds) ? b.addonIds.map(Number).filter(Number.isInteger) : [];
  const addonRows = addonIds.length
    ? db.all(`SELECT * FROM addons WHERE active = 1 AND id IN (${addonIds.map(() => '?').join(',')})`, ...addonIds)
    : [];
  need(addonRows.length === addonIds.length, 'addonIds', 'One of those extras is no longer available.');

  const petName = cleanText(b.petName, { min: 2, max: 40, field: 'petName' });
  const ownerName = cleanText(b.ownerName, { min: 2, max: 60, field: 'ownerName' });
  const email = cleanText(b.email, { min: 1, max: 120, field: 'email' });
  if (!EMAIL_RE.test(email)) fail('email', 'Enter an email we can reply to.');
  const phone = cleanText(b.phone, { min: 7, max: 24, field: 'phone' });
  if (!PHONE_RE.test(phone)) fail('phone', 'Enter a phone number we can ring.');

  const price = priceBooking(service, addonRows, petSize);
  const customer = currentCustomer(ctx.req);

  // BEGIN IMMEDIATE serialises this check against a concurrent booking.
  const created = db.tx(() => {
    const slots = availability(key, date, service.duration_min);
    if (slots.closed) {
      throw conflict(slots.message, [{ field: 'date', message: slots.message }]);
    }
    const slot = slots.slots.find((s) => s.minutes === startMin);
    if (!slot) {
      throw badRequest('That time is outside our opening hours.', [
        { field: 'start', message: 'Pick a time from the list.' },
      ]);
    }
    if (!slot.available) {
      throw conflict('Someone beat you to that slot. Pick another.', [
        { field: 'start', message: 'That slot is now full.' },
      ]);
    }

    const ref = newRef('GRM');
    db.run(
      `INSERT INTO bookings
         (ref, date, start_min, duration_min, service_id, pet_name, pet_type, breed, pet_size, coat,
          owner_name, phone, email, notes, addon_ids, price_cents, status, source, customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'web', ?)`,
      ref, key, startMin, service.duration_min, service.id,
      petName, cleanText(b.petType, { min: 2, max: 30, field: 'petType' }),
      cleanText(b.breed, { max: 40, field: 'breed', required: false }),
      petSize, cleanText(b.coat, { max: 40, field: 'coat', required: false }),
      ownerName, phone, email, cleanText(b.notes, { max: 500, field: 'notes', required: false }),
      JSON.stringify(addonIds), price,
      customer ? customer.id : null
    );

    // Grooming is paid at the desk, so the ledger row opens as revenue we
    // expect rather than money already taken.
    const bookingId = db.get('SELECT id FROM bookings WHERE ref = ?', ref).id;
    const paymentRef = recordPayment({
      kind: 'booking', bookingId, customerId: customer ? customer.id : null,
      amountCents: price, method: 'cash', detail: 'Settled at the shop',
      status: 'pending',
    });
    db.run('UPDATE bookings SET payment_ref = ? WHERE id = ?', paymentRef, bookingId);

    return db.get(
      `SELECT b.*, s.name AS service_name, s.slug AS service_slug
         FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.ref = ?`, ref);
  });

  const booking = serializeBooking(created);
  return [{ booking, receipt: receiptFor('booking', booking) }, 201];
});

route('GET', '/api/bookings/:ref', (ctx) => {
  const row = db.get(`${BOOKING_PAY} WHERE b.ref = ?`, ctx.params.ref.toUpperCase());
  if (!row) throw notFound('No booking with that reference.');
  const booking = serializeBooking(row);
  return { booking, receipt: receiptFor('booking', booking) };
});

/* ---------------------------------------------------------------- orders */

route('POST', '/api/orders', (ctx) => {
  const b = ctx.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  need(items.length > 0, 'items', 'Your basket is empty.');

  const name = cleanText(b.name, { min: 2, max: 60, field: 'name' });
  const email = cleanText(b.email, { min: 1, max: 120, field: 'email' });
  if (!EMAIL_RE.test(email)) fail('email', 'Enter an email we can send the receipt to.');
  const phone = cleanText(b.phone, { max: 24, field: 'phone', required: false });
  if (phone && !PHONE_RE.test(phone)) fail('phone', 'Enter a valid phone number.');

  const fulfilment = b.fulfilment === 'collection' ? 'collection' : 'delivery';
  const address = fulfilment === 'delivery'
    ? cleanText(b.address, { min: 8, max: 240, field: 'address' })
    : `Collected from ${SHOP.address.split(',').slice(0, 2).join(',')}`;

  // Everything a customer can get wrong is checked before BEGIN IMMEDIATE,
  // so a bad card number never holds a write lock.
  const notes = cleanText(b.notes, { max: 500, field: 'notes', required: false });
  const method = PAYMENT_METHODS.includes(b.payment_method) ? b.payment_method : null;
  need(method, 'payment_method', 'Choose how you would like to pay.');
  const payment = describePayment(method, b);
  const customer = currentCustomer(ctx.req);

  const order = db.tx(() => {
    const lines = [];
    const shortages = [];
    let subtotal = 0;

    for (const raw of items) {
      const slug = String(raw.slug || '');
      const qty = Number(raw.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw badRequest('One of your basket quantities is not valid.', [
          { field: 'items', message: 'Quantities must be between 1 and 99.' },
        ]);
      }
      const row = db.get('SELECT * FROM products WHERE slug = ? AND active = 1', slug);
      if (!row) {
        shortages.push({ field: slug, message: 'This product is no longer available.' });
        continue;
      }
      if (row.stock < qty) {
        shortages.push({
          field: slug,
          message: row.stock === 0
            ? `${row.name} is out of stock.`
            : `Only ${row.stock} of ${row.name} left.`,
        });
        continue;
      }
      // Per-line customisation: gift wrap, a message, "leave with the
      // concierge". Carried through to the picking slip.
      const note = cleanText(raw.note, { max: 120, field: 'items', required: false });
      lines.push({
        slug: row.slug, name: row.name, unit_cents: row.price_cents, qty,
        art: row.art, size: row.size, note,
      });
      subtotal += row.price_cents * qty;
    }

    // Partial failure is explicit: one unavailable line cancels the order
    // rather than silently shipping a short basket.
    if (shortages.length) {
      throw conflict('Some items changed while you were shopping.', shortages);
    }

    const shipping = fulfilment === 'collection' || subtotal >= FREE_OVER ? 0 : SHIPPING_FLAT;
    const ref = newRef('ORD', 'orders');

    for (const line of lines) {
      db.run('UPDATE products SET stock = stock - ? WHERE id = (SELECT id FROM products WHERE slug = ?)',
        line.qty, line.slug);
    }

    db.run(
      `INSERT INTO orders (ref, email, name, phone, address, items, subtotal_cents, shipping_cents,
                           total_cents, status, fulfilment, notes, customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?)`,
      ref, email, name, phone, address, JSON.stringify(lines),
      subtotal, shipping, subtotal + shipping, fulfilment, notes,
      customer ? customer.id : null
    );

    const row = db.get('SELECT id FROM orders WHERE ref = ?', ref);
    const paymentRef = recordPayment({
      kind: 'order', orderId: row.id, customerId: customer ? customer.id : null,
      amountCents: subtotal + shipping, method, detail: payment.detail,
      reference: payment.reference,
      status: method === 'cod' ? 'pending' : 'paid',
      paidAt: method === 'cod' ? null : new Date().toISOString(),
    });
    db.run('UPDATE orders SET payment_ref = ? WHERE id = ?', paymentRef, row.id);

    return db.get('SELECT * FROM orders WHERE ref = ?', ref);
  });

  return [{ order: serializeOrder(order), receipt: receiptFor('order', order) }, 201];
});

const LEDGER_FROM = `
  FROM payments p
  LEFT JOIN orders o ON o.id = p.order_id
  LEFT JOIN bookings b ON b.id = p.booking_id
  LEFT JOIN services s ON s.id = b.service_id
  LEFT JOIN customers c ON c.id = p.customer_id`;

/**
 * The transaction history: one row per payment either way, shop and grooming
 * side by side. Filters are always additive so a narrow query is a prefix of
 * a wide one.
 */
function ledger({ kind, status, from, to, where = [], args = [] } = {}) {
  const clauses = [...where];
  const values = [...args];
  if (kind === 'order' || kind === 'booking') {
    clauses.push('p.kind = ?');
    values.push(kind);
  }
  if (['pending', 'paid', 'refunded', 'void'].includes(status)) {
    clauses.push('p.status = ?');
    values.push(status);
  }
  if (from) {
    clauses.push('p.created_at >= ?');
    values.push(`${from} 00:00:00`);
  }
  if (to) {
    clauses.push('p.created_at <= ?');
    values.push(`${to} 23:59:59`);
  }
  const clause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.all(
    `SELECT p.*, o.ref AS order_ref, o.name AS order_name, o.email AS order_email,
            b.ref AS booking_ref, b.date AS booking_date, b.owner_name AS booking_owner,
            b.email AS booking_email, s.name AS service_name,
            c.name AS customer_name, c.email AS customer_email
     ${LEDGER_FROM} ${clause} ORDER BY p.created_at DESC, p.id DESC LIMIT 500`,
    ...values).map(serializePayment);
}

function ledgerFor(customer) {
  return ledger({
    where: ['(p.customer_id = ? OR o.email = ? OR b.email = ?)'],
    args: [customer.id, customer.email, customer.email],
  });
}

/** Refund the ledger row for something that is no longer happening. */
function refundPayment(kind, id, reason) {
  const column = kind === 'order' ? 'order_id' : 'booking_id';
  const pay = db.get(
    `SELECT * FROM payments WHERE kind = ? AND ${column} = ? AND status = 'paid' ORDER BY id DESC LIMIT 1`,
    kind, id);
  if (!pay) return;
  db.run(`UPDATE payments SET status = 'refunded', detail = ? WHERE id = ?`, reason, pay.id);
}

/** Nothing was ever taken, so the expectation simply stops counting. */
function voidPayment(kind, id) {
  const column = kind === 'order' ? 'order_id' : 'booking_id';
  db.run(`UPDATE payments SET status = 'void', detail = ? WHERE kind = ? AND ${column} = ? AND status = 'pending'`,
    'Cancelled — nothing charged', kind, id);
}

/** Cash on delivery turns into revenue when it changes hands. */
function settleCod(orderId) {
  db.run(`UPDATE payments SET status = 'paid', paid_at = ?, detail = ? WHERE kind = 'order' AND order_id = ? AND status = 'pending'`,
    new Date().toISOString(), 'Collected on delivery', orderId);
}

/** Settle a grooming payment once the dog has actually been groomed. */
function settleBookingPayment(id) {
  const pay = db.get(
    `SELECT * FROM payments WHERE kind = 'booking' AND booking_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, id);
  if (!pay) return;
  db.run(`UPDATE payments SET status = 'paid', paid_at = ?, detail = ? WHERE id = ?`,
    new Date().toISOString(), 'Paid at the shop', pay.id);
}

/**
 * The order number a customer quotes, plus the receipt details that sit
 * under it. Derived from the ledger so the two can never disagree.
 */
function receiptFor(kind, row) {
  const pay = db.get(
    `SELECT * FROM payments WHERE kind = ? AND ${kind === 'order' ? 'order_id' : 'booking_id'} = ?`,
    kind, row.id);
  if (!pay) return null;
  return {
    receipt_ref: pay.ref,
    status: pay.status,
    method: pay.method,
    detail: pay.detail,
    reference: pay.reference,
    amount_cents: pay.amount_cents,
    created_at: pay.paid_at || pay.created_at,
  };
}

route('GET', '/api/orders/:ref', (ctx) => {
  const row = db.get(`${ORDER_PAY} WHERE o.ref = ?`, ctx.params.ref.toUpperCase());
  if (!row) throw notFound('No order with that reference.');
  const order = serializeOrder(row);
  return { order, receipt: receiptFor('order', order) };
});

/* ---------------------------------------------------------- customer auth */

route('POST', '/api/auth/register', (ctx) => {
  const b = ctx.body || {};
  const name = cleanText(b.name, { min: 2, max: 60, field: 'name' });
  const email = cleanText(b.email, { max: 120, field: 'email' }).toLowerCase();
  if (!EMAIL_RE.test(email)) fail('email', 'Enter a valid email address.');

  const password = String(b.password || '');
  if (password.length < 8) fail('password', 'Use at least 8 characters.');
  if (password.length > 200) fail('password', 'That password is too long.');

  const phone = cleanText(b.phone, { max: 24, field: 'phone', required: false });
  if (phone && !PHONE_RE.test(phone)) fail('phone', 'Enter a valid phone number.');

  if (db.get('SELECT 1 AS x FROM customers WHERE email = ?', email)) {
    throw conflict('An account already uses that email.', [
      { field: 'email', message: 'Sign in instead, or use a different email.' },
    ]);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  db.run('INSERT INTO customers (email, pass_hash, pass_salt, name, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
    email, hashPassword(password, salt), salt, name, phone,
    cleanText(b.address, { max: 240, field: 'address', required: false }));

  const customer = db.get('SELECT * FROM customers WHERE email = ?', email);
  createCustomerSession(ctx.res, customer);
  return [{ customer: publicCustomer(customer) }, 201];
});

route('POST', '/api/auth/login', (ctx) => {
  const ip = ctx.req.socket.remoteAddress || 'unknown';
  const attempts = throttle(ip, 'customer');

  const email = cleanText(ctx.body?.email, { max: 120, field: 'email' }).toLowerCase();
  const password = String(ctx.body?.password || '');
  if (!password || password.length > 200) {
    attempts.push(Date.now());
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  const customer = db.get('SELECT * FROM customers WHERE email = ?', email);
  if (!checkPassword(customer, password)) {
    // Same decoy work as a real hit, so a wrong email is not measurably
    // faster than a wrong password.
    attempts.push(Date.now());
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  attempts.length = 0;
  createCustomerSession(ctx.res, customer);
  return { customer: publicCustomer(customer) };
});

route('POST', '/api/auth/logout', (ctx) => {
  const token = parseCookies(ctx.req.headers.cookie).snout_customer;
  if (token) {
    db.run('DELETE FROM customer_sessions WHERE token_hash = ?',
      crypto.createHash('sha256').update(token).digest('hex'));
  }
  ctx.res.setHeader('Set-Cookie', 'snout_customer=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/auth/me', (ctx) => {
  // 200-with-null for a signed-out visitor: a page probe is not an error.
  const customer = currentCustomer(ctx.req);
  return { customer, authenticated: !!customer };
});

function publicCustomer(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, address: row.address };
}

/* ------------------------------------------------------------ customer: account */

route('GET', '/api/account/orders', (ctx) => {
  const customer = requireCustomer(ctx.req);
  const rows = db.all(
    `SELECT o.*, p.ref AS pay_ref, p.status AS pay_status, p.method AS pay_method,
            p.detail AS pay_detail, p.reference AS pay_reference
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.kind = 'order'
      WHERE o.customer_id = ? OR o.email = ? ORDER BY o.created_at DESC LIMIT 100`,
    customer.id, customer.email);
  return { orders: rows.map(serializeOrder) };
});

route('GET', '/api/account/bookings', (ctx) => {
  const customer = requireCustomer(ctx.req);
  loadAddons();
  const rows = db.all(
    `${BOOKING_PAY} WHERE b.customer_id = ? OR b.email = ? ORDER BY b.date DESC, b.start_min DESC LIMIT 100`,
    customer.id, customer.email);
  return { bookings: rows.map(serializeBooking) };
});

route('GET', '/api/account/payments', (ctx) => {
  const customer = requireCustomer(ctx.req);
  return { payments: ledgerFor(customer) };
});

route('PATCH', '/api/account', (ctx) => {
  const customer = requireCustomer(ctx.req);
  const b = ctx.body || {};
  const next = {
    name: b.name !== undefined ? cleanText(b.name, { min: 2, max: 60, field: 'name' }) : customer.name,
    phone: b.phone !== undefined
      ? (cleanText(b.phone, { max: 24, field: 'phone', required: false }) || '')
      : customer.phone,
    address: b.address !== undefined
      ? (cleanText(b.address, { max: 240, field: 'address', required: false }) || '')
      : customer.address,
  };
  if (next.phone && !PHONE_RE.test(next.phone)) fail('phone', 'Enter a valid phone number.');
  db.run('UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?',
    next.name, next.phone, next.address, customer.id);
  return { customer: publicCustomer(db.get('SELECT * FROM customers WHERE id = ?', customer.id)) };
});

route('POST', '/api/account/password', (ctx) => {
  const customer = requireCustomer(ctx.req);
  const row = db.get('SELECT * FROM customers WHERE id = ?', customer.id);
  const current = String(ctx.body?.current || '');
  const next = String(ctx.body?.password || '');
  if (!checkPassword(row, current)) fail('current', 'That is not your current password.');
  if (next.length < 8) fail('password', 'Use at least 8 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  db.run('UPDATE customers SET pass_hash = ?, pass_salt = ? WHERE id = ?',
    hashPassword(next, salt), salt, customer.id);
  return { ok: true };
});

/* ----------------------------------------------------------- admin: auth */

route('POST', '/api/admin/login', (ctx) => {
  const ip = ctx.req.socket.remoteAddress || 'unknown';
  const attempts = throttle(ip, 'admin');

  const email = cleanText(ctx.body?.email, { max: 120, field: 'email' }).toLowerCase();
  const password = String(ctx.body?.password || '');
  if (!password || password.length > 200) {
    attempts.push(Date.now());
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  const admin = db.get('SELECT * FROM admins WHERE email = ?', email);
  if (!checkPassword(admin, password)) {
    attempts.push(Date.now());
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  attempts.length = 0;
  createSession(ctx.res, admin);
  return { admin: { id: admin.id, email: admin.email, name: admin.name } };
});

route('POST', '/api/admin/logout', (ctx) => {
  const token = parseCookies(ctx.req.headers.cookie).snout_session;
  if (token) {
    db.run('DELETE FROM sessions WHERE token_hash = ?',
      crypto.createHash('sha256').update(token).digest('hex'));
  }
  ctx.res.setHeader('Set-Cookie', `snout_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { ok: true };
});

route('GET', '/api/admin/me', (ctx) => {
  // A session probe is not a rejected request. Answering 200 with a null
  // admin keeps an unauthenticated page load out of the console error log;
  // real mutations still 401 through requireAdmin().
  const admin = currentAdmin(ctx.req);
  return { admin, authenticated: !!admin };
});

/* ---------------------------------------------------------- admin: reads */

route('GET', '/api/admin/stats', (ctx) => {
  requireAdmin(ctx.req);
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const sums = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'paid' AND kind = 'order'    THEN amount_cents END), 0) AS shop_paid,
       COALESCE(SUM(CASE WHEN status = 'paid' AND kind = 'booking'  THEN amount_cents END), 0) AS groom_paid,
       COALESCE(SUM(CASE WHEN status = 'pending'                   THEN amount_cents END), 0) AS expected,
       COALESCE(SUM(CASE WHEN status = 'refunded'                  THEN amount_cents END), 0) AS refunded
     FROM payments`);

  return {
    today: key,
    bookings_today: db.all(`${BOOKING_PAY} WHERE b.date = ? ORDER BY b.start_min`, key).map(serializeBooking),
    bookings_pending: db.get(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND date >= ?`, key).n,
    orders_open: db.get(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','picking')`).n,
    revenue_cents: sums.shop_paid + sums.groom_paid,
    revenue_shop_cents: sums.shop_paid,
    revenue_grooming_cents: sums.groom_paid,
    pending_cents: sums.expected,
    refunded_cents: sums.refunded,
    low_stock: db.all('SELECT * FROM products WHERE active = 1 AND stock <= 10 ORDER BY stock ASC')
      .map(serializeProduct),
    bookable_today: availability(key, today, 45),
  };
});

route('GET', '/api/admin/bookings', (ctx) => {
  requireAdmin(ctx.req);
  loadAddons();
  const from = ctx.url.searchParams.get('from');
  const status = ctx.url.searchParams.get('status');
  const where = [];
  const args = [];
  if (from) { where.push('b.date >= ?'); args.push(from); }
  if (status && BOOKING_STATUSES.includes(status)) { where.push('b.status = ?'); args.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    bookings: db.all(`${BOOKING_PAY} ${clause} ORDER BY b.date, b.start_min LIMIT 200`, ...args)
      .map(serializeBooking),
  };
});

route('GET', '/api/admin/orders', (ctx) => {
  requireAdmin(ctx.req);
  return {
    orders: db.all(`${ORDER_PAY} ORDER BY o.created_at DESC LIMIT 200`).map(serializeOrder),
  };
});

/** Transaction history for shop and grooming, in one list. */
route('GET', '/api/admin/payments', (ctx) => {
  requireAdmin(ctx.req);
  const q = ctx.url.searchParams;
  const payments = ledger({
    kind: q.get('kind') || undefined,
    status: q.get('status') || undefined,
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
  });
  const totals = payments.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + p.amount_cents;
    acc[`${p.kind}_${p.status}`] = (acc[`${p.kind}_${p.status}`] || 0) + p.amount_cents;
    return acc;
  }, {});
  return { payments, count: payments.length, totals };
});

route('GET', '/api/admin/products', (ctx) => {
  requireAdmin(ctx.req);
  const includeInactive = ctx.url.searchParams.get('all') === '1';
  const clause = includeInactive ? '' : 'AND p.active = 1';
  return {
    products: db.all(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name
         FROM products p JOIN categories c ON c.id = p.category_id
        WHERE 1 = 1 ${clause} ORDER BY c.sort, p.name`).map(serializeProduct),
  };
});

/* ------------------------------------------------------- admin: mutations */

route('PATCH', '/api/admin/bookings/:id', (ctx) => {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const status = ctx.body?.status;
  if (!BOOKING_STATUSES.includes(status)) {
    throw badRequest('Unknown booking status.', [{ field: 'status', message: 'Choose a valid status.' }]);
  }
  const row = db.get('SELECT * FROM bookings WHERE id = ?', id);
  if (!row) throw notFound('That booking does not exist.');

  db.tx(() => {
    db.run('UPDATE bookings SET status = ? WHERE id = ?', status, id);
    if (status === 'complete') settleBookingPayment(id);
    if (status === 'cancelled' && row.status !== 'cancelled') voidPayment('booking', id);
  });
  return { booking: serializeBooking(db.get(`${BOOKING_PAY} WHERE b.id = ?`, id)) };
});

route('PATCH', '/api/admin/orders/:id', (ctx) => {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const status = ctx.body?.status;
  if (!ORDER_STATUSES.includes(status)) {
    throw badRequest('Unknown order status.', [{ field: 'status', message: 'Choose a valid status.' }]);
  }
  const row = db.get('SELECT * FROM orders WHERE id = ?', id);
  if (!row) throw notFound('That order does not exist.');

  db.tx(() => {
    // Cancelling puts the stock back; anything else leaves it alone.
    if (status === 'cancelled' && row.status !== 'cancelled') {
      for (const line of JSON.parse(row.items)) {
        db.run('UPDATE products SET stock = stock + ? WHERE slug = ?', line.qty, line.slug);
      }
      refundPayment('order', id, 'Order cancelled — refunded');
    }
    // Cash on delivery only becomes revenue once it changes hands.
    if (status === 'shipped') settleCod(id);
    db.run('UPDATE orders SET status = ? WHERE id = ?', status, id);
  });
  return { order: serializeOrder(db.get(`${ORDER_PAY} WHERE o.id = ?`, id)) };
});

route('POST', '/api/admin/products', (ctx) => {
  requireAdmin(ctx.req);
  const p = ctx.body || {};
  const slug = cleanText(p.slug, { max: 60, field: 'slug' }).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  need(slug.length >= 3, 'slug', 'Add a short URL slug.');
  need(!db.get('SELECT 1 AS x FROM products WHERE slug = ?', slug), 'slug', 'That slug is already in use.');

  const category = db.get('SELECT id FROM categories WHERE slug = ?', String(p.category || ''));
  need(category, 'category', 'Choose a category.');
  const categoryId = category.id;

  const stock = Number(p.stock);
  need(Number.isInteger(stock) && stock >= 0, 'stock', 'Stock must be a whole number or more.');

  db.run(
    `INSERT INTO products (slug, name, category_id, price_cents, blurb, description, detail, size, art, stock, featured, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    slug, cleanText(p.name, { min: 3, max: 80, field: 'name' }), categoryId,
    moneyToInteger(p.price, 'price'),
    cleanText(p.blurb, { max: 140, field: 'blurb', required: false }),
    cleanText(p.description, { max: 600, field: 'description', required: false }),
    cleanText(p.detail, { max: 600, field: 'detail', required: false }),
    cleanText(p.size, { max: 30, field: 'size', required: false }),
    cleanText(p.art, { max: 20, field: 'art', required: false }) || 'bag',
    stock, p.featured ? 1 : 0, 1
  );
  const product = db.get(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.slug = ?`, slug);
  return [{ product: serializeProduct(product) }, 201];
});

route('PATCH', '/api/admin/products/:id', (ctx) => {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const row = db.get('SELECT * FROM products WHERE id = ?', id);
  if (!row) throw notFound('That product does not exist.');
  const p = ctx.body || {};

  // The slug is deliberately not editable: every product URL and every line
  // item already written into an order points at it.
  let categoryId = row.category_id;
  if (p.category !== undefined) {
    const category = db.get('SELECT id FROM categories WHERE slug = ?', String(p.category || ''));
    need(category, 'category', 'Choose a category.');
    categoryId = category.id;
  }

  const next = {
    name: p.name !== undefined ? cleanText(p.name, { min: 3, max: 80, field: 'name' }) : row.name,
    price_cents: p.price !== undefined ? moneyToInteger(p.price, 'price') : row.price_cents,
    stock: p.stock !== undefined
      ? (need(Number.isInteger(Number(p.stock)) && Number(p.stock) >= 0, 'stock', 'Stock must be 0 or more.'),
        Number(p.stock))
      : row.stock,
    active: p.active !== undefined ? (p.active ? 1 : 0) : row.active,
    featured: p.featured !== undefined ? (p.featured ? 1 : 0) : row.featured,
    category_id: categoryId,
    blurb: p.blurb !== undefined ? cleanText(p.blurb, { max: 140, field: 'blurb', required: false }) : row.blurb,
    description: p.description !== undefined ? cleanText(p.description, { max: 600, field: 'description', required: false }) : row.description,
    detail: p.detail !== undefined ? cleanText(p.detail, { max: 600, field: 'detail', required: false }) : row.detail,
    size: p.size !== undefined ? cleanText(p.size, { max: 30, field: 'size', required: false }) : row.size,
    art: p.art !== undefined ? (cleanText(p.art, { max: 20, field: 'art', required: false }) || 'bag') : row.art,
  };

  db.run(
    `UPDATE products SET name = ?, price_cents = ?, stock = ?, active = ?, featured = ?,
            category_id = ?, blurb = ?, description = ?, detail = ?, size = ?, art = ?
      WHERE id = ?`,
    next.name, next.price_cents, next.stock, next.active, next.featured,
    next.category_id, next.blurb, next.description, next.detail, next.size, next.art, id);

  return { product: serializeProduct(db.get(
    `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, id)) };
});

route('DELETE', '/api/admin/products/:id', (ctx) => {
  requireAdmin(ctx.req);
  const id = Number(ctx.params.id);
  const row = db.get('SELECT * FROM products WHERE id = ?', id);
  if (!row) throw notFound('That product does not exist.');
  // Soft delete: orders already reference this product historically.
  db.run('UPDATE products SET active = 0 WHERE id = ?', id);
  return { ok: true, slug: row.slug };
});

/** `YYYY-MM-DD` in the server's local day. */
function isoDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const PAYMENT_LABELS = {
  card: 'Card', gcash: 'GCash', maya: 'Maya', cod: 'Cash on delivery', cash: 'Cash at the shop',
};

/**
 * Basic sales report. Money always comes from the ledger; line items are
 * joined on afterwards so what is charted and what was banked agree.
 */
route('GET', '/api/admin/report', (ctx) => {
  requireAdmin(ctx.req);
  const q = ctx.url.searchParams;
  const today = isoDay(new Date());
  const to = q.get('to') || today;
  const requestedFrom = q.get('from') || isoDay(new Date(Date.now() - 29 * 86400000));
  parseDate(requestedFrom, 'from');
  parseDate(to, 'to');
  need(requestedFrom <= to, 'from', 'The start date must come before the end date.');

  // The chart draws one bar per day, so "everything since forever" would be
  // both unreadable and expensive. Slide the window rather than refuse it.
  const endDate = new Date(`${to}T00:00:00`);
  const floor = isoDay(new Date(endDate.getTime() - 365 * 86400000));
  const from = requestedFrom < floor ? floor : requestedFrom;

  const paidShop = db.all(
    `SELECT p.amount_cents, p.method, p.created_at, o.items, o.ref
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.kind = 'order' AND p.status = 'paid'
        AND substr(p.created_at, 1, 10) BETWEEN ? AND ?`, from, to);

  const paidGroom = db.all(
    `SELECT p.amount_cents, p.method, p.created_at, s.name AS service_name, b.date
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN services s ON s.id = b.service_id
      WHERE p.kind = 'booking' AND p.status = 'paid'
        AND substr(p.created_at, 1, 10) BETWEEN ? AND ?`, from, to);

  const expected = db.get(
    `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments
      WHERE status = 'pending' AND substr(created_at, 1, 10) BETWEEN ? AND ?`, from, to).n;
  const refunded = db.get(
    `SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments
      WHERE status = 'refunded' AND substr(created_at, 1, 10) BETWEEN ? AND ?`, from, to).n;

  const categories = new Map(
    db.all('SELECT p.slug, p.name, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id')
      .map((r) => [r.slug, r]));

  const productMap = new Map();
  const categoryMap = new Map();
  const methodMap = new Map();
  let units = 0;

  const tallyMethod = (method, amount) => {
    const key = method || 'cash';
    const row = methodMap.get(key) || { method: key, label: PAYMENT_LABELS[key] || key, count: 0, revenue_cents: 0 };
    row.count += 1;
    row.revenue_cents += amount;
    methodMap.set(key, row);
  };

  for (const r of paidShop) {
    tallyMethod(r.method, r.amount_cents);
    for (const line of JSON.parse(r.items || '[]')) {
      units += line.qty;
      const revenue = line.unit_cents * line.qty;
      const p = productMap.get(line.slug) || { slug: line.slug, name: line.name, units: 0, revenue_cents: 0 };
      p.units += line.qty;
      p.revenue_cents += revenue;
      productMap.set(line.slug, p);

      const cat = categories.get(line.slug)?.category || 'Uncategorised';
      const c = categoryMap.get(cat) || { category: cat, units: 0, revenue_cents: 0 };
      c.units += line.qty;
      c.revenue_cents += revenue;
      categoryMap.set(cat, c);
    }
  }

  const serviceMap = new Map();
  for (const r of paidGroom) {
    tallyMethod(r.method, r.amount_cents);
    const s = serviceMap.get(r.service_name)
      || { name: r.service_name, bookings: 0, revenue_cents: 0 };
    s.bookings += 1;
    s.revenue_cents += r.amount_cents;
    serviceMap.set(r.service_name, s);
  }

  // Every day in the window, including the empty ones, so the chart has a
  // continuous x axis instead of skipping quiet days.
  const days = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const dayMap = new Map();
  while (cursor <= end) {
    const key = isoDay(cursor);
    const cell = { date: key, revenue_cents: 0, orders: 0, bookings: 0 };
    days.push(cell);
    dayMap.set(key, cell);
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const r of paidShop) {
    const cell = dayMap.get(r.created_at.slice(0, 10));
    if (cell) { cell.revenue_cents += r.amount_cents; cell.orders += 1; }
  }
  for (const r of paidGroom) {
    const cell = dayMap.get(r.created_at.slice(0, 10));
    if (cell) { cell.revenue_cents += r.amount_cents; cell.bookings += 1; }
  }

  const shopCents = paidShop.reduce((sum, r) => sum + r.amount_cents, 0);
  const groomCents = paidGroom.reduce((sum, r) => sum + r.amount_cents, 0);
  const orderCount = paidShop.length;
  const bookingCount = paidGroom.length;
  const transactionCount = orderCount + bookingCount;

  return {
    range: { from, to },
    totals: {
      revenue_cents: shopCents + groomCents,
      shop_cents: shopCents,
      grooming_cents: groomCents,
      refunded_cents: refunded,
      expected_cents: expected,
      order_count: orderCount,
      booking_count: bookingCount,
      transaction_count: transactionCount,
      units_sold: units,
      average_order_cents: transactionCount ? Math.round((shopCents + groomCents) / transactionCount) : 0,
    },
    days,
    top_products: [...productMap.values()].sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 10),
    top_services: [...serviceMap.values()].sort((a, b) => b.revenue_cents - a.revenue_cents),
    by_category: [...categoryMap.values()].sort((a, b) => b.revenue_cents - a.revenue_cents),
    by_method: [...methodMap.values()].sort((a, b) => b.revenue_cents - a.revenue_cents),
  };
});

module.exports = { routes, HttpError, HOURS, SHOP, PAYMENT_METHODS };
