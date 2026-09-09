/**
 * Shared browser helpers: API calls, the live event stream, clock-skew
 * correction, and small formatting utilities. Every screen loads this first.
 */
(function (global) {
  'use strict';

  var serverOffsetMs = 0; // serverNow - clientNow

  function noteServerTime(iso) {
    if (!iso) return;
    serverOffsetMs = new Date(iso).getTime() - Date.now();
  }

  /** Server-corrected clock, so elapsed timers agree across devices. */
  function now() {
    return Date.now() + serverOffsetMs;
  }

  async function api(path, options) {
    options = options || {};
    var res = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
    });

    var payload = null;
    try {
      payload = await res.json();
    } catch (err) {
      throw new ApiError('The server sent something we could not read.', res.status, []);
    }
    if (payload && payload.serverTime) noteServerTime(payload.serverTime);

    if (!res.ok || payload.ok === false) {
      throw new ApiError(payload.error || 'Request failed', res.status, payload.errors || []);
    }
    return payload;
  }

  function ApiError(message, status, errors) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status;
    this.errors = errors || [];
  }
  ApiError.prototype = Object.create(Error.prototype);

  /**
   * Subscribe to the server event stream with automatic reconnect.
   * @param {object} opts { order, onEvent, onStatus }
   */
  function stream(opts) {
    var url = '/api/stream' + (opts.order ? '?order=' + encodeURIComponent(opts.order) : '');
    var source = null;
    var closed = false;
    var retry = 0;

    function setStatus(state) {
      if (opts.onStatus) opts.onStatus(state);
    }

    function connect() {
      if (closed) return;
      source = new EventSource(url);

      source.addEventListener('open', function () {
        retry = 0;
        setStatus('live');
      });

      source.addEventListener('hello', function (e) {
        try { noteServerTime(JSON.parse(e.data).serverTime); } catch (err) { /* ignore */ }
        setStatus('live');
      });

      ['order.created', 'order.updated', 'store.reset', 'store.seeded'].forEach(function (type) {
        source.addEventListener(type, function (e) {
          var data = null;
          try { data = JSON.parse(e.data); } catch (err) { return; }
          if (opts.onEvent) opts.onEvent(type, data);
        });
      });

      source.addEventListener('error', function () {
        setStatus('down');
        source.close();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, 400 * Math.pow(1.7, retry));
      });
    }

    connect();
    return function stop() {
      closed = true;
      setStatus('idle');
      if (source) source.close();
    };
  }

  // ---------------------------------------------------------------- formatting

  /** "7:42" style elapsed clock, used on every chit. */
  function mmss(totalSec) {
    var s = Math.max(0, Math.round(totalSec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  /** Friendly duration for guests: "about 12 min". */
  function humanMins(sec) {
    var m = Math.round(sec / 60);
    if (m <= 1) return 'about a minute';
    return 'about ' + m + ' min';
  }

  function clockTime(iso) {
    var d = iso ? new Date(iso) : new Date(now());
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function secondsSince(iso) {
    if (!iso) return 0;
    return (now() - new Date(iso).getTime()) / 1000;
  }

  function money(n) {
    return '$' + Number(n || 0).toFixed(2);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Tagged template that escapes every interpolated value. */
  function html(strings) {
    var values = Array.prototype.slice.call(arguments, 1);
    return strings.reduce(function (acc, str, i) {
      var v = values[i - 1];
      if (Array.isArray(v)) v = v.join('');
      // Check for the marker key, not its truthiness: raw('') is legitimate
      // and must render as nothing rather than being escaped as an object.
      else if (v !== null && typeof v === 'object' && '__raw' in v) v = v.__raw;
      else v = escapeHtml(v);
      return acc + v + str;
    });
  }

  /** Mark a string as already-safe HTML for use inside html``. */
  function raw(s) {
    return { __raw: s == null ? '' : String(s) };
  }

  // ------------------------------------------------------------------- storage

  function remember(key, value) {
    try { localStorage.setItem('pp.' + key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }

  function recall(key, fallback) {
    try {
      var v = localStorage.getItem('pp.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (err) {
      return fallback;
    }
  }

  // --------------------------------------------------------------------- sound

  /**
   * Kitchen alert tones, synthesised so there are no audio assets to ship.
   * Browsers block audio until the first gesture, hence the explicit unlock.
   */
  var audioCtx = null;
  function unlockAudio() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (err) {
      audioCtx = null;
    }
  }

  function tone(freq, durationMs, when, gainValue) {
    if (!audioCtx) return;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, audioCtx.currentTime + when);
    gain.gain.linearRampToValueAtTime(gainValue == null ? 0.18 : gainValue, audioCtx.currentTime + when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + when + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + when);
    osc.stop(audioCtx.currentTime + when + durationMs / 1000 + 0.02);
  }

  var CHIMES = {
    newOrder: function () { tone(784, 140, 0); tone(1047, 220, 0.13); },
    runner: function () { tone(1047, 130, 0); tone(1047, 130, 0.18); tone(1319, 260, 0.36); },
    late: function () { tone(392, 260, 0); tone(330, 320, 0.24); },
  };

  function chime(name) {
    unlockAudio();
    if (CHIMES[name]) CHIMES[name]();
  }

  global.PP = {
    api: api, ApiError: ApiError, stream: stream,
    now: now, noteServerTime: noteServerTime, secondsSince: secondsSince,
    mmss: mmss, humanMins: humanMins, clockTime: clockTime, money: money,
    escapeHtml: escapeHtml, html: html, raw: raw,
    remember: remember, recall: recall,
    chime: chime, unlockAudio: unlockAudio,
  };
})(window);
