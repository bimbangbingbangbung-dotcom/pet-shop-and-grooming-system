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
const SHIPPING_FLAT = 395;
const FREE_OVER = 4000;
const LEAD_MINUTES = 60;     // same-day bookings need an hour's notice
const SESSION_TTL = 8 * 60 * 60 * 1000;

const SHOP = {
  name: 'Snip & Snout',
  strapline: 'Pet shop & grooming parlour',
  address: '42 Well Lane, Bramley, Leeds BS4 2QN',
  phone: '0117 496 2210',
  email: 'hello@snipandsnout.co.uk',
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

function serializeBooking(row) {
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
    addon_ids: JSON.parse(row.addon_ids || '[]'),
    price_cents: row.price_cents,
    status: row.status,
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
    created_at: row.created_at,
  };
}

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

function newRef(prefix) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  do {
    out = '';
    for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  } while (db.get('SELECT 1 AS x FROM bookings WHERE ref = ?', `${prefix}-${out}`));
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

/* brute-force guard, per process */
const loginAttempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = (loginAttempts.get(ip) || []).filter((t) => now - t < windowMs);
  loginAttempts.set(ip, entry);
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
          owner_name, phone, email, notes, addon_ids, price_cents, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'web')`,
      ref, key, startMin, service.duration_min, service.id,
      petName, cleanText(b.petType, { min: 2, max: 30, field: 'petType' }),
      cleanText(b.breed, { max: 40, field: 'breed', required: false }),
      petSize, cleanText(b.coat, { max: 40, field: 'coat', required: false }),
      ownerName, phone, email, cleanText(b.notes, { max: 500, field: 'notes', required: false }),
      JSON.stringify(addonIds), price
    );
    return db.get(
      `SELECT b.*, s.name AS service_name, s.slug AS service_slug
         FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.ref = ?`, ref);
  });

  return [{ booking: serializeBooking(created) }, 201];
});

route('GET', '/api/bookings/:ref', (ctx) => {
  const row = db.get('SELECT * FROM bookings WHERE ref = ?', ctx.params.ref.toUpperCase());
  if (!row) throw notFound('No booking with that reference.');
  return { booking: serializeBooking(row) };
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
    : 'Collected from 42 Well Lane';

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
      lines.push({
        slug: row.slug, name: row.name, unit_cents: row.price_cents, qty,
        art: row.art, size: row.size,
      });
      subtotal += row.price_cents * qty;
    }

    // Partial failure is explicit: one unavailable line cancels the order
    // rather than silently shipping a short basket.
    if (shortages.length) {
      throw conflict('Some items changed while you were shopping.', shortages);
    }

    const shipping = fulfilment === 'collection' || subtotal >= FREE_OVER ? 0 : SHIPPING_FLAT;
    const ref = newRef('ORD');

    for (const line of lines) {
      db.run('UPDATE products SET stock = stock - ? WHERE id = (SELECT id FROM products WHERE slug = ?)',
        line.qty, line.slug);
    }

    db.run(
      `INSERT INTO orders (ref, email, name, phone, address, items, subtotal_cents, shipping_cents, total_cents, status, fulfilment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`,
      ref, email, name, phone, address, JSON.stringify(lines),
      subtotal, shipping, subtotal + shipping, fulfilment
    );

    return db.get('SELECT * FROM orders WHERE ref = ?', ref);
  });

  return [{ order: serializeOrder(order) }, 201];
});

route('GET', '/api/orders/:ref', (ctx) => {
  const row = db.get('SELECT * FROM orders WHERE ref = ?', ctx.params.ref.toUpperCase());
  if (!row) throw notFound('No order with that reference.');
  return { order: serializeOrder(row) };
});

/* ----------------------------------------------------------- admin: auth */

route('POST', '/api/admin/login', (ctx) => {
  const ip = ctx.req.socket.remoteAddress || 'unknown';
  const attempts = throttle(ip);

  const email = cleanText(ctx.body?.email, { max: 120, field: 'email' }).toLowerCase();
  const password = String(ctx.body?.password || '');
  if (!password || password.length > 200) {
    attempts.push(Date.now());
    throw new HttpError(401, 'invalid_credentials', 'That email and password do not match.');
  }

  const admin = db.get('SELECT * FROM admins WHERE email = ?', email);
  const hash = admin
    ? hashPassword(password, admin.pass_salt)
    : crypto.scryptSync(password, 'decoy', 64).toString('hex');

  const ok = admin && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.pass_hash, 'hex'));
  if (!ok) {
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

  const revenue = db.get(`SELECT COALESCE(SUM(total_cents), 0) AS n FROM orders WHERE status != 'cancelled'`).n;
  return {
    today: key,
    bookings_today: db.all(
      `SELECT b.*, s.name AS service_name, s.slug AS service_slug
         FROM bookings b JOIN services s ON s.id = b.service_id
        WHERE b.date = ? ORDER BY b.start_min`, key).map(serializeBooking),
    bookings_pending: db.get(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND date >= ?`, key).n,
    orders_open: db.get(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','picking')`).n,
    revenue_cents: revenue,
    low_stock: db.all('SELECT * FROM products WHERE active = 1 AND stock <= 10 ORDER BY stock ASC')
      .map(serializeProduct),
    bookable_today: availability(key, today, 45),
  };
});

route('GET', '/api/admin/bookings', (ctx) => {
  requireAdmin(ctx.req);
  const from = ctx.url.searchParams.get('from');
  const status = ctx.url.searchParams.get('status');
  const where = [];
  const args = [];
  if (from) { where.push('b.date >= ?'); args.push(from); }
  if (status && BOOKING_STATUSES.includes(status)) { where.push('b.status = ?'); args.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    bookings: db.all(
      `SELECT b.*, s.name AS service_name, s.slug AS service_slug
         FROM bookings b JOIN services s ON s.id = b.service_id
        ${clause} ORDER BY b.date, b.start_min LIMIT 200`, ...args).map(serializeBooking),
  };
});

route('GET', '/api/admin/orders', (ctx) => {
  requireAdmin(ctx.req);
  return { orders: db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').map(serializeOrder) };
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
  db.run('UPDATE bookings SET status = ? WHERE id = ?', status, id);
  return { booking: serializeBooking(db.get('SELECT * FROM bookings WHERE id = ?', id)) };
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
    }
    db.run('UPDATE orders SET status = ? WHERE id = ?', status, id);
  });
  return { order: serializeOrder(db.get('SELECT * FROM orders WHERE id = ?', id)) };
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

  const next = {
    name: p.name !== undefined ? cleanText(p.name, { min: 3, max: 80, field: 'name' }) : row.name,
    price_cents: p.price !== undefined ? moneyToInteger(p.price, 'price') : row.price_cents,
    stock: p.stock !== undefined
      ? (need(Number.isInteger(Number(p.stock)) && Number(p.stock) >= 0, 'stock', 'Stock must be 0 or more.'),
        Number(p.stock))
      : row.stock,
    active: p.active !== undefined ? (p.active ? 1 : 0) : row.active,
    featured: p.featured !== undefined ? (p.featured ? 1 : 0) : row.featured,
  };

  db.run('UPDATE products SET name = ?, price_cents = ?, stock = ?, active = ?, featured = ? WHERE id = ?',
    next.name, next.price_cents, next.stock, next.active, next.featured, id);

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

module.exports = { routes, HttpError, HOURS, SHOP };
