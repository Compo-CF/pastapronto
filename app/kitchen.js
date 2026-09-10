/**
 * Kitchen display (KDS).
 *
 * Three lanes - New Orders, Cooking, Ready - fed by the same SSE stream the
 * guest app uses. Design rules that drove this file:
 *
 *  - The clock on a chit answers "how long has this been MY problem", so it
 *    restarts at each hand-off: queue age, then cook time, then runner wait.
 *  - Colour escalates on the SLA from app/config.js, never on a hunch.
 *  - Every button is reversible; nothing needs a confirm dialog mid-rush.
 *  - Timers tick without re-rendering, so a cook's finger never lands on a
 *    button that moved underneath it.
 */
import { config } from './config.js';
import * as menu from './menu.js';
import * as orderLib from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import {
  html, raw, mmss, clockTime, secondsSince, escapeHtml,
  remember, recall, chime, unlockAudio, toast, requireStaff,
} from './ui.js';

const CATALOG = menu.catalog();

(function () {
  'use strict';

  var state = {
    orders: [],
    station: recall('kds.station', ''),
    sound: recall('kds.sound', false),
    selected: null,
    seen: {},
    firstLoadDone: false,
  };

  var LANES = ['queued', 'cooking', 'ready'];

  var PRIMARY = {
    queued: { action: 'accept', label: 'Accept', cls: 'kact-primary' },
    cooking: { action: 'ready', label: 'Food Up - Call Runner', cls: 'kact-primary' },
    ready: { action: 'deliver', label: 'Delivered', cls: 'kact-deliver' },
  };

  var UNDO = { cooking: 'unaccept', ready: 'unready', queued: null };

  var el = {
    lanes: {},
    counts: document.getElementById('counts'),
    clock: document.getElementById('clock'),
    conn: document.getElementById('conn'),
    stationFilter: document.getElementById('stationFilter'),
    soundToggle: document.getElementById('soundToggle'),
    soundIcon: document.getElementById('soundIcon'),
    heldNote: document.getElementById('heldNote'),
    eightySix: document.getElementById('eightySix'),
  };
  LANES.forEach(function (lane) {
    el.lanes[lane] = document.getElementById('lane-' + lane);
  });

  // ------------------------------------------------------------------ SLA clock

  /**
   * Which clock matters for this chit, and how alarming it is.
   * Returns { seconds, level: ''|'warn'|'late', label }.
   */
  function timerFor(order) {
    var sla = config.sla;

    if (order.status === 'queued') {
      var waiting = secondsSince(order.submittedAt);
      return {
        seconds: waiting,
        level: waiting >= sla.acceptLateSec ? 'late' : waiting >= sla.acceptWarnSec ? 'warn' : '',
        label: 'waiting',
      };
    }

    if (order.status === 'cooking') {
      var cooking = secondsSince(order.acceptedAt);
      var target = order.cookEstimateSec || 1;
      return {
        seconds: cooking,
        level: cooking >= target * sla.cookLateFactor ? 'late'
          : cooking >= target * sla.cookWarnFactor ? 'warn' : '',
        label: 'of ' + mmss(target),
      };
    }

    if (order.status === 'ready') {
      var sitting = secondsSince(order.readyAt);
      return {
        seconds: sitting,
        level: sitting >= sla.runnerLateSec ? 'late' : sitting >= sla.runnerWarnSec ? 'warn' : '',
        label: 'on the pass',
      };
    }

    if (order.status === 'held') {
      // Freeze the clock at the moment it was parked; it is nobody's SLA now.
      return { seconds: secondsSince(order.submittedAt), level: 'hold', label: 'held' };
    }

    return { seconds: secondsSince(order.submittedAt), level: '', label: '' };
  }

  function laneOrders(lane) {
    // Held orders live at the foot of the New Orders lane. Parking a ticket
    // must not make it disappear - an invisible order is a lost order.
    var wanted = lane === 'queued' ? ['queued', 'held'] : [lane];
    return state.orders
      .filter(function (o) { return wanted.indexOf(o.status) !== -1; })
      .sort(function (a, b) {
        if ((a.status === 'held') !== (b.status === 'held')) return a.status === 'held' ? 1 : -1;
        // Rush and allergy chits ride to the front of their lane.
        var rank = function (o) { return o.priority === 'rush' ? 0 : o.priority === 'allergy' ? 1 : 2; };
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return new Date(a.submittedAt) - new Date(b.submittedAt);
      });
  }

  /** Bump-bar numbering runs across the whole rail, left lane first. */
  function keyMap() {
    var map = {};
    var n = 1;
    LANES.forEach(function (lane) {
      laneOrders(lane).forEach(function (order) {
        if (n <= 9) {
          map[n] = order.id;
          order._key = n;
          n += 1;
        } else {
          order._key = null;
        }
      });
    });
    return map;
  }

  // ------------------------------------------------------------------ chit view

  function menuName(group, id) {
    var list = CATALOG[group] || [];
    var hit = list.filter(function (x) { return x.id === id; })[0];
    return hit ? hit.name : id;
  }

  function pastaShape(id) {
    var hit = (CATALOG.pastas || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.shape : 'none';
  }

  function renderLine(line) {
    var adds = [];
    if (line.toppings && line.toppings.length) {
      adds.push(line.toppings.map(function (t) { return menuName('toppings', t); }).join(', '));
    }
    if (line.sides && line.sides.length) {
      adds.push('SIDE: ' + line.sides.map(function (s) { return menuName('sides', s); }).join(', '));
    }

    var flags = [menuName('portions', line.portion)];
    if (line.spice && line.spice !== 'mild') flags.push(line.spice.toUpperCase());
    if (line.allergens && line.allergens.length) flags.push(line.allergens.join('/'));

    return html`<li class="cline">
      <span class="cline-art">${raw(art(pastaShape(line.pasta)))}</span>
      <div class="grow">
        <div class="cline-who">${line.guestLabel}</div>
        <div class="cline-dish">${line.dish}</div>
        ${raw(adds.length ? '<div class="cline-add">' + escapeHtml(adds.join(' \u00b7 ')) + '</div>' : '')}
        <div class="cline-portion">${flags.join(' \u00b7 ')}</div>
        ${raw(line.notes ? '<div class="cline-note">! ' + escapeHtml(line.notes) + '</div>' : '')}
      </div>
    </li>`;
  }

  function renderChit(order) {
    var t = timerFor(order);
    // The server used to attach allowedActions to every chit. The state machine
    // now runs on the device, so ask it directly.
    var allowed = orderLib.allowedActions(order, config.sla);
    var badges = [];
    if (order.priority === 'rush') badges.push('<span class="badge badge-rush">Rush</span>');
    if (order.priority === 'allergy') badges.push('<span class="badge badge-allergy">Allergy</span>');
    badges.push('<span class="badge badge-station">' + escapeHtml(order.station) + '</span>');
    badges.push('<span class="badge badge-guests">' + order.guestCount + ' guests</span>');
    if (order.memberStatus === 'unverified') badges.push('<span class="badge badge-unverified">Member unverified</span>');
    if (order.status === 'held') badges.push('<span class="badge badge-held">On hold</span>');

    var alert = order.avoidAllergens && order.avoidAllergens.length
      ? html`<div class="chit-alert">ALLERGY - must avoid ${order.avoidAllergens.map(function (a) {
          return menuName('allergens', a);
        }).join(', ')}</div>`
      : '';

    var primary = PRIMARY[order.status];
    var buttons = [];
    if (primary && allowed.indexOf(primary.action) !== -1) {
      buttons.push(html`<button class="kact ${primary.cls}" data-act="${primary.action}" data-id="${order.id}">
        ${primary.label}</button>`);
    }
    var undo = UNDO[order.status];
    if (undo && allowed.indexOf(undo) !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="${undo}" data-id="${order.id}"
        title="Undo" aria-label="Undo">&#8630;</button>`);
    }
    if (allowed.indexOf('rush') !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="rush" data-id="${order.id}"
        title="Mark rush" aria-label="Mark rush">&#9889;</button>`);
    }
    if (allowed.indexOf('hold') !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="hold" data-id="${order.id}"
        title="Hold" aria-label="Hold">&#10074;&#10074;</button>`);
    }
    if (allowed.indexOf('release') !== -1) {
      buttons.push(html`<button class="kact kact-primary" data-act="release" data-id="${order.id}">Back to queue</button>`);
    }

    var memberLine = order.memberName
      ? order.memberName + ' \u00b7 ' + order.memberNumber
      : 'Member ' + order.memberNumber;

    return html`<article class="chit ${order.status === 'held' ? 'is-held' : ''} ${state.selected === order.id ? 'is-selected' : ''} ${state.seen[order.id] ? '' : 'is-new'}"
      data-id="${order.id}" data-priority="${order.priority}" data-late="${t.level}" tabindex="0">
      <div class="chit-top">
        ${raw(order._key ? '<span class="chit-key">' + order._key + '</span>' : '')}
        <div>
          <div class="chit-no">#${order.ticketNo}</div>
        </div>
        <div>
          <div class="chit-where">${order.tagLabel}</div>
          <div class="chit-meta">${memberLine}</div>
        </div>
        <div class="chit-timer" data-late="${t.level}" data-timer="${order.id}">${mmss(t.seconds)}</div>
      </div>
      <div class="chit-badges">${raw(badges.join(''))}</div>
      ${raw(alert)}
      <ul class="chit-lines">${order.lines.map(renderLine)}</ul>
      ${raw(order.notes ? '<div class="chit-note">' + escapeHtml(order.notes) + '</div>' : '')}
      <div class="chit-actions">${buttons}</div>
    </article>`;
  }

  // --------------------------------------------------------------------- render

  function render() {
    keyMap();
    LANES.forEach(function (lane) {
      var orders = laneOrders(lane);
      document.getElementById('count-' + lane).textContent = orders.length;
      el.lanes[lane].innerHTML = orders.length
        ? orders.map(renderChit).join('')
        : '<div class="lane-empty">' + emptyText(lane) + '</div>';
    });

    // Mark everything on screen as seen so the entry animation only plays once.
    state.orders.forEach(function (o) { state.seen[o.id] = true; });

    var held = state.orders.filter(function (o) { return o.status === 'held'; });
    el.heldNote.textContent = held.length
      ? held.length + ' order' + (held.length === 1 ? '' : 's') + ' on hold'
      : '';
  }

  function emptyText(lane) {
    if (lane === 'queued') return 'No new orders';
    if (lane === 'cooking') return 'Nothing on the stove';
    return 'Nothing waiting on a runner';
  }

  function renderCounts(counts) {
    if (!counts) return;
    el.counts.innerHTML = [
      '<span class="kcount">Queue <b>' + counts.queued + '</b></span>',
      '<span class="kcount">Cooking <b>' + counts.cooking + '</b></span>',
      '<span class="kcount">Ready <b>' + counts.ready + '</b></span>',
      '<span class="kcount">Done today <b>' + counts.delivered + '</b></span>',
    ].join('');
  }

  /**
   * Tick every timer in place. Re-rendering once a second would move buttons
   * under a cook's finger, so only the text and the colour band change.
   */
  function tick() {
    el.clock.textContent = clockTime();
    state.orders.forEach(function (order) {
      var node = document.querySelector('[data-timer="' + order.id + '"]');
      if (!node) return;
      var t = timerFor(order);
      node.textContent = mmss(t.seconds);
      if (node.dataset.late !== t.level) {
        node.dataset.late = t.level;
        var chit = node.closest('.chit');
        if (chit) chit.dataset.late = t.level;
        if (t.level === 'late' && state.sound) chime('late');
      }
    });
  }

  // -------------------------------------------------------------------- actions

  async function act(orderId, action) {
    try {
      await db.transition(orderId, action, { actor: 'kitchen' });
      // No local patching needed: the Firestore listener delivers the new
      // state to this screen and every other one within a few hundred ms.
    } catch (err) {
      if (err.code === 'ILLEGAL_TRANSITION') {
        // Another screen already moved this chit. The transaction refused
        // rather than clobbering their work - this is the old 409.
        toast('Another screen already moved that ticket.', true);
      } else if (err.code === 'NOT_FOUND') {
        toast('That ticket is gone.', true);
      } else {
        toast(err.message, true);
      }
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (btn) {
      e.preventDefault();
      unlockAudio();
      state.selected = btn.dataset.id;
      act(btn.dataset.id, btn.dataset.act);
      return;
    }
    var chit = e.target.closest('.chit');
    if (chit) {
      state.selected = state.selected === chit.dataset.id ? null : chit.dataset.id;
      render();
    }
  });

  // ------------------------------------------------------------------- keyboard

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

    // Digits act as a bump bar: the number on the chit sends it forward.
    if (/^[1-9]$/.test(e.key)) {
      var map = keyMap();
      var id = map[Number(e.key)];
      if (!id) return;
      var order = state.orders.filter(function (o) { return o.id === id; })[0];
      if (!order) return;
      e.preventDefault();
      unlockAudio();
      var action = e.shiftKey ? UNDO[order.status] : (PRIMARY[order.status] || {}).action;
      if (!action) return;
      if (orderLib.allowedActions(order, config.sla).indexOf(action) === -1) {
        toast('Cannot ' + action + ' ticket #' + order.ticketNo + ' right now.', true);
        return;
      }
      state.selected = id;
      act(id, action);
      return;
    }

    var key = e.key.toLowerCase();

    if (key === 's') {
      setSound(!state.sound);
      return;
    }

    if ((key === 'h' || key === 'r') && state.selected) {
      var sel = state.orders.filter(function (o) { return o.id === state.selected; })[0];
      if (!sel) return;
      var want = key === 'h' ? (sel.status === 'held' ? 'release' : 'hold') : 'rush';
      if (orderLib.allowedActions(sel, config.sla).indexOf(want) === -1) {
        toast('Cannot ' + want + ' that ticket right now.', true);
        return;
      }
      act(sel.id, want);
    }

    if (e.key === 'Escape') {
      state.selected = null;
      render();
    }
  });

  // ---------------------------------------------------------------- sound + filter

  function setSound(on) {
    state.sound = on;
    remember('kds.sound', on);
    el.soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.soundIcon.innerHTML = on ? '&#128266;' : '&#128263;';
    if (on) {
      unlockAudio();
      chime('newOrder');
    }
  }

  el.soundToggle.addEventListener('click', function () { setSound(!state.sound); });

  el.stationFilter.addEventListener('change', function () {
    state.station = el.stationFilter.value;
    remember('kds.station', state.station);
    render();
  });

  /**
   * Read-only view of the 86 list. The manager sets it, but the cook is the
   * one who needs to see it while reading chits.
   */
  function render86(list) {
    if (!el.eightySix) return;
    if (!list.length) {
      el.eightySix.textContent = '';
      return;
    }
    var names = list.map(function (id) {
      var hit = menu.findAnywhere(id);
      return hit ? hit.name : id;
    });
    el.eightySix.textContent = '86: ' + names.join(', ');
  }

  // ----------------------------------------------------------------- live data

  /**
   * One Firestore listener carries the whole service day, delivered/voided
   * included, so the lane counts and the header totals come from the same
   * snapshot with no second read.
   */
  function onSnapshotOrders(orders) {
    var previous = {};
    state.orders.forEach(function (o) { previous[o.id] = o.status; });

    state.orders = orders;
    renderCounts(orderLib.metrics(orders, config.sla).counts);
    render();
    tick();

    if (!state.firstLoadDone) {
      state.firstLoadDone = true;
      return; // never chime through the backlog on first paint
    }

    orders.forEach(function (o) {
      var was = previous[o.id];
      var mine = !state.station || o.station === state.station;
      if (!mine) return;
      if (was === undefined && o.status === 'queued') {
        if (state.sound) chime('newOrder');
        toast('New ticket #' + o.ticketNo + ' · ' + o.tagLabel);
      } else if (was && was !== o.status && o.status === 'ready' && state.sound) {
        chime('runner');
      }
    });
  }

  // ----------------------------------------------------------------------- boot

  async function boot() {
    document.getElementById('brandMark').innerHTML = art('mark');

    if (!db.isConfigured) {
      throw new Error('Firebase is not configured yet - see app/firebase-config.js');
    }
    if (!(await requireStaff())) {
      throw new Error('Staff passcode required.');
    }

    config.kitchen.stations.forEach(function (st) {
      var opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.label;
      el.stationFilter.appendChild(opt);
    });
    el.stationFilter.value = state.station;
    setSound(state.sound);

    await db.ready();
    el.conn.className = 'conn is-live';
    el.conn.textContent = 'live';

    db.watchAvailability(render86);

    db.watchToday(onSnapshotOrders, {
      onError: function (err) {
        el.conn.className = 'conn is-down';
        el.conn.textContent = 'offline';
        toast('Lost the connection: ' + err.code, true);
      },
    });

    // Firestore reconnects on its own; the only thing that needs a heartbeat
    // is the on-screen clock and the elapsed timers.
    setInterval(tick, 1000);
  }

  boot().catch(function (err) {
    document.getElementById('lanes').innerHTML =
      '<div class="lane-empty" style="grid-column:1/-1">' +
      escapeHtml(err.message) + '</div>';
  });
})();
