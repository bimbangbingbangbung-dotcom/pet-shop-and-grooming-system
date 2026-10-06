/**
 * Renderers shared by the home, shop and grooming pages, so a product or a
 * service looks and behaves the same wherever it appears.
 */

import { esc, money } from './ui.js';
import { productArt, tintFor } from './art.js';
import { cart } from './cart.js';

/* ----------------------------------------------------------- products --- */

export function renderProductCard(p) {
  const soldOut = p.stock <= 0;
  const low = !soldOut && p.stock <= 10;
  const line = JSON.stringify({
    slug: p.slug, name: p.name, price_cents: p.price_cents, art: p.art, size: p.size,
  });

  return `<article class="prod${soldOut ? ' prod--sold' : ''}">
    <div class="prod__media" style="background:${tintFor(p.art)}">
      ${p.featured ? '<span class="prod__flag">Best seller</span>' : ''}
      ${productArt(p.art, p.name)}
    </div>
    <div class="prod__body">
      <h3 class="prod__name"><a href="/product?slug=${encodeURIComponent(p.slug)}">${esc(p.name)}</a></h3>
      ${p.size ? `<p class="prod__size">${esc(p.size)}</p>` : ''}
      <p class="prod__blurb">${esc(p.blurb)}</p>
      <div class="prod__foot">
        <span class="prod__price">${money(p.price_cents)}</span>
        ${soldOut
          ? '<span class="badge badge--out">Back soon</span>'
          : `<button class="btn prod__add" type="button" data-add='${esc(line)}'>
               Add<span class="sr-only"> ${esc(p.name)} to basket</span>
             </button>`}
      </div>
      ${low ? `<p class="prod__size" style="margin-top:.35rem"><span class="badge badge--low">Only ${p.stock} left</span></p>` : ''}
    </div>
  </article>`;
}

/** Delegated: works for cards that are swapped in after a filter change. */
export function wireAddButtons(root = document) {
  root.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-add]');
    if (!btn) return;
    let line;
    try {
      line = JSON.parse(btn.dataset.add);
    } catch (_) {
      return;
    }
    cart.add(line, 1);
    const label = btn.innerHTML;
    btn.innerHTML = 'Added';
    btn.setAttribute('aria-disabled', 'true');
    window.setTimeout(() => {
      btn.innerHTML = label;
      btn.removeAttribute('aria-disabled');
    }, 1200);
  });
}

/* ------------------------------------------------------------ services -- */

function priceCell(label, cents, flat) {
  return `<div class="pricecol${flat ? ' pricecol--flat' : ''}">
      <span class="pricecol__label">${flat ? 'Any size' : label}</span>
      <span class="pricecol__value">${money(cents)}</span>
    </div>`;
}

export function renderServiceRow(s, { compact = false } = {}) {
  const flat = s.flat_price;
  return `<div class="menu__row">
    <div>
      <p class="menu__name">${esc(s.name)} <span class="menu__tag">${esc(s.tagline)}</span></p>
      <p class="menu__summary">${esc(s.summary)}</p>
      ${flat ? '' : `<ul class="menu__includes">
        ${s.includes.slice(0, compact ? 3 : 99).map((i) => `<li>${esc(i)}</li>`).join('')}
      </ul>`}
      ${compact ? '' : `<p class="menu__note">${esc(s.note)}</p>`}
    </div>
    <div class="menu__prices">
      ${flat
        ? priceCell('Any size', s.prices.small, true)
        : priceCell('Small', s.prices.small) + priceCell('Medium', s.prices.medium) + priceCell('Large', s.prices.large)}
    </div>
    <div class="menu__actions">
      <span class="badge">${s.duration_min} min</span>
      <a class="btn btn--quiet" href="/booking?service=${encodeURIComponent(s.slug)}">Book ${esc(s.name)}</a>
    </div>
  </div>`;
}

export function renderMenu(services, options) {
  return `<div class="menu">${services.map((s) => renderServiceRow(s, options)).join('')}</div>`;
}

/* ------------------------------------------------------------- helpers -- */

export function skeletonGrid(n = 4) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<div class="prod" aria-hidden="true">
      <div class="skeleton" style="aspect-ratio:1"></div>
      <div class="skeleton" style="height:18px;width:70%;margin-top:.75rem"></div>
      <div class="skeleton" style="height:14px;width:90%;margin-top:.5rem"></div>
      <div class="skeleton" style="height:32px;width:60%;margin-top:.9rem"></div>
    </div>`;
  }
  return out;
}

export function skeletonMenu(n = 3) {
  let out = '<div class="menu">';
  for (let i = 0; i < n; i++) {
    out += `<div class="menu__row" aria-hidden="true">
      <div>
        <div class="skeleton" style="height:26px;width:45%"></div>
        <div class="skeleton" style="height:15px;width:85%;margin-top:.7rem"></div>
        <div class="skeleton" style="height:15px;width:65%;margin-top:.45rem"></div>
      </div>
      <div class="menu__prices">
        <div class="skeleton" style="height:34px;width:58px"></div>
        <div class="skeleton" style="height:34px;width:58px"></div>
        <div class="skeleton" style="height:34px;width:58px"></div>
      </div>
    </div>`;
  }
  return out + '</div>';
}
