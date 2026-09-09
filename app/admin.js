/**
 * Manager screen: service metrics, QR code generation for every table tag,
 * printable table tents, and a menu/cook-time reference for the chef.
 *
 * The QR codes are generated in the browser by /app/qr.js - no external
 * service ever sees the venue's URLs, and it works with the wifi unplugged.
 */
import { config, serviceDate } from './config.js';
import * as menu from './menu.js';
import * as order from './order.js';
import * as db from './db.js';
import * as seed from './seed.js';
import { art } from './art.js';
import * as QR from './qr.js';
import {
  html, raw, mmss, money, escapeHtml, remember, recall, toast, requireStaff,
} from './ui.js';

const CATALOG = menu.catalog();

(function () {
  'use strict';

  var state = { base: '', orders: [] };

  var el = {
    statgrid: document.getElementById('statgrid'),
    qrgrid: document.getElementById('qrgrid'),
    tents: document.getElementById('tents'),
    menuRef: document.getElementById('menuRef'),
    baseUrl: document.getElementById('baseUrl'),
    baseHint: document.getElementById('baseHint'),
    qrMeta: document.getElementById('qrMeta'),
    toast: document.getElementById('toast'),
  };

  // -------------------------------------------------------------------- stats

  function renderStats(m) {
    var onTime = m.onTimePct;
    var cards = [
      { label: 'Orders today', value: m.counts.total, note: m.counts.delivered + ' delivered' },
      { label: 'Covers', value: m.covers, note: m.bowls + ' bowls' },
      { label: 'Open now', value: m.counts.queued + m.counts.cooking + m.counts.ready,
        note: m.counts.queued + ' queued / ' + m.counts.cooking + ' cooking / ' + m.counts.ready + ' ready' },
      { label: 'Avg wait to accept', value: mmss(m.timings.avgQueueSec), note: 'target under ' + mmss(config.sla.acceptWarnSec) },
      { label: 'Avg cook time', value: mmss(m.timings.avgCookSec), note: 'accept to food up' },
      { label: 'Avg runner time', value: mmss(m.timings.avgRunnerSec), note: 'food up to table' },
      { label: 'Ticket time (p90)', value: mmss(m.timings.p90TotalSec), note: 'avg ' + mmss(m.timings.avgTotalSec) },
      { label: 'On time', value: onTime == null ? '--' : onTime + '%',
        note: 'within ' + config.sla.cookLateFactor + 'x estimate',
        good: onTime != null && onTime >= 90, bad: onTime != null && onTime < 75 },
      { label: 'Revenue', value: money(m.revenue), note: 'member charges' },
    ];

    el.statgrid.innerHTML = cards.map(function (c) {
      return html`<div class="stat ${c.good ? 'is-good' : ''} ${c.bad ? 'is-bad' : ''}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-note">${c.note}</div>
      </div>`;
    }).join('');
  }

  // ----------------------------------------------------------------- qr codes

  /**
   * QR target. A static host has no routing, so the table travels as a query
   * parameter rather than a path segment: https://host/pastapronto/?t=table-12
   */
  function tagUrl(tag) {
    return state.base.replace(/\/+$/, '') + '/?t=' + tag.id;
  }

  function renderQrs() {
    var versions = [];
    el.qrgrid.innerHTML = config.tags.map(function (tag) {
      var url = tagUrl(tag);
      var svg;
      try {
        var encoded = QR.encode(url);
        versions.push(encoded.version);
        svg = QR.toSvg(url, { quiet: 3, label: 'QR code for ' + tag.label });
      } catch (err) {
        return html`<div class="qrcard"><div class="qrcard-label">${tag.label}</div>
          <p class="muted">${err.message}</p></div>`;
      }
      return html`<div class="qrcard">
        ${raw(svg)}
        <div>
          <div class="qrcard-kind">${tag.kind}</div>
          <div class="qrcard-label">${tag.label}</div>
        </div>
        <div class="qrcard-url">${url}</div>
      </div>`;
    }).join('');

    el.tents.innerHTML = config.tags.map(function (tag) {
      var url = tagUrl(tag);
      var svg;
      try {
        svg = QR.toSvg(url, { quiet: 2, label: 'QR code for ' + tag.label });
      } catch (err) {
        return '';
      }
      return html`<div class="tent">
        <div class="tent-brand">Pasta<em>Pronto!</em></div>
        <div class="tent-where">${tag.label}</div>
        ${raw(svg)}
        <div class="tent-how">Point your phone camera at the code to build your own pasta bowl.
          Kids can do it themselves - you will need your member number.</div>
        <div class="tent-url">${url}</div>
        <div class="tent-fold"></div>
      </div>`;
    }).join('');

    var maxVersion = versions.length ? Math.max.apply(null, versions) : 0;
    el.qrMeta.textContent = config.tags.length + ' codes \u00b7 QR version ' + maxVersion +
      ' \u00b7 error correction M (recovers ~15% damage)';
  }

  // ------------------------------------------------------------- menu reference

  function allergenCodes(item) {
    if (!item.allergens || !item.allergens.length) return '';
    return item.allergens.map(function (a) {
      var hit = CATALOG.allergens.filter(function (x) { return x.id === a; })[0];
      return hit ? hit.code : a;
    }).join(' ');
  }

  function menuTable(caption, items, secField, secLabel) {
    return html`<table class="mtable">
      <caption>${caption}</caption>
      <thead><tr>
        <th>Item</th><th>Allergens</th>
        <th class="num">${secLabel}</th><th class="num">Price</th><th>Kid menu</th>
      </tr></thead>
      <tbody>
        ${items.map(function (i) {
          return html`<tr>
            <td>${i.name}</td>
            <td class="allerg">${allergenCodes(i)}</td>
            <td class="num">${i[secField] != null ? mmss(i[secField]) : '-'}</td>
            <td class="num">${i.price ? money(i.price) : '-'}</td>
            <td>${i.kid ? 'yes' : ''}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  function renderMenu() {
    var m = CATALOG;
    el.menuRef.innerHTML =
      '<div class="mtable-wrap">' +
      menuTable('Pasta (boil time)', m.pastas, 'boilSec', 'Boil') +
      menuTable('Sauces (finish time)', m.sauces, 'finishSec', 'Finish') +
      menuTable('Proteins', m.proteins, 'addSec', 'Add') +
      menuTable('Toppings', m.toppings, 'addSec', 'Prep') +
      menuTable('Sides', m.sides, 'cookSec', 'Cook') +
      '</div>' +
      '<p class="muted" style="font-size:14px;margin:14px 0 0">' +
      'Allergen codes: ' +
      m.allergens.map(function (a) { return a.code + ' = ' + a.name; }).join(' \u00b7 ') +
      '</p>';
  }

  // -------------------------------------------------------------------- events

  document.getElementById('regenBtn').addEventListener('click', function () {
    state.base = el.baseUrl.value.trim();
    remember('admin.base', state.base);
    renderQrs();
    toast('QR codes rebuilt for ' + state.base);
  });

  document.getElementById('printBtn').addEventListener('click', function () {
    window.print();
  });

  document.getElementById('seedBtn').addEventListener('click', async function () {
    try {
      await db.seedMembers(seed.MEMBERS);
      var built = seed.buildDemoOrders();
      var n = await db.seedOrders(built);
      toast(n + ' demo chits written to the kitchen rail.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async function () {
    if (!window.confirm('Delete every order for ' + serviceDate() + '? This cannot be undone.')) return;
    try {
      var removed = await db.resetDay();
      toast(removed + ' orders cleared.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------------------------------------------------------------------- boot

  async function boot() {
    document.getElementById('brandMark').innerHTML = art('mark');

    if (!requireStaff()) {
      throw new Error('Staff passcode required.');
    }

    // Whatever address this page was opened from is an address a phone can
    // reach, so it is the right default to print into the codes.
    var remembered = recall('admin.base', '');
    state.base = remembered || (location.origin + location.pathname.replace(/\/[^/]*$/, ''));
    el.baseUrl.value = state.base;
    el.baseHint.textContent =
      'Codes point here. Whatever address you can open this page from, a phone on the same network can too.';

    // QR codes and the menu reference need no backend at all, so they render
    // before we touch Firebase - a manager can still print table tents on a
    // half-configured install.
    renderQrs();
    renderMenu();

    if (!db.isConfigured) {
      el.statgrid.innerHTML =
        '<div class="notice notice-warn">No Firebase project connected yet, so there are no ' +
        'live numbers. QR codes and the menu reference above still work. ' +
        'Run <code>bash scripts/setup-firebase.sh</code> to finish setup.</div>';
      return;
    }

    await db.ready();

    // The manager screen watches the same live feed as the kitchen, so the
    // numbers move as service happens.
    db.watchToday(function (orders) {
      state.orders = orders;
      renderStats(order.metrics(orders, config.sla));
    }, {
      onError: function (err) { toast('Lost the connection: ' + err.code, true); },
    });
  }

  boot().catch(function (err) {
    el.statgrid.innerHTML = '<div class="notice notice-bad">' + escapeHtml(err.message) + '</div>';
  });
})();
