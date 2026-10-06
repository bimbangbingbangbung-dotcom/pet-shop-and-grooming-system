# Snip & Snout

Pet shop and grooming parlour website. Two jobs on one site:

1. **Retail** — product catalogue, basket, checkout, delivery or collection.
2. **Grooming** — bookable appointments with a live diary, priced by pet size.

It is a **modular monolith with no dependencies**: one Node process, one
SQLite file, a static frontend. No build step, no bundler, no npm packages —
`npm start` is the whole story.

## Running it

```
cd petshop
npm start
```

Then open <http://127.0.0.1:4173>.

Node 22.5 or newer is required (the server uses the built-in `node:sqlite`).

| | |
|---|---|
| Shop | <http://127.0.0.1:4173/shop> |
| Book a groom | <http://127.0.0.1:4173/booking> |
| Staff console | <http://127.0.0.1:4173/admin> |

The database seeds itself on first start. To rebuild it from scratch:
`npm run seed`.

### Staff sign-in

```
admin@snipandsnout.co.uk / groom1234
```

Override with `ADMIN_PASSWORD` in the environment. The console covers today's
diary, bookings, orders and stock.

## How it is put together

```
petshop/
  server/
    server.js   HTTP server, static files, brotli, security headers
    api.js      The API. Prices are computed here and never trusted from a client.
    db.js       SQLite schema and connection
    seed.js     Catalogue and grooming menu data
  public/
    *.html      One page per view, no templating
    assets/css  base.css (tokens, chrome, forms) + app.css (page furniture)
    assets/js   One module per page, sharing ui.js / catalog.js / cart.js / api.js
  data/         SQLite file — git-ignored, recreated by `npm run seed`
```

Conventions worth knowing before changing anything:

- **Money is integer pence.** There are no floats in this codebase.
- **The server is the source of truth.** A client-sent price is ignored; every
  order is re-priced from the database at checkout.
- **Slots are decided in one transaction.** Two browsers cannot take the last
  appointment at once.
- **Failures are `{ error: { code, message, details } }`**, where `details` is
  an array of `{ field, message }` so the client can paint field-level errors.

## Frontend

The design system lives in `base.css` (colour, type, layout, chrome, forms) and
`app.css` (page furniture). Everything is driven from CSS custom properties, so
a palette change is a token change rather than a hunt through selectors.

Product artwork is generated SVG (`assets/js/art.js`) rather than photography —
it keeps the catalogue self-contained, offline-safe and consistent with the
palette, and avoids licensing and hosting work. Swapping in real photos means
replacing `productArt()` and the tint logic, nothing else.

Accessibility is treated as a feature, not a pass at the end: skip link, focus
handling on every view change, live-region announcements for anything that
arrives asynchronously, and `prefers-reduced-motion` respected in the one place
there is any motion at all.
