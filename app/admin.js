/**
 * Manager screen: service metrics, QR code generation for every table tag,
 * printable table tents, and a menu and allergen reference for the chef.
 *
 * The QR codes are generated in the browser by /app/qr.js - no external
 * service ever sees the venue's URLs, and it works with the wifi unplugged.
 */
import { config, serviceDate } from './config.js';
import * as menu from './menu.js';
import * as order from './order.js';
import * as costing from './costing.js';
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

  var state = {
    base: '', orders: [], unavailable: [],
    costs: { items: {}, chargePerCover: null },
  };

  var el = {
    statgrid: document.getElementById('statgrid'),
    qrgrid: document.getElementById('qrgrid'),
    tents: document.getElementById('tents'),
    menuRef: document.getElementById('menuRef'),
    baseUrl: document.getElementById('baseUrl'),
    baseHint: document.getElementById('baseHint'),
    qrMeta: document.getElementById('qrMeta'),
    costSummary: document.getElementById('costSummary'),
    costSheet: document.getElementById('costSheet'),
    chargePerCover: document.getElementById('chargePerCover'),
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
      // A tent is the one piece of this app a member holds in their hands, so
      // it wears the venue's own identity rather than the app's. A brand with
      // a logo gets a colour band behind it - Carlton Woods' mark is white on
      // transparent and would be an empty rectangle on white paper.
      var brand = activeBrand();
      var crown = brand.logo
        ? '<img class="tent-logo" src="' + escapeHtml(brand.logo) + '" alt="'
          + escapeHtml(brand.logoAlt || brand.orgName || brand.venueName) + '">'
        : '<div class="tent-wordmark">' + brand.wordmark + '</div>';

      return html`<div class="tent ${brand.logo ? 'has-crown' : ''}">
        <div class="tent-crown">${raw(crown)}</div>
        ${raw(brand.logo ? '<div class="tent-event">' + escapeHtml(brand.venueName) + '</div>' : '')}
        ${raw(brand.tagline ? '<div class="tent-tagline">' + escapeHtml(brand.tagline) + '</div>' : '')}
        <div class="tent-rule"></div>
        <div class="tent-where">${tag.label}</div>
        ${raw(svg)}
        <div class="tent-how">Point your phone camera at the code to build your own
          bowl or pizza. Kids can do it themselves - you will need your member number.</div>
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
   * place they read its allergens, rather than hunting a separate screen.
   */
  function eightySixToggle(item) {
    var off = state.unavailable.indexOf(item.id) !== -1;
    return '<button class="eighty-six' + (off ? ' is-off' : '') + '" type="button"' +
      ' data-act="toggle86" data-id="' + escapeHtml(item.id) + '"' +
      ' aria-pressed="' + (off ? 'true' : 'false') + '"' +
      ' title="' + (off ? 'Put back on the menu' : '86 this - hide it from guests') + '">' +
      (off ? '86' : 'on') + '</button>';
  }

  function menuTable(caption, items) {
    return html`<table class="mtable">
      <caption>${caption}</caption>
      <thead><tr>
        <th>Item</th><th>Allergens</th><th>Kid menu</th><th class="num">86</th>
      </tr></thead>
      <tbody>
        ${items.map(function (i) {
          return html`<tr>
            <td>${i.name}</td>
            <td class="allerg">${allergenCodes(i)}</td>
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

    /*
     * The count rides on the pill as well as in the panel. The 86 list is the
     * only live service state on this screen - everything else here is set
     * once - so it is the one thing that must not go quiet just because a
     * manager is looking at the cost sheet.
     */
    var badge = document.getElementById('badge86');
    if (badge) {
      badge.textContent = state.unavailable.length;
      badge.hidden = state.unavailable.length === 0;
      var n = state.unavailable.length;
      document.getElementById('tab-menu').setAttribute('aria-label', n
        ? 'Menu, allergens and 86 list - ' + n + ' ingredient' + (n === 1 ? '' : 's') + ' off the menu'
        : 'Menu, allergens and 86 list');
    }

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
      menuTable('Pasta', m.pastas),
      menuTable('Pasta sauces', m.sauces),
      menuTable('Proteins', m.proteins),
      menuTable('Pasta toppings', m.toppings),
      menuTable('Sides', m.sides),
    ].join('');

    var pizzaTables = [
      menuTable('Pizza sauces', m.pizzaSauces),
      menuTable('Pizza cheeses', m.pizzaCheeses),
      menuTable('Pizza proteins', m.pizzaProteins),
      menuTable('Pizza toppings', m.pizzaToppings),
    ].join('');

    el.menuRef.innerHTML =
      '<h3 class="menu-station">Pasta station</h3>' +
      '<div class="mtable-wrap">' + pastaTables + '</div>' +
      '<h3 class="menu-station">Pizza station' +
      '<span class="menu-station-sub">every pizza is a 12" ' +
      escapeHtml(m.pizzaBase.name.replace('12" ', '')) + ' base &middot; ' +
      'carries ' + m.pizzaBase.allergens.join(', ') +
      '</span></h3>' +
      '<div class="mtable-wrap">' + pizzaTables + '</div>' +
      '<p class="muted" style="font-size:14px;margin:14px 0 0">' +
      'Allergen codes: ' +
      m.allergens.map(function (a) { return a.code + ' = ' + a.name; }).join(' · ') +
      '</p>';
  }

  // ---------------------------------------------------------------- food cost

  /**
   * The cost sheet: one row per priceable ingredient, two boxes to fill in.
   *
   * Built once, at boot, and never rebuilt. Everything that changes - the
   * derived per-portion figure, tonight's usage, the summary - is written into
   * the cells it belongs to by applyCosts() below. Re-rendering this table on
   * every snapshot would be simpler to write and would eat the caret out of
   * whichever box the manager was typing in when the write came back.
   */
  function renderCostSheet() {
    el.costSheet.innerHTML = costing.costRows().map(function (lane) {
      return html`<div class="costlane">
        <h3 class="cost-station">${lane.label}</h3>
        ${lane.groups.map(function (g) {
          return html`<div class="ctable-wrap"><table class="ctable">
            <caption>${g.label}<span>a portion here means ${g.unitHint}</span></caption>
            <thead><tr>
              <th>Item</th>
              <th class="num">Pack price</th>
              <th class="num">Portions per pack</th>
              <th class="num">Per portion</th>
              <th class="num">Used</th>
              <th class="num">Tonight</th>
            </tr></thead>
            <tbody>
              ${g.items.map(function (i) {
                return html`<tr data-row="${i.id}">
                  <td class="name">${i.name}</td>
                  <td class="num"><input class="costinput" type="number" min="0" step="0.01"
                    inputmode="decimal" placeholder="0.00"
                    data-cost="price" data-id="${i.id}"
                    aria-label="Pack price for ${i.name}"></td>
                  <td class="num"><input class="costinput" type="number" min="0" step="1"
                    inputmode="numeric" placeholder="0"
                    data-cost="yield" data-id="${i.id}"
                    aria-label="Portions per pack for ${i.name}"></td>
                  <td class="num costper" data-per="${i.id}">&mdash;</td>
                  <td class="num uses" data-uses="${i.id}"></td>
                  <td class="num" data-spend="${i.id}"></td>
                </tr>`;
              })}
            </tbody>
          </table></div>`;
        })}
      </div>`;
    }).join('');
  }

  /** Tiles. Blank figures render as a dash, never as $0.00. */
  function costSummaryHtml(rep) {
    var pct = rep.foodCostPct;

    /*
     * Before anything is priced, the spend really is zero and the honest
     * rendering of it is still a dash. "Food spend tonight $0.00" is read as
     * "the food cost nothing", which is the one claim this whole module exists
     * to avoid making.
     */
    var anyPriced = rep.coverage.ingredientsPriced > 0;
    var known = anyPriced ? rep.totals.known : null;
    var perCover = anyPriced ? rep.totals.perCover : null;

    var cards = [
      { label: 'Cost per bowl', value: costing.money(rep.pasta.avg),
        note: rep.pasta.items
          ? rep.pasta.priced + ' of ' + rep.pasta.items + ' bowls fully priced'
          : 'no bowls tonight' },
      { label: 'Cost per pizza', value: costing.money(rep.pizza.avg),
        note: rep.pizza.items
          ? rep.pizza.priced + ' of ' + rep.pizza.items + ' pizzas fully priced'
          : 'no pizzas tonight' },
      { label: 'Food cost per cover', value: costing.money(perCover),
        note: rep.totals.covers + ' covers, all you can eat' },
      { label: 'Food spend tonight', value: costing.money(known),
        note: anyPriced ? rep.totals.items + ' items out' : 'nothing priced yet' },
    ];

    // Only worth a tile once someone has said what a cover is charged.
    if (pct != null) {
      cards.push({
        label: 'Food cost %', value: Math.round(pct) + '%',
        note: 'of ' + costing.money(rep.chargePerCover) + ' a cover, target under 35%',
        good: pct <= 35, bad: pct > 45,
      });
    }

    if (rep.dearest) {
      cards.push({
        label: 'Dearest item built', value: costing.money(rep.dearest.total),
        note: 'ticket ' + rep.dearest.ticketNo + ' · ' + (rep.dearest.dish || rep.dearest.kind),
      });
    }

    return cards.map(function (c) {
      return html`<div class="stat ${c.good ? 'is-good' : ''} ${c.bad ? 'is-bad' : ''}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-note">${c.note}</div>
      </div>`;
    }).join('');
  }

  /**
   * How much of the figures above can be believed, said before they are read.
   *
   * This is the whole reason the costing module refuses to treat a missing
   * price as zero. A cost per cover built on two thirds of the ingredients is
   * not a low cost per cover, it is an incomplete one, and the difference has
   * to be on the screen next to the number.
   */
  function coverageHtml(rep) {
    if (!rep.totals.items) {
      return html`<div class="notice costcover">
        No orders on the rail yet, so there is nothing to cost. Prices entered
        below are kept, and these figures fill in as the night runs.
      </div>`;
    }
    if (rep.coverage.complete) {
      return html`<div class="notice notice-ok costcover">
        Every one of the ${rep.coverage.ingredientsPriced} ingredients that went
        out tonight is priced, so the figures above are the whole food cost.
      </div>`;
    }
    var gaps = rep.coverage.unpriced;
    var shown = gaps.slice(0, 8).map(function (g) { return g.name + ' (×' + g.uses + ')'; });
    if (gaps.length > shown.length) shown.push('and ' + (gaps.length - shown.length) + ' more');
    return html`<div class="notice notice-warn costcover">
      <strong>Part-priced:</strong> ${rep.coverage.itemsComplete} of
      ${rep.coverage.itemsTotal} items have every ingredient priced. The figures
      above count only what has a price, so treat them as a floor, not a cost.
      Still to price: ${shown.join(', ')}.
    </div>`;
  }

  /**
   * Push the current cost sheet and tonight's orders into the cells.
   *
   * Skips whichever input has focus. A snapshot arriving mid-keystroke would
   * otherwise overwrite what is being typed with what was last saved.
   */
  function applyCosts() {
    if (!el.costSheet) return;
    var items = state.costs.items || {};
    var rep = costing.costReport(state.orders, items, {
      chargePerCover: state.costs.chargePerCover,
    });

    var spendById = {};
    rep.contributors.forEach(function (c) { spendById[c.id] = c; });
    var gapById = {};
    rep.coverage.unpriced.forEach(function (g) { gapById[g.id] = g; });

    Array.prototype.forEach.call(el.costSheet.querySelectorAll('input[data-cost]'), function (input) {
      if (input === document.activeElement) return;
      var entry = items[input.dataset.id];
      var v = entry ? entry[input.dataset.cost] : null;
      input.value = v == null ? '' : String(v);
    });

    if (el.chargePerCover && el.chargePerCover !== document.activeElement) {
      el.chargePerCover.value = state.costs.chargePerCover == null
        ? '' : String(state.costs.chargePerCover);
    }

    Array.prototype.forEach.call(el.costSheet.querySelectorAll('tr[data-row]'), function (row) {
      var id = row.getAttribute('data-row');
      var unit = costing.perPortion(items[id]);
      var spend = spendById[id];
      var used = spend ? spend.uses : (gapById[id] ? gapById[id].uses : 0);

      var per = row.querySelector('[data-per]');
      per.textContent = unit == null ? 'not priced' : costing.unitMoney(unit);
      per.classList.toggle('is-unset', unit == null);

      row.querySelector('[data-uses]').textContent = used ? String(used) : '';
      row.querySelector('[data-spend]').textContent = spend ? costing.money(spend.total) : '';

      // Marked only when it actually went out unpriced. An ingredient nobody
      // ordered is not a gap in tonight's number.
      row.classList.toggle('is-unpriced', !!gapById[id]);
      row.classList.toggle('is-idle', used === 0);
    });

    el.costSummary.innerHTML = costSummaryHtml(rep) + coverageHtml(rep);
  }

  /**
   * Take one box's value into state.
   *
   * An empty box removes the field rather than storing zero - "I have not
   * priced this" and "this costs nothing" are different claims, and only the
   * first should count against coverage. A row with neither field left drops
   * out of the document entirely.
   */
  function setCostField(id, field, rawValue) {
    var items = state.costs.items;
    var entry = items[id] || {};
    var s = String(rawValue == null ? '' : rawValue).trim();

    if (s === '') {
      delete entry[field];
    } else {
      var n = Number(s);
      // Refuse rather than store. applyCosts() puts the last good value back
      // as soon as the box loses focus, so the rejection is visible.
      if (!isFinite(n) || n < 0) return false;
      entry[field] = n;
    }

    if (entry.price == null && entry.yield == null) delete items[id];
    else items[id] = entry;
    return true;
  }

  /*
   * Writes are debounced. A manager tabbing along a row of packs would
   * otherwise fire a document write per field, and they all land on the same
   * document anyway - the last one is the only one that matters.
   */
  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!db.isConfigured) return;
      db.saveCosts(state.costs).catch(function (err) {
        toast('Could not save the cost sheet: ' + err.message, true);
      });
    }, 600);
  }

  /*
   * A number input reports a half-typed decimal as an empty string: type
   * "18.40" and the box reads back "18", "", "18.4". Clearing the field on
   * that empty reading blinks the row to "not priced" between two keystrokes,
   * which on a screen where "not priced" is a real state reads as the entry
   * having failed. So an empty box only counts as cleared on the way out, and
   * `change` fires on blur.
   */
  el.costSheet.addEventListener('input', function (ev) {
    var input = ev.target.closest('input[data-cost]');
    if (!input || input.value.trim() === '') return;
    if (setCostField(input.dataset.id, input.dataset.cost, input.value)) applyCosts();
  });
  el.costSheet.addEventListener('change', function (ev) {
    var input = ev.target.closest('input[data-cost]');
    if (!input) return;
    setCostField(input.dataset.id, input.dataset.cost, input.value);
    applyCosts();
    scheduleSave();
  });

  function readCharge() {
    state.costs.chargePerCover = costing.normalizeCharge(el.chargePerCover.value.trim());
  }

  el.chargePerCover.addEventListener('input', function () {
    if (el.chargePerCover.value.trim() === '') return;
    readCharge();
    applyCosts();
  });
  el.chargePerCover.addEventListener('change', function () {
    readCharge();
    applyCosts();
    scheduleSave();
  });

  // ------------------------------------------------------------------- panels

  /*
   * Three sections, one at a time. Each of them - the QR grid, the cost sheet,
   * the menu tables - is long enough on its own that stacking all three put
   * the last one below two screenfuls of the other two.
   *
   * Every panel stays rendered whether or not it is showing. Nothing in this
   * screen measures layout, so a hidden panel updates exactly as well as a
   * visible one and switching is instant rather than a re-render. The table
   * tents live outside the panels for the opposite reason: they print from the
   * QR panel's button, and hiding that panel would take them off the page.
   */
  var TABS = ['qr', 'cost', 'menu'];
  var activeTab = TABS[0];

  function showTab(name, moveFocus) {
    var tab = TABS.indexOf(name) === -1 ? TABS[0] : name;
    activeTab = tab;

    TABS.forEach(function (id) {
      var pill = document.getElementById('tab-' + id);
      var panel = document.getElementById('panel-' + id);
      var on = id === tab;
      pill.setAttribute('aria-selected', on ? 'true' : 'false');
      // Roving tabindex: the group is one tab stop, arrows move inside it.
      pill.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
      if (on && moveFocus) pill.focus();
    });

    remember('admin.tab', tab);
  }

  var subnav = document.querySelector('.subnav');

  subnav.addEventListener('click', function (ev) {
    var pill = ev.target.closest('[data-tab]');
    if (pill) showTab(pill.dataset.tab, false);
  });

  // Arrow keys are how a tablist is expected to work, and without them the
  // roving tabindex above would leave two of the three pills unreachable.
  subnav.addEventListener('keydown', function (ev) {
    var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    var jump = ev.key === 'Home' ? 0 : (ev.key === 'End' ? TABS.length - 1 : null);
    if (step === undefined && jump === null) return;

    ev.preventDefault();

    // Usually the key came from a pill. If focus is on the container itself,
    // step from whichever tab is open rather than doing nothing.
    var pill = ev.target.closest('[data-tab]');
    var at = TABS.indexOf(pill ? pill.dataset.tab : activeTab);
    var next = jump !== null ? jump : (at + step + TABS.length) % TABS.length;
    showTab(TABS[next], true);
  });

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

    // Whichever section this manager was last working in. A cost sheet takes
    // more than one sitting to fill in, and landing back on QR codes every
    // time would make that worse than it needs to be.
    showTab(recall('admin.tab', 'qr'), false);

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
    renderCostSheet();
    applyCosts();

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
    // The cost sheet is shared, not per-device: a chef pricing the walk-in on
    // the office iPad shows up here without a refresh, same as the 86 list.
    db.watchCosts(function (costs) {
      state.costs = costs;
      applyCosts();
    }, {
      onError: function (err) { toast('Could not read the cost sheet: ' + err.code, true); },
    });

    db.watchToday(function (orders) {
      state.orders = orders;
      renderStats(order.metrics(orders, config.sla));
      applyCosts();
    }, {
      onError: function (err) { toast('Lost the connection: ' + err.code, true); },
    });
  }

  boot().catch(function (err) {
    el.statgrid.innerHTML = '<div class="notice notice-bad">' + escapeHtml(err.message) + '</div>';
  });
})();
