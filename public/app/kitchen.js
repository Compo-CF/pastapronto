/**
 * Kitchen display (KDS).
 *
 * Three lanes - New Orders, Cooking, Ready - fed by the same SSE stream the
 * guest app uses. Design rules that drove this file:
 *
 *  - The clock on a chit answers "how long has this been MY problem", so it
 *    restarts at each hand-off: queue age, then cook time, then runner wait.
 *  - Colour escalates on the SLA from lib/config.js, never on a hunch.
 *  - Every button is reversible; nothing needs a confirm dialog mid-rush.
 *  - Timers tick without re-rendering, so a cook's finger never lands on a
 *    button that moved underneath it.
 */
(function () {
  'use strict';

  var html = PP.html;
  var raw = PP.raw;

  var state = {
    boot: null,
    orders: [],
    station: PP.recall('kds.station', ''),
    sound: PP.recall('kds.sound', false),
    selected: null,
    seen: {},
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
    toast: document.getElementById('toast'),
    heldNote: document.getElementById('heldNote'),
  };
  LANES.forEach(function (lane) {
    el.lanes[lane] = document.getElementById('lane-' + lane);
  });

  var toastTimer = null;
  function toast(message, bad) {
    el.toast.textContent = message;
    el.toast.className = 'toast' + (bad ? ' is-bad' : '');
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3400);
  }

  // ------------------------------------------------------------------ SLA clock

  /**
   * Which clock matters for this chit, and how alarming it is.
   * Returns { seconds, level: ''|'warn'|'late', label }.
   */
  function timerFor(order) {
    var sla = state.boot.sla;

    if (order.status === 'queued') {
      var waiting = PP.secondsSince(order.submittedAt);
      return {
        seconds: waiting,
        level: waiting >= sla.acceptLateSec ? 'late' : waiting >= sla.acceptWarnSec ? 'warn' : '',
        label: 'waiting',
      };
    }

    if (order.status === 'cooking') {
      var cooking = PP.secondsSince(order.acceptedAt);
      var target = order.cookEstimateSec || 1;
      return {
        seconds: cooking,
        level: cooking >= target * sla.cookLateFactor ? 'late'
          : cooking >= target * sla.cookWarnFactor ? 'warn' : '',
        label: 'of ' + PP.mmss(target),
      };
    }

    if (order.status === 'ready') {
      var sitting = PP.secondsSince(order.readyAt);
      return {
        seconds: sitting,
        level: sitting >= sla.runnerLateSec ? 'late' : sitting >= sla.runnerWarnSec ? 'warn' : '',
        label: 'on the pass',
      };
    }

    if (order.status === 'held') {
      // Freeze the clock at the moment it was parked; it is nobody's SLA now.
      return { seconds: PP.secondsSince(order.submittedAt), level: 'hold', label: 'held' };
    }

    return { seconds: PP.secondsSince(order.submittedAt), level: '', label: '' };
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
    var list = state.boot.menu[group] || [];
    var hit = list.filter(function (x) { return x.id === id; })[0];
    return hit ? hit.name : id;
  }

  function pastaShape(id) {
    var hit = (state.boot.menu.pastas || []).filter(function (x) { return x.id === id; })[0];
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
      <span class="cline-art">${raw(Art.art(pastaShape(line.pasta)))}</span>
      <div class="grow">
        <div class="cline-who">${line.guestLabel}</div>
        <div class="cline-dish">${line.dish}</div>
        ${raw(adds.length ? '<div class="cline-add">' + PP.escapeHtml(adds.join(' \u00b7 ')) + '</div>' : '')}
        <div class="cline-portion">${flags.join(' \u00b7 ')}</div>
        ${raw(line.notes ? '<div class="cline-note">! ' + PP.escapeHtml(line.notes) + '</div>' : '')}
      </div>
    </li>`;
  }

  function renderChit(order) {
    var t = timerFor(order);
    var badges = [];
    if (order.priority === 'rush') badges.push('<span class="badge badge-rush">Rush</span>');
    if (order.priority === 'allergy') badges.push('<span class="badge badge-allergy">Allergy</span>');
    badges.push('<span class="badge badge-station">' + PP.escapeHtml(order.station) + '</span>');
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
    if (primary && order.allowedActions.indexOf(primary.action) !== -1) {
      buttons.push(html`<button class="kact ${primary.cls}" data-act="${primary.action}" data-id="${order.id}">
        ${primary.label}</button>`);
    }
    var undo = UNDO[order.status];
    if (undo && order.allowedActions.indexOf(undo) !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="${undo}" data-id="${order.id}"
        title="Undo" aria-label="Undo">&#8630;</button>`);
    }
    if (order.allowedActions.indexOf('rush') !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="rush" data-id="${order.id}"
        title="Mark rush" aria-label="Mark rush">&#9889;</button>`);
    }
    if (order.allowedActions.indexOf('hold') !== -1) {
      buttons.push(html`<button class="kact kact-icon" data-act="hold" data-id="${order.id}"
        title="Hold" aria-label="Hold">&#10074;&#10074;</button>`);
    }
    if (order.allowedActions.indexOf('release') !== -1) {
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
        <div class="chit-timer" data-late="${t.level}" data-timer="${order.id}">${PP.mmss(t.seconds)}</div>
      </div>
      <div class="chit-badges">${raw(badges.join(''))}</div>
      ${raw(alert)}
      <ul class="chit-lines">${order.lines.map(renderLine)}</ul>
      ${raw(order.notes ? '<div class="chit-note">' + PP.escapeHtml(order.notes) + '</div>' : '')}
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
    el.clock.textContent = PP.clockTime();
    state.orders.forEach(function (order) {
      var node = document.querySelector('[data-timer="' + order.id + '"]');
      if (!node) return;
      var t = timerFor(order);
      node.textContent = PP.mmss(t.seconds);
      if (node.dataset.late !== t.level) {
        node.dataset.late = t.level;
        var chit = node.closest('.chit');
        if (chit) chit.dataset.late = t.level;
        if (t.level === 'late' && state.sound) PP.chime('late');
      }
    });
  }

  // -------------------------------------------------------------------- actions

  async function act(orderId, action) {
    try {
      var res = await PP.api('/api/orders/' + orderId + '/transition', {
        method: 'POST',
        body: { action: action, actor: 'kitchen' },
      });
      upsert(res.order);
      render();
    } catch (err) {
      // A 409 means another screen already moved this chit. Re-sync instead of
      // arguing with the server.
      if (err.status === 409) {
        toast('Another screen already moved that ticket.', true);
        await load();
      } else {
        toast(err.message, true);
      }
    }
  }

  function upsert(order) {
    var i = state.orders.findIndex(function (o) { return o.id === order.id; });
    var live = ['queued', 'cooking', 'ready', 'held'].indexOf(order.status) !== -1;
    var mine = !state.station || order.station === state.station;

    if (!live || !mine) {
      if (i !== -1) state.orders.splice(i, 1);
      return;
    }
    if (i === -1) state.orders.push(order);
    else state.orders[i] = order;
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (btn) {
      e.preventDefault();
      PP.unlockAudio();
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
      PP.unlockAudio();
      var action = e.shiftKey ? UNDO[order.status] : (PRIMARY[order.status] || {}).action;
      if (!action) return;
      if (order.allowedActions.indexOf(action) === -1) {
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
      if (sel.allowedActions.indexOf(want) === -1) {
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
    PP.remember('kds.sound', on);
    el.soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.soundIcon.innerHTML = on ? '&#128266;' : '&#128263;';
    if (on) {
      PP.unlockAudio();
      PP.chime('newOrder');
    }
  }

  el.soundToggle.addEventListener('click', function () { setSound(!state.sound); });

  el.stationFilter.addEventListener('change', function () {
    state.station = el.stationFilter.value;
    PP.remember('kds.station', state.station);
    load();
  });

  // ------------------------------------------------------------------ data load

  async function load() {
    try {
      var res = await PP.api('/api/kitchen/orders' + (state.station ? '?station=' + encodeURIComponent(state.station) : ''));
      state.orders = res.orders;
      renderCounts(res.counts);
      render();
      tick();
    } catch (err) {
      toast('Could not load orders: ' + err.message, true);
    }
  }

  function onEvent(type, data) {
    if (type === 'store.reset' || type === 'store.seeded') {
      load();
      return;
    }
    if (!data || !data.order) return;

    if (type === 'order.created') {
      var mine = !state.station || data.order.station === state.station;
      if (mine) {
        if (state.sound) PP.chime('newOrder');
        toast('New ticket #' + data.order.ticketNo + ' \u00b7 ' + data.order.tagLabel);
      }
    }
    if (type === 'order.updated' && data.order.status === 'ready' && state.sound) {
      PP.chime('runner');
    }

    upsert(data.order);
    render();
    refreshCounts();
  }

  var countsTimer = null;
  function refreshCounts() {
    // Counts include delivered/voided totals the lanes do not carry, so pull
    // them from the server - debounced, since a rush produces bursts.
    clearTimeout(countsTimer);
    countsTimer = setTimeout(async function () {
      try {
        var res = await PP.api('/api/metrics');
        renderCounts(res.metrics.counts);
      } catch (err) { /* counts are cosmetic */ }
    }, 400);
  }

  // ----------------------------------------------------------------------- boot

  async function boot() {
    document.getElementById('brandMark').innerHTML = Art.art('mark');
    state.boot = await PP.api('/api/bootstrap');

    state.boot.stations.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      el.stationFilter.appendChild(opt);
    });
    el.stationFilter.value = state.station;
    setSound(state.sound);

    await load();

    PP.stream({
      onEvent: onEvent,
      onStatus: function (s) {
        el.conn.className = 'conn ' + (s === 'live' ? 'is-live' : s === 'down' ? 'is-down' : '');
        el.conn.textContent = s === 'live' ? 'live' : s === 'down' ? 'reconnecting' : 'idle';
      },
    });

    setInterval(tick, 1000);
    // Safety net: if the stream ever silently dies, a slow poll keeps the rail
    // honest rather than showing a frozen board through a dinner rush.
    setInterval(load, 60000);
  }

  boot().catch(function (err) {
    document.getElementById('lanes').innerHTML =
      '<div class="lane-empty" style="grid-column:1/-1">Cannot reach the server. ' +
      PP.escapeHtml(err.message) + '</div>';
  });
})();
