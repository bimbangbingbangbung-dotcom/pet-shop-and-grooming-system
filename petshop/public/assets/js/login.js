/**
 * Customer sign-in and registration. Two panels behind one tablist so the
 * choice is visible rather than buried in a link at the bottom of a form.
 */

import { api, ApiError } from './api.js';
import {
  hydrateChrome, setAccount, announce, toast,
  showFieldError, clearFieldErrors, paintApiError, withBusy,
} from './ui.js';

hydrateChrome();

const signinForm = document.querySelector('[data-form="signin"]');
const registerForm = document.querySelector('[data-form="register"]');
const tabs = document.querySelectorAll('[data-tab]');

/** Only ever redirect within the site: a `next` of //evil.com is a phish. */
function destination() {
  const next = new URLSearchParams(location.search).get('next') || '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

function selectTab(name) {
  tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
  signinForm.hidden = name !== 'signin';
  registerForm.hidden = name !== 'register';
  const active = name === 'signin' ? signinForm : registerForm;
  active.querySelector('input')?.focus({ preventScroll: true });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab.dataset.tab === 'signin' ? 'register' : 'signin';
    selectTab(next);
    document.querySelector(`[data-tab="${next}"]`).focus();
  });
});

function failWith(form, banner, err) {
  paintApiError(form, banner, err);
  if (err instanceof ApiError) {
    const first = Object.keys(err.fields)[0];
    if (first) form.querySelector(`[name="${first}"]`)?.focus();
  }
}

/** Forms expose their own `name` property, so named access needs asking twice. */
const fieldOf = (form, n) => form.querySelector(`[name="${n}"]`);

async function enter(customer, message) {
  setAccount(customer);
  announce(message);
  toast(message, 'ok');
  location.href = destination();
}

/* ------------------------------------------------------------- sign in --- */

signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const banner = signinForm.querySelector('[data-alert]');
  clearFieldErrors(signinForm);
  banner.dataset.visible = 'false';

  const email = fieldOf(signinForm, 'email').value.trim();
  const password = fieldOf(signinForm, 'password').value;

  let ok = true;
  if (!email) { showFieldError(signinForm, 'email', 'Enter your email address.'); ok = false; }
  if (!password) { showFieldError(signinForm, 'password', 'Enter your password.'); ok = false; }
  if (!ok) {
    banner.dataset.visible = 'true';
    banner.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    return;
  }

  const button = signinForm.querySelector('[type="submit"]');
  try {
    const result = await withBusy(button, 'Signing in…',
      () => api.post('/api/auth/login', { email, password }));
    await enter(result.customer, `Signed in as ${result.customer.name}.`);
  } catch (err) {
    failWith(signinForm, banner, err);
    fieldOf(signinForm, 'password').value = '';
    fieldOf(signinForm, 'password').focus();
  }
});

/* ------------------------------------------------------------ register --- */

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const banner = registerForm.querySelector('[data-alert]');
  clearFieldErrors(registerForm);
  banner.dataset.visible = 'false';

  const values = {
    name: fieldOf(registerForm, 'name').value.trim(),
    email: fieldOf(registerForm, 'email').value.trim(),
    phone: fieldOf(registerForm, 'phone').value.trim(),
    password: fieldOf(registerForm, 'password').value,
    address: fieldOf(registerForm, 'address').value.trim(),
  };

  let ok = true;
  if (values.name.length < 2) { showFieldError(registerForm, 'name', 'Your name needs at least 2 characters.'); ok = false; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
    showFieldError(registerForm, 'email', 'Enter a valid email address.'); ok = false;
  }
  if (values.password.length < 8) { showFieldError(registerForm, 'password', 'Use at least 8 characters.'); ok = false; }
  if (values.phone && !/^[0-9+()\s-]{7,24}$/.test(values.phone)) {
    showFieldError(registerForm, 'phone', 'That phone number does not look right.'); ok = false;
  }

  if (!ok) {
    banner.dataset.visible = 'true';
    banner.querySelector('[data-alert-text]').textContent = 'Check the highlighted fields.';
    registerForm.querySelector('[data-invalid="true"] input')?.focus();
    return;
  }

  const button = registerForm.querySelector('[type="submit"]');
  try {
    const result = await withBusy(button, 'Creating your account…',
      () => api.post('/api/auth/register', values));
    await enter(result.customer, 'Account created. Welcome.');
  } catch (err) {
    failWith(registerForm, banner, err);
  }
});

/* ----------------------------------------------------------------- boot -- */

(async () => {
  const wanted = new URLSearchParams(location.search).get('tab');
  if (wanted === 'register') selectTab('register');

  try {
    const { customer } = await api.get('/api/auth/me');
    if (customer) {
      announce(`You are already signed in as ${customer.name}.`);
      location.replace(destination());
    }
  } catch (_) {
    /* a signed-out visitor gets 200 with null; anything else is still fine */
  }
})();
