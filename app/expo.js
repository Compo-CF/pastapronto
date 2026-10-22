/**
 * Expo / runner board.
 *
 * Deliberately narrower than the kitchen display: a runner needs the ticket
 * number, the destination, what is on the tray, and one button. Everything
 * else is noise while carrying four bowls.
 */
import { config, kindsForNight } from './config.js';
import * as menu from './menu.js';
// Aliased, because every render function here takes a parameter called
// `order` - the module would be shadowed inside exactly the places that
// need to ask it whether a kind gets built.
import * as orderLib from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import { mastheadHtml, pageTitle } from './brand.js';
import * as i18n from './i18n.js';
import {
  html, raw, mmss, clockTime, secondsSince, escapeHtml,
  remember, recall, chime, unlockAudio, toast, keepScreenAwake,
} from './ui.js';

const CATALOG = menu.catalog();

(function () {
  'use strict';

  // Tells the plain-script watchdog in expo.html that the modules loaded.
  window.__ppBooted = true;

  var state = {
    orders: [], sound: recall('expo.sound', false), firstLoadDone: false,
    // Which pass this pad belongs to. The club runs two, side by side and
    // deliberately independent: a pizza runner should not be reading pasta
    // tickets to find theirs.
    lane: recall('expo.lane', 'all'),
    night: config.defaultNight,
    // Which Coming Up ticket is open. One at a time: this column is narrow and
    // two open tickets push the rest of the night off the bottom of it.
    open: null,
  };

  var el = {
    readyGrid: document.getElementById('readyGrid'),
    nextList: document.getElementById('nextList'),
    laneFilter: document.getElementById('laneFilter'),
    readyCount: document.getElementById('readyCount'),
    nextCount: document.getElementById('nextCount'),
    clock: document.getElementById('clock'),
    conn: document.getElementById('conn'),
    soundToggle: document.getElementById('soundToggle'),
    soundIcon: document.getElementById('soundIcon'),
    toast: document.getElementById('toast'),
  };

  var t = i18n.translator('kitchen');


  function menuName(group, id) {
    var hit = (CATALOG[group] || []).filter(function (x) { return x.id === id; })[0];
    return hit ? ((t.isEs && hit.es) ? hit.es : hit.name) : id;
  }

  function pastaShape(id) {
    var hit = (CATALOG.pastas || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.shape : 'none';
  }

  /** A pizza line draws a pie; a pasta line draws its shape. */
  function lineGlyph(line) {
    return menu.kindOf(line) === 'pizza' ? 'pie' : pastaShape(line.pasta);
  }

  function waitLevel(sec) {
    var sla = config.sla;
    return sec >= sla.runnerLateSec ? 'late' : sec >= sla.runnerWarnSec ? 'warn' : '';
  }

  /** Only this pass's tickets, or all of them where no pass is chosen. */
  function mine() {
    if (state.lane === 'all') return state.orders;
    return state.orders.filter(function (o) { return (o.kind || 'pasta') === state.lane; });
  }

  /**
   * How much food, not how many tickets.
   *
   * The club asked for this and the reason is the job: a runner looking at
   * "3" needs to know whether that is three plates or nine, because it
   * decides whether they pick up a tray. Two tickets of four bowls each is a
   * different night from four tickets of one.
   */
  function itemsIn(orders) {
    return orders.reduce(function (a, o) { return a + ((o.lines || []).length); }, 0);
  }

  function readyOrders() {
    return mine()
      .filter(function (o) { return o.status === 'ready'; })
      .sort(function (a, b) { return new Date(a.readyAt) - new Date(b.readyAt); });
  }

  /**
   * Everything that is on its way to being food, from the moment it arrives.
   *
   * This used to start at the oven, so expo learned a table had ordered only
   * once a cook picked the ticket up. The club asked to see each order as soon
   * as it arrives: a runner who knows four pizzas landed for the patio can
   * clear a tray and warn the table, and that is the whole job.
   *
   * Strictly oldest first, by when the guest pressed send - not by how far
   * along it is. A list that reshuffles as tickets change stage is a list you
   * have to re-read, and the one thing expo needs from it is that the top is
   * the next thing to come out.
   */
  var COMING_UP = ['queued', 'building', 'cooking'];

  function cookingOrders() {
    return mine()
      .filter(function (o) { return COMING_UP.indexOf(o.status) !== -1; })
      .sort(function (a, b) { return new Date(a.submittedAt) - new Date(b.submittedAt); });
  }

  /** Where a ticket has got to, in words a runner can use. */
  var STAGE_LABEL = { queued: 'Just in', building: 'Building', cooking: 'Cooking' };

  /** "1 bowl", "2 pizzas" - a runner reads this card too often for it to
   *  keep saying "1 bowls". */
  function dishCount(order) {
    var n = order.lines.length;
    var one = order.kind === 'pizza' ? 'pizza' : order.kind === 'burger' ? 'burger' : 'bowl';
    return n + ' ' + one + (n === 1 ? '' : 's');
  }

  function renderReadyCard(order) {
    var wait = secondsSince(order.readyAt);
    var level = waitLevel(wait);

    var alert = order.avoidAllergens && order.avoidAllergens.length
      ? html`<div class="rcard-alert">ALLERGY - ${order.avoidAllergens.map(function (a) {
          return menuName('allergens', a);
        }).join(', ')} - confirm at the table</div>`
      : '';

    return html`<article class="rcard" data-late="${level}" data-id="${order.id}">
      <div class="rcard-top">
        <div class="rcard-no">#${order.ticketNo}</div>
        <div>
          <div class="rcard-where">${order.tagLabel}</div>
          <div class="rcard-sub">${(order.kind === 'pizza' ? 'PIZZA PASS' : 'PASTA PASS')} &middot; ${dishCount(order)} &middot; ${order.guestCount} guests &middot; ${order.memberName || 'Member ' + order.memberNumber}</div>
        </div>
        <div class="rcard-wait" data-timer="${order.id}">${mmss(wait)}</div>
      </div>
      ${raw(alert)}
      <div class="rcard-items">
        ${order.lines.map(function (line) {
          return html`<div class="rcard-item">
            ${raw(art(lineGlyph(line)))}
            <div class="grow">
              <b>${line.guestLabel}</b>
              <dl class="cline-rows">
                ${menu.ingredientList(line, t.lang).map(function (r) {
                  return html`<div class="cline-row"><dt>${r.label}</dt><dd>${r.items.join(', ')}</dd></div>`;
                })}
              </dl>
            </div>
          </div>`;
        })}
      </div>
      <button class="rcard-go" data-act="deliver" data-id="${order.id}">Deliver to ${order.tagLabel}</button>
      ${raw(orderLib.isBuilt(order.kind)
        ? '<button class="rcard-undo" data-act="unready" data-id="' + order.id + '">Not out yet</button>'
        : '')}
    </article>`;
  }

  /**
   * A ticket on the Coming Up list, closed to a line and openable to the whole
   * order.
   *
   * Closed by default because the value of this column is the shape of the
   * next ten minutes, not the detail of any one ticket. Open on tap because a
   * runner carrying a tray does need the detail - which bowl is whose, and
   * what is in the one the table asked about.
   */
  function renderNextCard(order) {
    var open = state.open === order.id;
    // Only a ticket in the oven has a meaningful countdown; one that just
    // arrived has not started cooking, and a number counting down from its
    // full cook time would be a promise nobody made.
    var started = order.status === 'cooking' && order.acceptedAt;
    var remaining = (order.cookEstimateSec || 0) - secondsSince(order.acceptedAt);
    var right = started
      ? html`<span class="ncard-eta ${remaining < 0 ? 'is-over' : ''}" data-eta="${order.id}">${remaining < 0 ? 'over ' + mmss(remaining * -1) : mmss(remaining)}</span>`
      : html`<span class="ncard-stage">${STAGE_LABEL[order.status] || order.status}</span>`;

    var allergens = order.avoidAllergens && order.avoidAllergens.length
      ? html`<div class="ncard-alert">ALLERGY - ${order.avoidAllergens.map(function (a) {
          return menuName('allergens', a);
        }).join(', ')}</div>`
      : '';

    var detail = open
      ? html`<div class="ncard-detail">
          ${raw(allergens)}
          <div class="ncard-meta">${order.memberName || 'Member ' + order.memberNumber}
            &middot; ${order.guestCount} guests
            &middot; ${STAGE_LABEL[order.status] || order.status}</div>
          ${order.lines.map(function (line) {
            return html`<div class="ncard-line">
              <div class="ncard-who">${raw(art(lineGlyph(line)))} <b>${line.guestLabel}</b></div>
              <dl class="cline-rows">
                ${menu.ingredientList(line, t.lang).map(function (r) {
                  return html`<div class="cline-row"><dt>${r.label}</dt><dd>${r.items.join(', ')}</dd></div>`;
                })}
              </dl>
              ${raw(line.notes ? '<div class="ncard-note">' + escapeHtml(line.notes) + '</div>' : '')}
            </div>`;
          })}
          ${raw(order.notes ? '<div class="ncard-note">Ticket note: ' + escapeHtml(order.notes) + '</div>' : '')}
        </div>`
      : '';

    /*
     * A pizza leaves the kitchen's hands at the oven door. The builder loads
     * it and moves on to the next one; nobody at the pizza station is watching
     * for it to come out, and the club did not want a second person standing
     * there to tap. So the window takes it out, which is also the moment the
     * window can actually see that it is done.
     *
     * A bowl is not like this - the cook who started it finishes it and hands
     * it over, so the rail keeps that tap.
     */
    var outOfOven = orderLib.isBuilt(order.kind) && order.status === 'cooking'
      ? html`<button class="ncard-go" data-act="ready" data-id="${order.id}">Out of the oven</button>`
      : '';

    return html`<div class="ncard ${open ? 'is-open' : ''}">
      <button class="ncard-head" type="button" data-open="${order.id}"
        aria-expanded="${open ? 'true' : 'false'}">
        <span class="ncard-no">#${order.ticketNo}</span>
        <span class="ncard-where">${order.tagLabel}<br><small class="rcard-sub">${dishCount(order)}</small></span>
        ${raw(right)}
      </button>
      ${raw(detail)}
      ${raw(outOfOven)}
    </div>`;
  }

  function render() {
    var ready = readyOrders();
    var next = cookingOrders();
    // The number is food. The label beside it says so, and the title spells
    // out the tickets behind it for anyone who wants them.
    var readyItems = itemsIn(ready);
    var nextItems = itemsIn(next);
    el.readyCount.textContent = readyItems;
    el.nextCount.textContent = nextItems;
    el.readyCount.title = readyItems + ' to run, across ' + ready.length + ' ticket' + (ready.length === 1 ? '' : 's');
    el.nextCount.title = nextItems + ' coming, across ' + next.length + ' ticket' + (next.length === 1 ? '' : 's');
    el.readyGrid.innerHTML = ready.length
      ? ready.map(renderReadyCard).join('')
      : '<div class="lane-empty">Nothing to run right now</div>';
    el.nextList.innerHTML = next.length
      ? next.map(renderNextCard).join('')
      : '<div class="lane-empty">Nothing on the stove</div>';
  }

  function tick() {
    el.clock.textContent = clockTime();
    readyOrders().forEach(function (order) {
      var node = document.querySelector('[data-timer="' + order.id + '"]');
      if (!node) return;
      var wait = secondsSince(order.readyAt);
      node.textContent = mmss(wait);
      var card = node.closest('.rcard');
      if (card) card.dataset.late = waitLevel(wait);
    });
    cookingOrders().forEach(function (order) {
      var node = document.querySelector('[data-eta="' + order.id + '"]');
      if (!node) return;
      var remaining = (order.cookEstimateSec || 0) - secondsSince(order.acceptedAt);
      node.textContent = remaining < 0 ? 'over ' + mmss(-remaining) : mmss(remaining);
      node.classList.toggle('is-over', remaining < 0);
    });
  }

  document.addEventListener('click', async function (e) {
    // Opening a ticket is a local view change, not a transition - it must not
    // fall through to db.transition() below.
    var opener = e.target.closest('[data-open]');
    if (opener) {
      e.preventDefault();
      state.open = state.open === opener.dataset.open ? null : opener.dataset.open;
      render();
      return;
    }

    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    unlockAudio();
    try {
      await db.transition(btn.dataset.id, btn.dataset.act, { actor: 'runner' });
    } catch (err) {
      if (err.code === 'ILLEGAL_TRANSITION') {
        toast('Another screen already ran that ticket.', true);
      } else {
        toast(err.message, true);
      }
    }
  });

  function setSound(on) {
    state.sound = on;
    remember('expo.sound', on);
    el.soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.soundIcon.innerHTML = on ? '&#128266;' : '&#128263;';
    if (on) { unlockAudio(); chime('runner'); }
  }
  el.soundToggle.addEventListener('click', function () { setSound(!state.sound); });

  /** Everything for the day arrives in one snapshot; we filter in memory. */
  function onSnapshotOrders(orders) {
    var previous = {};
    state.orders.forEach(function (o) { previous[o.id] = o.status; });

    state.orders = orders;
    render();
    tick();

    if (!state.firstLoadDone) {
      state.firstLoadDone = true;
      return;
    }
    orders.forEach(function (o) {
      if (previous[o.id] !== 'ready' && o.status === 'ready') {
        if (state.sound) chime('runner');
        toast('Ticket #' + o.ticketNo + ' is up for ' + o.tagLabel);
      }
    });
  }

  var LANE_LABEL = { pasta: 'Pasta pass', pizza: 'Pizza pass', burger: 'Grill pass' };

  /**
   * Offer only the passes running tonight.
   *
   * Two pads sit at the pizza station and the pasta range on a Neapolitan
   * night, and each wants its own. A pass that is not cooking tonight is not
   * an option, for the same reason the rail does not offer a cold station.
   */
  function fillLanes(night) {
    var kinds = kindsForNight(night);
    while (el.laneFilter.options.length > 1) el.laneFilter.remove(1);
    kinds.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = LANE_LABEL[k] || k;
      el.laneFilter.appendChild(opt);
    });
    // A pass that stopped running tonight takes this pad back to everything,
    // rather than leaving it filtered to a column that can never fill.
    if (state.lane !== 'all' && kinds.indexOf(state.lane) === -1) {
      state.lane = 'all';
      remember('expo.lane', state.lane);
    }
    el.laneFilter.value = state.lane;
  }

  el.laneFilter.addEventListener('change', function () {
    state.lane = el.laneFilter.value;
    remember('expo.lane', state.lane);
    render();
  });

  async function boot() {
    document.getElementById('masthead').innerHTML = mastheadHtml(art('mark'));
    document.title = pageTitle('Expo & Runners');

    if (!db.isConfigured) {
      throw new Error('Firebase is not configured yet - see app/firebase-config.js');
    }
    setSound(state.sound);

    // The expo board is read at a glance while someone's hands are full; a
    // screen that has dimmed defeats the point of having it.
    keepScreenAwake();

    await db.ready();
    el.conn.className = 'conn is-live';
    el.conn.textContent = 'live';
    if (db.cacheWarning) toast(db.cacheWarning, true);

    fillLanes(config.defaultNight);

    db.watchServiceNight(function (night) {
      state.night = night;
      fillLanes(night);
      render();
    });

    db.watchMenuOverrides(function () { render(); });

    db.watchToday(onSnapshotOrders, {
      onError: function (err) {
        el.conn.className = 'conn is-down';
        el.conn.textContent = 'offline';
        toast('Lost the connection: ' + err.code, true);
      },
    });

    setInterval(tick, 1000);
  }

  boot().catch(function (err) {
    el.readyGrid.innerHTML = '<div class="lane-empty">' + escapeHtml(err.message) + '</div>';
  });
})();
