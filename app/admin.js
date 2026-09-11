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
import { activeBrand, brandList, brandParam, mastheadHtml, pageTitle, switchBrand } from './brand.js';
import * as QR from './qr.js';
import {
  html, raw, mmss, escapeHtml, remember, recall, toast, requireStaff,
} from './ui.js';

const CATALOG = menu.catalog();

(function () {
  'use strict';

  var state = { base: '', orders: [], unavailable: [] };

  var el = {
    statgrid: document.getElementById('statgrid'),
    qrgrid: document.getElementById('qrgrid'),
    tents: document.getElementById('tents'),
    menuRef: document.getElementById('menuRef'),
    baseUrl: document.getElementById('baseUrl'),
    baseHint: document.getElementById('baseHint'),
    qrMeta: document.getElementById('qrMeta'),
    brandSwitch: document.getElementById('brandSwitch'),
    brandNote: document.getElementById('brandNote'),
    toast: document.getElementById('toast'),
  };

  // -------------------------------------------------------------------- stats

  function renderStats(m) {
    var onTime = m.onTimePct;
    var cards = [
      { label: 'Orders today', value: m.counts.total, note: m.counts.delivered + ' delivered' },
      // Covers is the AYCE charge count: one per guest, however many trips they
      // make. m.guestCountEntries is the raw sum, kept off the tile on purpose.
      { label: 'Covers = charges', value: m.covers, note: m.bowls + ' items out' },
      { label: 'Open now', value: m.counts.queued + m.counts.cooking + m.counts.ready,
        note: m.counts.queued + ' queued / ' + m.counts.cooking + ' cooking / ' + m.counts.ready + ' ready' },
      { label: 'Avg wait to accept', value: mmss(m.timings.avgQueueSec), note: 'target under ' + mmss(config.sla.acceptWarnSec) },
      { label: 'Avg cook time', value: mmss(m.timings.avgCookSec), note: 'accept to food up' },
      { label: 'Avg runner time', value: mmss(m.timings.avgRunnerSec), note: 'food up to table' },
      { label: 'Ticket time (p90)', value: mmss(m.timings.p90TotalSec), note: 'avg ' + mmss(m.timings.avgTotalSec) },
      { label: 'On time', value: onTime == null ? '--' : onTime + '%',
        note: 'within ' + config.sla.cookLateFactor + 'x estimate',
        good: onTime != null && onTime >= 90, bad: onTime != null && onTime < 75 },
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
   *
   * The brand rides along too. A guest's phone has never been to this site, so
   * it has nothing in storage to brand itself from - without this, codes
   * printed for a branded venue would open the default palette on every table.
   */
  function tagUrl(tag) {
    return state.base.replace(/\/+$/, '') + '/?t=' + tag.id + brandParam();
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
        <div class="tent-brand">${raw(activeBrand().wordmark)}</div>
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

    /**
   * The 86 switch. Named after the line-cook shorthand for "we are out of it".
   * Living in the menu table means a manager toggles an ingredient in the same
   * place they read its cook time, rather than hunting a separate screen.
   */
  function eightySixToggle(item) {
    var off = state.unavailable.indexOf(item.id) !== -1;
    return '<button class="eighty-six' + (off ? ' is-off' : '') + '" type="button"' +
      ' data-act="toggle86" data-id="' + escapeHtml(item.id) + '"' +
      ' aria-pressed="' + (off ? 'true' : 'false') + '"' +
      ' title="' + (off ? 'Put back on the menu' : '86 this - hide it from guests') + '">' +
      (off ? '86' : 'on') + '</button>';
  }

  function menuTable(caption, items, secField, secLabel) {
    return html`<table class="mtable">
      <caption>${caption}</caption>
      <thead><tr>
        <th>Item</th><th>Allergens</th>
        ${raw(secField ? '<th class="num">' + escapeHtml(secLabel) + '</th>' : '')}
        <th>Kid menu</th><th class="num">86</th>
      </tr></thead>
      <tbody>
        ${items.map(function (i) {
          return html`<tr>
            <td>${i.name}</td>
            <td class="allerg">${allergenCodes(i)}</td>
            ${raw(secField ? '<td class="num">' + (i[secField] != null ? mmss(i[secField]) : '-') + '</td>' : '')}
            <td>${i.kid ? 'yes' : ''}</td>
            <td class="num">${raw(eightySixToggle(i))}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  function render86Summary() {
    var el86 = document.getElementById('summary86');
    if (!el86) return;
    if (!state.unavailable.length) {
      el86.className = 'notice';
      el86.style.background = '#f4ece0';
      el86.style.color = '#6b6058';
      el86.textContent = 'Everything is on. Use the 86 column below to take an ingredient off the menu.';
      return;
    }
    var names = state.unavailable.map(function (id) {
      var item = menu.findAnywhere(id);
      return item ? item.name : id;
    });
    el86.className = 'notice notice-warn';
    el86.style.background = '';
    el86.style.color = '';
    el86.textContent = '86 right now (' + names.length + '): ' + names.join(', ');
  }

  /**
   * The chef's reference and the 86 switches, split by station.
   *
   * Both lanes must appear here or half the menu cannot be taken off - the
   * pizza groups were missing at first, which meant no way to 86 pepperoni.
   */
  function renderMenu() {
    var m = CATALOG;

    var pastaTables = [
      menuTable('Pasta (boil time, parcooked)', m.pastas, 'boilSec', 'Boil'),
      menuTable('Pasta sauces (finish time)', m.sauces, 'finishSec', 'Finish'),
      menuTable('Proteins', m.proteins, 'addSec', 'Add'),
      menuTable('Pasta toppings', m.toppings, 'addSec', 'Prep'),
      menuTable('Sides', m.sides, 'cookSec', 'Cook'),
    ].join('');

    var pizzaTables = [
      menuTable('Pizza sauces', m.pizzaSauces, null, ''),
      menuTable('Pizza cheeses', m.pizzaCheeses, 'addSec', 'Bake'),
      menuTable('Pizza proteins', m.pizzaProteins, 'addSec', 'Prep'),
      menuTable('Pizza toppings', m.pizzaToppings, 'addSec', 'Prep'),
      menuTable('Finishers (after the bake)', m.finishers, null, ''),
    ].join('');

    el.menuRef.innerHTML =
      '<h3 class="menu-station">Pasta station</h3>' +
      '<div class="mtable-wrap">' + pastaTables + '</div>' +
      '<h3 class="menu-station">Pizza station' +
      '<span class="menu-station-sub">every pizza is a 12" ' +
      escapeHtml(m.pizzaBase.name.replace('12" ', '')) + ' base &middot; ' +
      Math.round(m.pizzaBase.bakeSec / 60) + ' min bake &middot; ' +
      'carries ' + m.pizzaBase.allergens.join(', ') +
      '</span></h3>' +
      '<div class="mtable-wrap">' + pizzaTables + '</div>' +
      '<p class="muted" style="font-size:14px;margin:14px 0 0">' +
      'Allergen codes: ' +
      m.allergens.map(function (a) { return a.code + ' = ' + a.name; }).join(' · ') +
      '</p>';
  }

  // -------------------------------------------------------------------- events

  /**
   * 86 switches are rendered inside the menu tables, which are rebuilt whenever
   * the list changes, so the handler is delegated rather than bound per button.
   */
  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-act="toggle86"]');
    if (!btn) return;
    e.preventDefault();
    var id = btn.dataset.id;
    var next = state.unavailable.indexOf(id) === -1
      ? state.unavailable.concat([id])
      : state.unavailable.filter(function (x) { return x !== id; });
    var item = menu.findAnywhere(id);
    try {
      await db.setUnavailable(next);
      toast((item ? item.name : id) + (next.indexOf(id) !== -1 ? ' is 86 - guests will see it sold out' : ' is back on the menu'));
    } catch (err) {
      toast('Could not update the 86 list: ' + err.message, true);
    }
  });

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
      var dir = await db.seedMembers(seed.MEMBERS);
      var built = seed.buildDemoOrders();
      var n = await db.seedOrders(built);
      toast(n + ' demo chits written, ' + dir.written + ' members in the directory'
        + (dir.removed ? ' (' + dir.removed + ' stale removed).' : '.'));
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

  // ------------------------------------------------------------------ branding

  /**
   * Brand chooser for the quiet corner.
   *
   * Staff-only on purpose. A guest should never see a control that changes
   * whose restaurant they think they are in, and a manager sets this once when
   * the venue is installed - so it lives at the bottom of this screen and
   * nowhere else. The choice is per device, which is also what makes it safe
   * to flip mid-pitch on a laptop without touching anyone's phone.
   */
  function renderBrandSwitch() {
    var brands = brandList();

    el.brandSwitch.innerHTML = brands.map(function (b) {
      return html`<button class="brandopt" type="button"
        data-brand="${b.id}" aria-pressed="${b.active ? 'true' : 'false'}">
        <span class="brandopt-name">${b.label}</span>
        <span class="brandopt-sub">${b.sub}</span>
      </button>`;
    }).join('');

    el.brandNote.textContent = 'Remembered on this device, and printed into the '
      + 'QR codes above so a guest’s phone opens the same brand. Every staff '
      + 'screen here follows it.';
  }

  el.brandSwitch.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.brandopt');
    if (!btn) return;
    var id = btn.getAttribute('data-brand');
    if (id === activeBrand().id) return;
    switchBrand(id);
  });

  // ---------------------------------------------------------------------- boot

  async function boot() {
    document.getElementById('masthead').innerHTML = mastheadHtml(art('mark'));
    document.title = pageTitle('Manager');

    if (!(await requireStaff())) {
      throw new Error('Staff passcode required.');
    }

    renderBrandSwitch();

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

    // The 86 list is shared state: another manager (or the cook) toggling
    // something shows up here without a refresh.
    db.watchAvailability(function (list) {
      state.unavailable = list;
      renderMenu();
      render86Summary();
    });

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
