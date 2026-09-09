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

// -------------------------------------------------------------- staff gate

/**
 * Convenience lock on the kitchen, expo and manager screens so a guest who
 * guesses the URL does not land on the rail. It is NOT security - the passcode
 * ships in config.js and anyone can read it. What actually protects the data is
 * firestore.rules; see the security note in README.md.
 */
export function requireStaff() {
  if (recall('staff', false) === true) return true;
  const entered = window.prompt('Staff passcode');
  if (entered === null) return false;
  if (entered.trim() === config.kitchen.staffPasscode) {
    remember('staff', true);
    return true;
  }
  window.alert('That passcode is not right.');
  return false;
}
