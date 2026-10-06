/**
 * Booking: four steps in one form, with the summary pinned alongside so the
 * price is never a surprise. Availability is always the server's answer —
 * this file never decides that a slot is free.
 */

import { api, ApiError } from './api.js';
import {
  hydrateChrome, state as renderState, wireRetry, esc, money,
  dateShort, dateLong, isoToday, addDays,
  announce, toast, showFieldError, clearFieldErrors, paintApiError, clearBanner, withBusy,
} from './ui.js';

hydrateChrome();

const alertBox = document.querySelector('[data-alert]');
const stepper = document.querySelector('[data-stepper]');
const serviceList = document.querySelector('[data-service-list]');
const addonList = document.querySelector('[data-addon-list]');
const slotsEl = document.querySelector('[data-slots]');
const dayLabel = document.querySelector('[data-day-label]');
const dateInput = document.querySelector('[data-date]');
const summaryEl = document.querySelector('[data-summary]');
const petForm = document.querySelector('[data-form="pet"]');
const ownerForm = document.querySelector('[data-form="owner"]');

const booking = {
  service: null,
  services: [],
  addons: [],
  selected: new Set(),     // addon ids
  date: isoToday(),
  datePicked: false,        // true once they choose a day themselves
  start: null,
  startLabel: '',
  step: 1,
};

/* ------------------------------------------------------------- stepping -- */

function goTo(step, { focus = true } = {}) {
  booking.step = step;

  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.dataset.active = String(Number(panel.dataset.panel) === step);
  });

  stepper.querySelectorAll('.stepper__item').forEach((item) => {
    const n = Number(item.dataset.step);
    if (n === step && step < 5) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
    item.dataset.done = String(step === 5 ? true : n < step);
  });

  clearBanner(alertBox);

  if (focus) {
    const panel = document.querySelector(`[data-panel="${step}"]`);
    const heading = panel && panel.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function showAlert(message) {
  alertBox.dataset.visible = 'true';
  alertBox.querySelector('[data-alert-text]').textContent = message;
  alertBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  announce(message);
}

/* --------------------------------------------------------------- price --- */

function priceOf() {
  if (!booking.service) return 0;
  const s = booking.service;
  const base = s.flat_price ? s.prices.small : s.prices[petSize() || 'small'];
  const extras = booking.addons
    .filter((a) => booking.selected.has(a.id))
    .reduce((sum, a) => sum + a.price_cents, 0);
  return base + extras;
}

function petSize() {
  const checked = petForm.querySelector('[name="petSize"]:checked');
  return checked ? checked.value : '';
}

function renderSummary() {
  if (!booking.service) {
    summaryEl.innerHTML = '<p class="summary-empty">Choose a service and the rest fills itself in.</p>';
    return;
  }

  const size = petSize();
  const petName = petForm.petName.value.trim();
  const extras = booking.addons.filter((a) => booking.selected.has(a.id));

  const row = (label, value) =>
    `<div class="summary-row"><span>${esc(label)}</span><span>${value ? esc(value) : '—'}</span></div>`;

  summaryEl.innerHTML =
    row('Service', booking.service.name) +
    row('When', booking.start ? `${dateLong(booking.date)}, ${booking.startLabel}` : '') +
    row('Pet', petName) +
    row('Size', size ? size[0].toUpperCase() + size.slice(1) : '') +
    (extras.length
      ? row('Extras', extras.map((a) => a.name).join(', '))
      : '') +
    `<div class="summary-row summary-row--total"><span>Total</span><span>${money(priceOf())}</span></div>` +
    '<p class="ship-note">Pay at the desk. Cancel free up to 24 hours before.</p>';
}

// The summary is the "no surprises" panel, so it has to keep up while they
// type — not only re-render when a step, a radio or an add-on changes.
petForm.addEventListener('input', renderSummary);
petForm.addEventListener('change', renderSummary);

/* ------------------------------------------------------------ services --- */

function renderServices() {
  serviceList.innerHTML = booking.services.map((s) => {
    const from = Math.min(s.prices.small, s.prices.medium, s.prices.large);
    return `
      <label class="choice">
        <input type="radio" name="serviceId" value="${s.id}" ${booking.service && booking.service.id === s.id ? 'checked' : ''}>
        <span class="choice__body">
          <span class="choice__title">${esc(s.name)}</span>
          <span class="choice__meta">${esc(s.summary)}</span>
          <span class="choice__meta">${s.duration_min} min · ${s.flat_price ? 'any size' : 'small, medium or large'}</span>
        </span>
        <span class="choice__price">${s.flat_price ? money(s.prices.small) : `from ${money(from)}`}</span>
      </label>`;
  }).join('');

  serviceList.querySelectorAll('[name="serviceId"]').forEach((input) => {
    input.addEventListener('change', () => {
      const next = booking.services.find((s) => s.id === Number(input.value));
      if (!next || (booking.service && next.id === booking.service.id)) return;
      booking.service = next;
      booking.start = null;             // a different duration is a different diary
      booking.startLabel = '';
      renderSummary();
    });
  });
}

async function loadServices() {
  try {
    const { services } = await api.get('/api/services');
    booking.services = services;
    renderServices();

    const wanted = new URLSearchParams(location.search).get('service');
    const match = wanted && services.find((s) => s.slug === wanted);
    if (match) {
      booking.service = match;
      renderServices();
      renderSummary();
      goTo(2, { focus: false });
      announce(`${match.name} selected.`);
    }
  } catch (err) {
    serviceList.innerHTML = renderState.error(err.message, 'services');
    wireRetry(serviceList, loadServices);
  }
}

/* --------------------------------------------------------------- addons -- */

async function loadAddons() {
  try {
    const { addons } = await api.get('/api/addons');
    booking.addons = addons;
    addonList.innerHTML = addons.map((a) => `
      <label class="choice">
        <input type="checkbox" name="addon" value="${a.id}">
        <span class="choice__body">
          <span class="choice__title">${esc(a.name)}</span>
          <span class="choice__meta">${esc(a.summary)}</span>
        </span>
        <span class="choice__price">${money(a.price_cents)}</span>
      </label>`).join('');

    addonList.querySelectorAll('[name="addon"]').forEach((input) => {
      input.addEventListener('change', () => {
        const id = Number(input.value);
        if (input.checked) booking.selected.add(id);
        else booking.selected.delete(id);
        renderSummary();
      });
    });
  } catch (err) {
    addonList.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

/* ---------------------------------------------------------------- slots -- */

function renderSlots(data) {
  dateInput.value = booking.date;
  dayLabel.textContent = dateShort(booking.date);
  dayLabel.title = dateLong(booking.date);
  slotsEl.removeAttribute('aria-busy');

  if (data.closed) {
    booking.start = null;
    booking.startLabel = '';
    slotsEl.innerHTML = `
      <div class="state" style="grid-column:1/-1">
        <p class="state__title">Not that day</p>
        <p class="state__body">${esc(data.message)}</p>
        <button class="btn btn--ghost" type="button" data-day="1">Try the next day</button>
      </div>`;
    wireDayButtons();
    return;
  }

  const free = data.slots.filter((s) => s.available);
  if (!free.length) {
    booking.start = null;
    booking.startLabel = '';
    // "Full" and "the day has run out of slots" are different days.
    const late = data.slots.length === 0;
    slotsEl.innerHTML = `
      <div class="state" style="grid-column:1/-1">
        <p class="state__title">${late ? 'Nothing left that day' : 'Full that day'}</p>
        <p class="state__body">${late
          ? 'Every bookable time has already been and gone. Try the next day, or ring us if it is urgent.'
          : 'Every slot is taken. Try the next day, or ring us if it is urgent.'}</p>
        <button class="btn btn--ghost" type="button" data-day="1">Try the next day</button>
      </div>`;
    wireDayButtons();
    return;
  }

  // Keep the choice if it survived the reload; drop it if the slot went.
  const stillThere = free.find((s) => s.start === booking.start);
  if (!stillThere) {
    booking.start = null;
    booking.startLabel = '';
  }

  slotsEl.innerHTML = data.slots.map((s) => `
    <button class="slot" type="button" data-start="${s.start}" data-label="${esc(s.label)}"
            aria-pressed="${String(s.start === booking.start)}" ${s.available ? '' : 'disabled'}>
      ${esc(s.label)}
      <small>${s.available ? (s.free < data.capacity ? `${s.free} left` : 'Free') : 'Taken'}</small>
    </button>`).join('');

  slotsEl.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', () => {
      booking.start = btn.dataset.start;
      booking.startLabel = btn.dataset.label;
      slotsEl.querySelectorAll('[data-start]').forEach((other) => {
        other.setAttribute('aria-pressed', String(other.dataset.start === booking.start));
      });
      renderSummary();
      announce(`${btn.dataset.label} on ${dateLong(booking.date)} selected.`);
    });
  });
}

async function loadSlots({ advance = 0, allow = false } = {}) {
  if (!booking.service) return;

  slotsEl.setAttribute('aria-busy', 'true');
  slotsEl.innerHTML = '<p class="muted" style="grid-column:1/-1">Looking up free times…</p>';

  try {
    const data = await api.get(
      `/api/availability?serviceId=${booking.service.id}&date=${booking.date}`);

    // Arriving on a shut day is a state, not an error: step forward for them.
    // So is a day that is technically open but has nothing left in it — which
    // is what "today" looks like after closing time. Never do either for a day
    // they picked themselves, or Mondays and full Saturdays become unvisitable.
    const noRoom = data.closed
      ? data.reason === 'closed_today' || data.reason === 'in_the_past'
      : !data.slots.some((s) => s.available);

    if (allow && !booking.datePicked && advance < 14 && noRoom) {
      booking.date = addDays(booking.date, 1);
      return loadSlots({ advance: advance + 1, allow: true });
    }

    renderSlots(data);
  } catch (err) {
    slotsEl.removeAttribute('aria-busy');
    slotsEl.innerHTML = renderState.error(err.message, 'slots');
    wireRetry(slotsEl, () => loadSlots());
  }
}

function wireDayButtons() {
  document.querySelectorAll('[data-day]').forEach((btn) => {
    if (btn.dataset.wired === 'true') return;
    btn.dataset.wired = 'true';
    btn.addEventListener('click', () => {
      booking.date = addDays(booking.date, Number(btn.dataset.day));
      booking.datePicked = true;
      booking.start = null;
      booking.startLabel = '';
      renderSummary();
      loadSlots();
      announce(dateLong(booking.date));
    });
  });
}

dateInput.addEventListener('change', () => {
  if (!dateInput.value) return;
  booking.date = dateInput.value;
  booking.datePicked = true;
  booking.start = null;
  booking.startLabel = '';
  renderSummary();
  loadSlots();
});

/* ------------------------------------------------------------ validation -- */

function validateStep(step) {
  clearBanner(alertBox);

  if (step === 1) {
    if (!booking.service) {
      showAlert('Choose a grooming service to carry on.');
      return false;
    }
    return true;
  }

  if (step === 2) {
    clearFieldErrors(petForm);
    let ok = true;

    if (petForm.petName.value.trim().length < 2) {
      showFieldError(petForm, 'petName', 'Their name needs at least 2 characters.');
      ok = false;
    }
    if (!petForm.petType.value.trim()) {
      showFieldError(petForm, 'petType', 'Tell us what they are.');
      ok = false;
    }
    if (!petSize()) {
      showFieldError(petForm, 'petSize', 'Choose how big they are — it sets the price.');
      ok = false;
    }
    if (!ok) showAlert('A couple of things are missing before you can pick a time.');
    return ok;
  }

  if (step === 3) {
    if (!booking.start) {
      showAlert('Pick a time from the list.');
      return false;
    }
    return true;
  }

  if (step === 4) {
    clearFieldErrors(ownerForm);
    let ok = true;

    if (ownerForm.ownerName.value.trim().length < 2) {
      showFieldError(ownerForm, 'ownerName', 'Your name needs at least 2 characters.');
      ok = false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerForm.email.value.trim())) {
      showFieldError(ownerForm, 'email', 'Enter an email we can reply to.');
      ok = false;
    }
    if (!/^[0-9+()\s-]{7,24}$/.test(ownerForm.phone.value.trim())) {
      showFieldError(ownerForm, 'phone', 'Enter a phone number we can ring.');
      ok = false;
    }
    if (!ok) showAlert('Check the highlighted fields and try again.');
    return ok;
  }

  return true;
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.go);
    if (target > booking.step && !validateStep(booking.step)) return;

    goTo(target);
    if (target === 3) loadSlots({ allow: true });
    renderSummary();
  });
});

/* --------------------------------------------------------------- submit --- */

function renderSuccess(b) {
  goTo(5);
  document.querySelector('[data-stepper]').hidden = true;

  const size = petSize();
  const extras = booking.addons.filter((a) => booking.selected.has(a.id));

  document.querySelector('[data-success]').innerHTML = `
    <div class="success__mark" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5.5 5.5L20 7"/></svg>
    </div>
    <h2>You are booked in</h2>
    <p style="margin-top:.75rem">We have emailed the confirmation to ${esc(b.email)}. If anything changes, ring the shop and we will sort it.</p>
    <span class="success__ref">${esc(b.ref)}</span>
    <dl class="confirm-list" style="margin-top:var(--sp-5)">
      <div><dt>Service</dt><dd>${esc(b.service)}</dd></div>
      <div><dt>When</dt><dd>${esc(dateLong(b.date))}, ${esc(minutesToLabel(b.start_min))} to ${esc(minutesToLabel(b.start_min + b.duration_min))}</dd></div>
      <div><dt>Pet</dt><dd>${esc(b.pet_name)}${size ? ` (${esc(size)})` : ''}</dd></div>
      ${extras.length ? `<div><dt>Extras</dt><dd>${esc(extras.map((a) => a.name).join(', '))}</dd></div>` : ''}
      <div><dt>Pay at the desk</dt><dd>${money(b.price_cents)}</dd></div>
    </dl>
    <div class="row">
      <a class="btn" href="/booking">Book another</a>
      <a class="btn btn--ghost" href="/">Back to the shop</a>
    </div>`;

  document.querySelector('.summary-card').hidden = true;
  announce(`Booked. Your reference is ${b.ref}.`);
  toast('Booked in.', 'ok');
}

function minutesToLabel(min) {
  const h = Math.floor(min / 60);
  const m = String(min % 60).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`;
}

async function submit() {
  // Walk the steps in order and stop at the first one that is not ready:
  // the person should always land on the thing they missed.
  for (const step of [1, 2, 3, 4]) {
    if (!validateStep(step)) {
      goTo(step);
      return;
    }
  }

  const payload = {
    serviceId: booking.service.id,
    petSize: petSize(),
    petName: petForm.petName.value.trim(),
    petType: petForm.petType.value.trim(),
    breed: petForm.breed.value.trim(),
    coat: petForm.coat.value.trim(),
    addonIds: [...booking.selected],
    date: booking.date,
    start: booking.start,
    ownerName: ownerForm.ownerName.value.trim(),
    email: ownerForm.email.value.trim(),
    phone: ownerForm.phone.value.trim(),
    notes: ownerForm.notes.value.trim(),
  };

  const btn = document.querySelector('[data-submit]');

  try {
    const result = await withBusy(btn, 'Booking…', () => api.post('/api/bookings', payload));
    renderSuccess(result.booking);
  } catch (err) {
    clearFieldErrors(petForm);
    paintApiError(ownerForm, alertBox, err);

    // The slot went while they were typing: send them back to a fresh diary.
    if (err instanceof ApiError && err.code === 'conflict' &&
        (err.details.some((d) => d.field === 'start') || err.details.some((d) => d.field === 'date'))) {
      booking.start = null;
      booking.startLabel = '';
      goTo(3);
      loadSlots();
      showAlert('That time has just been taken. Pick another from the list.');
      return;
    }

    if (err instanceof ApiError && err.fields.start) {
      goTo(3);
      loadSlots();
      showAlert(err.message);
    }
  }
}

document.querySelector('[data-submit]').addEventListener('click', submit);

/* ----------------------------------------------------------------- boot -- */

wireDayButtons();
dateInput.min = isoToday();
renderSummary();
loadServices();
loadAddons();
if (booking.service) loadSlots();
