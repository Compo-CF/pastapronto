/**
 * Small browser helpers shared by every screen: escaping templates, time and
 * money formatting, per-device storage, synthesised alert tones, and the staff
 * passcode gate.
 *
 * No Firebase, no DOM framework.
 */
import { config } from './config.js';

// -------------------------------------------------------------- clock skew

let skewMs = 0;

/**
 * Keep elapsed timers honest on a tablet with a wrong clock.
 *
 * Orders carry both `submittedAt` (an ISO string written by the ordering
 * device) and `submittedAtServer` (Firestore's own serverTimestamp). The gap
 * between them is that device's clock error, so once we have seen one resolved
 * pair we can correct every timer on this screen.
 */
export function noteClockSkew(clientIso, serverDate) {
  if (!clientIso || !serverDate) return;
  const drift = serverDate.getTime() - new Date(clientIso).getTime();
  // Ignore absurd values (a clock off by more than a day is a broken device,
  // not skew we should silently compensate for).
  if (Math.abs(drift) > 86400000) return;
  skewMs = drift;
}

/** Server-corrected "now". */
export function now() {
  return Date.now() + skewMs;
}

export function secondsSince(iso) {
  if (!iso) return 0;
  return (now() - new Date(iso).getTime()) / 1000;
}

export const clockSkewMs = () => skewMs;

// -------------------------------------------------------------- formatting

/** "7:42" style elapsed clock, used on every chit. */
export function mmss(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Friendly duration for guests: "about 12 min". */
export function humanMins(sec) {
  const m = Math.round(sec / 60);
  return m <= 1 ? 'about a minute' : `about ${m} min`;
}

export function clockTime(iso) {
  const d = iso ? new Date(iso) : new Date(now());
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function money(n) {
  return '$' + Number(n || 0).toFixed(2);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Tagged template that escapes every interpolated value. */
export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => {
    let v = values[i - 1];
    if (Array.isArray(v)) v = v.join('');
    // Test for the marker key, not its truthiness: raw('') is legitimate and
    // must render as nothing rather than being escaped as an object.
    else if (v !== null && typeof v === 'object' && '__raw' in v) v = v.__raw;
    else v = escapeHtml(v);
    return acc + v + str;
  });
}

/** Mark a string as already-safe HTML for use inside html``. */
export function raw(s) {
  return { __raw: s == null ? '' : String(s) };
}

// ----------------------------------------------------------------- storage

export function remember(key, value) {
  try { localStorage.setItem('pp.' + key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function recall(key, fallback) {
  try {
    const v = localStorage.getItem('pp.' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------- sound

/**
 * Kitchen alert tones, synthesised so there are no audio assets to ship.
 * Browsers block audio until the first gesture, hence the explicit unlock.
 */
let audioCtx = null;

export function unlockAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
}

function tone(freq, durationMs, when, gainValue = 0.18) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audioCtx.currentTime + when);
  gain.gain.linearRampToValueAtTime(gainValue, audioCtx.currentTime + when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + when + durationMs / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + when);
  osc.stop(audioCtx.currentTime + when + durationMs / 1000 + 0.02);
}

const CHIMES = {
  newOrder: () => { tone(784, 140, 0); tone(1047, 220, 0.13); },
  runner: () => { tone(1047, 130, 0); tone(1047, 130, 0.18); tone(1319, 260, 0.36); },
  late: () => { tone(392, 260, 0); tone(330, 320, 0.24); },
};

export function chime(name) {
  unlockAudio();
  if (CHIMES[name]) CHIMES[name]();
}

// -------------------------------------------------------------------- toast

let toastTimer = null;

export function toast(message, bad = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast' + (bad ? ' is-bad' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

// --------------------------------------------------------------- wake lock

/**
 * Keep a wall-mounted kitchen tablet awake.
 *
 * A rail that has dimmed to black is a rail nobody is reading, and the cook
 * finds out by walking over to it. The Screen Wake Lock API holds the display
 * on for as long as this page is the visible, foreground tab.
 *
 * Three things make this fiddlier than one call:
 *
 *  - The lock is released automatically whenever the page is hidden - the
 *    tablet is locked by hand, another app comes forward, Safari backgrounds
 *    the tab - and it is NOT restored when the page comes back. So it has to
 *    be re-taken on every visibilitychange, forever, not just acquired once.
 *  - Safari wants the first request to come from a user gesture, and a screen
 *    that someone unlocked yesterday boots with no gesture at all. So we try
 *    immediately and also arm a one-shot retry on the next touch.
 *  - It needs a secure context and Safari 16.4 or newer. Older iPads simply
 *    will not have it, which is why this resolves quietly either way and the
 *    caller is told whether it took.
 *
 * Even where it works, it only holds while the page is in front. An iPad that
 * must never sleep should also have Settings > Display & Brightness >
 * Auto-Lock set to Never; this covers the case where nobody has done that.
 *
 * @returns {Promise<boolean>} whether the lock is being held
 */
let wakeLock = null;
let wakeWanted = false;

export async function keepScreenAwake() {
  if (!('wakeLock' in navigator)) return false;
  wakeWanted = true;

  const take = async () => {
    if (!wakeWanted || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      // The browser drops the lock on its own terms; forget it so the next
      // visibility change knows to ask again rather than trusting a dead handle.
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      // Denied (no gesture yet, low battery, policy). The retries below are
      // the recovery; there is nothing useful to say here.
      wakeLock = null;
    }
  };

  document.addEventListener('visibilitychange', take);
  // Every gesture is a chance to get a lock that was refused for want of one.
  // Cheap to leave attached: take() returns immediately once we hold it.
  document.addEventListener('pointerdown', take);

  await take();
  return wakeLock !== null;
}

// -------------------------------------------------------------- staff gate

/**
 * Convenience lock on the kitchen, expo and manager screens so a guest who
 * guesses the URL does not land on the rail. It is NOT security - the passcode
 * ships in config.js and anyone can read it. What actually protects the data is
 * firestore.rules; see the security note in README.md.
 *
 * Rendered as an in-page overlay rather than window.prompt(). prompt() is
 * blocked outright in sandboxed frames and several in-app webviews - exactly
 * what a kitchen tablet or a link opened from a chat app tends to be - and
 * there it throws, leaving a dead screen. This also gives a numeric keypad and
 * a target big enough for a cook with wet hands.
 *
 * @returns {Promise<boolean>} resolves true once unlocked
 */
export function requireStaff() {
  if (recall('staff', false) === true) return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate';
    overlay.innerHTML = [
      '<form class="gate-card" autocomplete="off">',
      '  <h1 class="gate-title">Staff screen</h1>',
      '  <p class="gate-sub">Ask a manager for the passcode.</p>',
      '  <input class="gate-input" type="password" inputmode="numeric" ',
      '         autocomplete="off" aria-label="Staff passcode" placeholder="Passcode">',
      '  <p class="gate-error" role="alert" hidden>That passcode is not right.</p>',
      '  <button class="gate-go" type="submit">Unlock</button>',
      '</form>',
    ].join('');

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('.gate-input');
    const error = overlay.querySelector('.gate-error');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim() === config.kitchen.staffPasscode) {
        remember('staff', true);
        overlay.remove();
        resolve(true);
        return;
      }
      error.hidden = false;
      input.value = '';
      input.focus();
    });

    document.body.appendChild(overlay);
    input.focus();
  });
}
