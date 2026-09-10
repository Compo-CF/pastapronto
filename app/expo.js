/**
 * Expo / runner board.
 *
 * Deliberately narrower than the kitchen display: a runner needs the ticket
 * number, the destination, what is on the tray, and one button. Everything
 * else is noise while carrying four bowls.
 */
import { config } from './config.js';
import * as menu from './menu.js';
import * as order from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import {
  html, raw, mmss, clockTime, secondsSince, escapeHtml,
  remember, recall, chime, unlockAudio, toast, requireStaff,
} from './ui.js';

const CATALOG = menu.catalog();

(function () {
  'use strict';

  var state = { orders: [], sound: recall('expo.sound', false), firstLoadDone: false };

  var el = {
    readyGrid: document.getElementById('readyGrid'),
    nextList: document.getElementById('nextList'),
    readyCount: document.getElementById('readyCount'),
    nextCount: document.getElementById('nextCount'),
    clock: document.getElementById('clock'),
    conn: document.getElementById('conn'),
    soundToggle: document.getElementById('soundToggle'),
    soundIcon: document.getElementById('soundIcon'),
    toast: document.getElementById('toast'),
  };

  function menuName(group, id) {
    var hit = (CATALOG[group] || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.name : id;
  }

  function pastaShape(id) {
    var hit = (CATALOG.pastas || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.shape : 'none';
  }

  function waitLevel(sec) {
    var sla = config.sla;
    return sec >= sla.runnerLateSec ? 'late' : sec >= sla.runnerWarnSec ? 'warn' : '';
  }

  function readyOrders() {
    return state.orders
      .filter(function (o) { return o.status === 'ready'; })
      .sort(function (a, b) { return new Date(a.readyAt) - new Date(b.readyAt); });
  }

  function cookingOrders() {
    return state.orders
      .filter(function (o) { return o.status === 'cooking'; })
      .sort(function (a, b) { return new Date(a.acceptedAt) - new Date(b.acceptedAt); });
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
          <div class="rcard-sub">${order.lines.length} bowls &middot; ${order.guestCount} guests &middot; ${order.memberName || 'Member ' + order.memberNumber}</div>
        </div>
        <div class="rcard-wait" data-timer="${order.id}">${mmss(wait)}</div>
      </div>
      ${raw(alert)}
      <div class="rcard-items">
        ${order.lines.map(function (line) {
          return html`<div class="rcard-item">
            ${raw(art(pastaShape(line.pasta)))}
            <span><b>${line.guestLabel}</b> ${line.dish}</span>
          </div>`;
        })}
      </div>
      <button class="rcard-go" data-act="deliver" data-id="${order.id}">Delivered to ${order.tagLabel}</button>
    </article>`;
  }

  function renderNextCard(order) {
    var cooking = secondsSince(order.acceptedAt);
    var remaining = (order.cookEstimateSec || 0) - cooking;
    return html`<div class="ncard">
      <span class="ncard-no">#${order.ticketNo}</span>
      <span class="ncard-where">${order.tagLabel}<br><small class="rcard-sub">${order.lines.length} bowls</small></span>
      <span class="ncard-eta ${remaining < 0 ? 'is-over' : ''}" data-eta="${order.id}">${remaining < 0 ? 'over ' + mmss(-remaining) : mmss(remaining)}</span>
    </div>`;
  }

  function render() {
    var ready = readyOrders();
    var next = cookingOrders();
    el.readyCount.textContent = ready.length;
    el.nextCount.textContent = next.length;
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

  async function boot() {
    document.getElementById('brandMark').innerHTML = art('mark');

    if (!db.isConfigured) {
      throw new Error('Firebase is not configured yet - see app/firebase-config.js');
    }
    if (!(await requireStaff())) {
      throw new Error('Staff passcode required.');
    }

    setSound(state.sound);
    await db.ready();
    el.conn.className = 'conn is-live';
    el.conn.textContent = 'live';

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
