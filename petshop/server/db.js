'use strict';

/**
 * Data layer. Uses node:sqlite (built into Node 22) so the project has no
 * runtime dependencies. Every value that reaches the database goes through
 * `settle()` because the driver rejects undefined and booleans.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'snipandsnout.db');

/** undefined -> null, boolean -> 0/1, everything else passes through. */
function settle(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function params(list) {
  return list.map(settle);
}

class Db {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec('PRAGMA foreign_keys = ON;');
    this.sql.exec('PRAGMA busy_timeout = 5000;');
    this.schema();
  }

  schema() {
    this.sql.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      slug   TEXT NOT NULL UNIQUE,
      name   TEXT NOT NULL,
      sort   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      slug             TEXT NOT NULL UNIQUE,
      name             TEXT NOT NULL,
      category_id      INTEGER NOT NULL REFERENCES categories(id),
      price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
      compare_at_cents INTEGER,
      blurb            TEXT NOT NULL DEFAULT '',
      description      TEXT NOT NULL DEFAULT '',
      detail           TEXT NOT NULL DEFAULT '',
      size             TEXT NOT NULL DEFAULT '',
      art              TEXT NOT NULL DEFAULT 'bag',
      stock            INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      featured         INTEGER NOT NULL DEFAULT 0,
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS products_category ON products(category_id, active);

    CREATE TABLE IF NOT EXISTS services (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      tagline     TEXT NOT NULL DEFAULT '',
      summary     TEXT NOT NULL DEFAULT '',
      duration_min INTEGER NOT NULL CHECK (duration_min > 0),
      price_small  INTEGER NOT NULL,
      price_medium INTEGER NOT NULL,
      price_large  INTEGER NOT NULL,
      flat_price   INTEGER NOT NULL DEFAULT 0,
      includes     TEXT NOT NULL DEFAULT '[]',
      note         TEXT NOT NULL DEFAULT '',
      sort         INTEGER NOT NULL DEFAULT 0,
      active       INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS addons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      active      INTEGER NOT NULL DEFAULT 1,
      sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ref         TEXT NOT NULL UNIQUE,
      date        TEXT NOT NULL,              -- YYYY-MM-DD
      start_min   INTEGER NOT NULL,           -- minutes from local midnight
      duration_min INTEGER NOT NULL,
      service_id  INTEGER NOT NULL REFERENCES services(id),
      pet_name    TEXT NOT NULL,
      pet_type    TEXT NOT NULL,
      breed       TEXT NOT NULL DEFAULT '',
      pet_size    TEXT NOT NULL,              -- small | medium | large
      coat        TEXT NOT NULL DEFAULT '',
      owner_name  TEXT NOT NULL,
      phone       TEXT NOT NULL,
      email       TEXT NOT NULL,
      notes       TEXT NOT NULL DEFAULT '',
      addon_ids   TEXT NOT NULL DEFAULT '[]',
      price_cents INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | arrived | complete | cancelled
      source      TEXT NOT NULL DEFAULT 'web',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS bookings_when ON bookings(date, start_min);

    CREATE TABLE IF NOT EXISTS orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ref          TEXT NOT NULL UNIQUE,
      email        TEXT NOT NULL,
      name         TEXT NOT NULL,
      phone        TEXT NOT NULL DEFAULT '',
      address      TEXT NOT NULL DEFAULT '',
      items        TEXT NOT NULL,             -- [{slug,name,unit_cents,qty}]
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      total_cents  INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'paid',  -- paid | picking | shipped | cancelled
      fulfilment   TEXT NOT NULL DEFAULT 'delivery', -- delivery | collection
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      email     TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      name      TEXT NOT NULL DEFAULT 'Front desk'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES admins(id),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      pass_salt  TEXT NOT NULL,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL DEFAULT '',
      address    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Separate table and separate cookie from the admin session table, so
    -- signing in as a customer can never satisfy an admin check or the
    -- other way round.
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash  TEXT PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      expires_at  INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One ledger for every peso that moves, shop and grooming alike. Bookings
    -- start pending (revenue expected at the desk) and flip to paid when
    -- the appointment is completed; orders are paid at checkout.
    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ref          TEXT NOT NULL UNIQUE,        -- receipt number, RCP-XXXXXX
      kind         TEXT NOT NULL,               -- order | booking
      order_id     INTEGER REFERENCES orders(id),
      booking_id   INTEGER REFERENCES bookings(id),
      customer_id  INTEGER REFERENCES customers(id),
      amount_cents INTEGER NOT NULL,
      method       TEXT NOT NULL DEFAULT 'card', -- card | gcash | maya | cod | cash
      detail       TEXT NOT NULL DEFAULT '',     -- last 4 / wallet number / —
      reference    TEXT NOT NULL DEFAULT '',     -- simulated gateway reference
      status       TEXT NOT NULL DEFAULT 'pending', -- pending | paid | refunded | void
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS payments_when ON payments(created_at);
    CREATE INDEX IF NOT EXISTS payments_status ON payments(status, kind);
    `);

    this.migrate();
  }

  /**
   * Columns added after a database already existed. `CREATE TABLE IF NOT
   * EXISTS` cannot add them, and the demo data is cheaper to keep than to
   * assume every install is fresh.
   */
  migrate() {
    const columns = (table) => new Set(
      this.all(`PRAGMA table_info(${table})`).map((c) => c.name));

    const add = (table, name, definition) => {
      if (!columns(table).has(name)) this.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };

    add('orders', 'customer_id', 'INTEGER REFERENCES customers(id)');
    add('orders', 'notes', "TEXT NOT NULL DEFAULT ''");
    add('orders', 'payment_ref', "TEXT NOT NULL DEFAULT ''");
    add('bookings', 'customer_id', 'INTEGER REFERENCES customers(id)');
    add('bookings', 'payment_ref', "TEXT NOT NULL DEFAULT ''");
  }

  run(sql, ...args) {
    return this.sql.prepare(sql).run(...params(args));
  }

  get(sql, ...args) {
    return this.sql.prepare(sql).get(...params(args));
  }

  all(sql, ...args) {
    return this.sql.prepare(sql).all(...params(args));
  }

  /**
   * Multi-statement transaction. Rolls back on any throw, so a failed
   * booking can never leave a half-written row behind.
   */
  tx(fn) {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.sql.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.sql.exec('ROLLBACK');
      } catch (_) {
        /* the outer transaction is already gone */
      }
      throw err;
    }
  }
}

const db = new Db(process.env.DB_FILE || DB_FILE);

module.exports = { db, DB_FILE };
