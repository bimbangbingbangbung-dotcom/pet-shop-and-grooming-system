/**
 * Grooming menu: the full service list and the add-ons. Both are read-only
 * here — choosing one happens on the booking page.
 */

import { api } from './api.js';
import { hydrateChrome, state, wireRetry, esc, money, announce } from './ui.js';
import { renderMenu, skeletonMenu } from './catalog.js';

hydrateChrome();

async function loadServices() {
  const slot = document.querySelector('[data-services-slot]');
  if (!slot) return;

  slot.innerHTML = skeletonMenu(5);

  try {
    const { services } = await api.get('/api/services');
    if (!services.length) {
      slot.innerHTML = state.empty('No services listed', 'The menu has not been set up yet.');
      return;
    }
    slot.innerHTML = renderMenu(services, { compact: false });
    announce(`${services.length} grooming services loaded.`);
  } catch (err) {
    slot.innerHTML = state.error(err.message, 'services');
    wireRetry(slot, loadServices);
  }
}

async function loadAddons() {
  const slot = document.querySelector('[data-addons-slot]');
  if (!slot) return;

  slot.innerHTML = '<div class="skeleton" style="height:96px"></div>' +
                   '<div class="skeleton" style="height:96px"></div>' +
                   '<div class="skeleton" style="height:96px"></div>';

  try {
    const { addons } = await api.get('/api/addons');
    slot.innerHTML = addons.map((a) => `
      <article class="addon-card">
        <p class="addon-card__name">${esc(a.name)}</p>
        <p class="addon-card__summary">${esc(a.summary)}</p>
        <p class="addon-card__price">${money(a.price_cents)}</p>
      </article>`).join('');
  } catch (err) {
    slot.innerHTML = state.error(err.message, 'addons');
    wireRetry(slot, loadAddons);
  }
}

loadServices();
loadAddons();
