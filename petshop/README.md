# Snip & Snout — pet shop & grooming parlour

A complete shop + grooming booking system: static HTML/ES-module frontend, a
zero-dependency Node backend, and a SQLite database. No build step, no npm
packages — the only requirement is Node 22.5 or newer (for `node:sqlite`).

128 Maginhawa Street, Teachers Village East, Diliman, Quezon City 1101.
All prices in Philippine pesos.

---

## Run it

```bash
cd petshop
node server/server.js     # or: npm start
```

Then open <http://127.0.0.1:4173>.

The first run creates and seeds `data/snipandsnout.db`. To wipe it and start
from a clean demo dataset (removes every booking and order made while poking
around):

```bash
npm run seed              # runs seed.js --force
```

| | |
|---|---|
| Port | `4173` — override with `PORT=8080 node server/server.js` |
| Bind | `127.0.0.1` — override with `HOST=0.0.0.0` |
| Staff console | <http://127.0.0.1:4173/admin> — `admin@snipandsnout.ph` / `groom1234` |
| Customer account | <http://127.0.0.1:4173/login> — `maria@example.com` / `shop1234` |
| Password override | `ADMIN_PASSWORD=… node server/server.js` |

---

## Pages

| Route | What it does |
|---|---|
| `/` | Hero with the before/after compare sweep, services menu, featured products, opening hours, quotes |
| `/services` | The full grooming menu with prices by dog size, extras, and the FAQ |
| `/shop` | Catalogue with category filter, search, sort and pagination |
| `/product?slug=…` | Product detail, quantity stepper, related shelf |
| `/booking` | Four-step booking: service → pet → day and time → details |
| `/cart` | Basket: quantities, per-line notes, delivery or collection |
| `/checkout` | Details, payment method, simulated charge |
| `/login` | Sign in or create an account (two tabs, one page) |
| `/account` | Orders, appointments, receipts, your details |
| `/done?ref=…` | Receipt and status for an order (`ORD-…`) or a groom (`GRM-…`) |
| `/admin` | Staff console: today, bookings, orders, products, transactions, sales report |

Extensionless URLs work — `/shop` serves `shop.html`. `/register` and
`/signin` redirect to `/login`.

---

## API

All endpoints are JSON. Money is integer **centavos** (₱1,590 is `159000`);
grooming slots are a `date` plus `start_min` (minutes from midnight).

### Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/shop` | Shop identity, hours, delivery thresholds (₱150, free over ₱2,500) |
| GET | `/api/categories` | Categories with product counts |
| GET | `/api/services` | Services, price tiers, includes, notes |
| GET | `/api/addons` | Bookable extras |
| GET | `/api/products` | `?q=`, `?category=`, `?sort=`, `?page=`, `?per=` |
| GET | `/api/products/:slug` | One product plus up to 4 related items |
| GET | `/api/availability` | `?date=YYYY-MM-DD&serviceId=` — free slots for that day |
| POST | `/api/bookings` | Create a groom; 409 on a slot that just filled |
| GET | `/api/bookings/:ref` | Look up `GRM-…` with its receipt |
| POST | `/api/orders` | Server re-prices everything; never trusts the client |
| GET | `/api/orders/:ref` | Look up `ORD-…` with its receipt |

### Accounts (`snout_customer` cookie, separate from staff)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | Creates the account and signs in |
| POST | `/api/auth/login` | Rate-limited; `POST /api/auth/logout` to end |
| GET | `/api/auth/me` | `200 { customer: null }` when signed out |
| GET | `/api/account/orders` | Order history with status and receipts |
| GET | `/api/account/bookings` | Appointments with status |
| GET | `/api/account/payments` | Everything they have paid for |
| PATCH | `/api/account` | Name, phone, address |
| POST | `/api/account/password` | Change password |

Guest checkout still works: an order reference resolves without signing in.

### Staff (`snout_session` cookie, set by `POST /api/admin/login`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/login` | Rate-limited; `POST /api/admin/logout` to end |
| GET | `/api/admin/me` | `200 { admin: null }` when signed out |
| GET | `/api/admin/stats` | Today's grooms, orders to send, takings split shop / grooming |
| GET | `/api/admin/bookings` | `?status=`, `?from=` |
| GET | `/api/admin/orders` | |
| GET | `/api/admin/payments` | `?kind=`, `?status=`, `?from=`, `?to=` — shop and grooming together |
| GET | `/api/admin/report` | `?from=`, `?to=` — totals, by day, top products and services, by category, by method |
| GET | `/api/admin/products` | `?all=1` includes hidden rows |
| PATCH | `/api/admin/bookings/:id` | Completing settles the payment; cancelling voids it |
| PATCH | `/api/admin/orders/:id` | Cancelling reclaims stock and refunds |
| POST/PATCH/DELETE | `/api/admin/products[/:id]` | Create, edit, soft delete |

Errors always come back as:

```json
{ "error": { "code": "conflict", "message": "…", "details": [{ "field": "…", "message": "…" }] } }
```

`409` means the slot was taken between the availability check and the insert;
the booking form re-fetches and offers the next day. The same code covers a
basket line that sold out while you were shopping.

---

## Payments

Simulated, deliberately. Nothing is charged and no gateway is contacted.

- Card and wallet numbers are validated for **shape only**, then thrown away —
  the ledger stores `•••• 4242` and a generated `SIM…` reference.
- Every peso gets a row in `payments`: orders are written `paid` inside the
  checkout transaction, bookings open `pending` and flip to `paid` when the
  appointment is completed, cash-on-delivery flips when it changes hands.
- Cancelling refunds a `paid` row and voids a `pending` one, so the report's
  "taken" and "expected" numbers never mix.

A real gateway can replace the simulation behind the same `describePayment()`
function without touching checkout.

---

## How it fits together

```
server/
  server.js   HTTP: static files, brotli, ETag/304, CSP, origin check, 404 page
  api.js      ~34 routes, validation, two session types, payments, report
  db.js       schema + migrations + connection (node:sqlite)
  seed.js     6 categories, 15 products, 5 services, 6 addons, both demo accounts
public/
  *.html      eleven pages, server-rendered skeletons baked into the markup
  assets/css/  base.css (tokens, forms, states) + app.css (page components)
  assets/js/   ui.js (states, toasts, validation, status tracks) and one script per page
  assets/js/   art.js  every illustration, drawn inline as SVG
```

Decisions worth knowing:

- **The basket lives in `localStorage`** (`snout.cart.v1`) and is display only.
  The server re-prices every line from the database when the order is placed,
  so a doctored basket cannot buy anything cheap. Checkout choices (delivery
  vs collection, payment method, order note) live in `sessionStorage`.
- **Two sign-ins, two cookies.** `snout_session` is staff, `snout_customer` is a
  shopper, and neither opens the other's routes.
- **Availability is always the server's answer.** The client never decides a
  slot is free. Capacity is 2 concurrent grooms; opening hours are Tue–Sun and
  the shop is closed on Mondays.
- **Illustrations are code.** `art.js` draws 12 product types as SVG, so there
  are no stock photos and nothing to download.

### Layout stability

Skeletons are baked into the HTML rather than injected by JavaScript. The page
scripts are ES modules, so they only run at `DOMContentLoaded` — injecting the
placeholder then means the browser paints an empty slot first and the page
jumps when the skeleton lands. Keeping the placeholder in the markup means the
first paint is already the right height. `catalog.js` is still the source of
truth for what a skeleton looks like; re-bake after changing it.

---

## Verified

Run with a headless Chrome against a live server:

- **Accessibility / UX floors** — 4.5:1 text contrast, 44px control targets
  (24px for text links, per WCAG 2.5.8), exactly one visible `<h1>` per page,
  labelled fields, `alt` on every image, and CLS ≤ 0.05.
- **End-to-end** — register, sign in, order and pay, read the receipt, book a
  groom and complete it; sign in to the staff console and move through every
  view including the transaction ledger and the sales report. No console, page
  or HTTP errors on any flow.
