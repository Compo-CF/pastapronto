/**
 * Manager screen: service metrics, QR code generation for every table tag,
 * printable table tents, and a menu and allergen reference for the chef.
 *
 * The QR codes are generated in the browser by /app/qr.js - no external
 * service ever sees the venue's URLs, and it works with the wifi unplugged.
 */
import {
  config, serviceDate, nightList, nightById,
  allTags, customTagList, tagIdFor, kindsForNight,
} from './config.js';
import * as menu from './menu.js';
import * as order from './order.js';
import * as costing from './costing.js';
import * as db from './db.js';
import * as seed from './seed.js';
import { art } from './art.js';
import { activeBrand, mastheadHtml, pageTitle } from './brand.js';
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
    night: config.defaultNight,
    // The orders panel. `editing` is the id of the open ticket and `draft` is
    // the working copy of it - never the live snapshot, or a Firestore update
    // landing mid-edit would rewrite what a manager is halfway through typing.
    editing: null, draft: null,
    composing: false, compose: null, busy: false,
  };

  var el = {
    statgrid: document.getElementById('statgrid'),
    qrgrid: document.getElementById('qrgrid'),
    tents: document.getElementById('tents'),
    menuRef: document.getElementById('menuRef'),
    baseUrl: document.getElementById('baseUrl'),
    baseHint: document.getElementById('baseHint'),
    qrMeta: document.getElementById('qrMeta'),
    nightSwitch: document.getElementById('nightSwitch'),
    nightNote: document.getElementById('nightNote'),
    costSummary: document.getElementById('costSummary'),
    costSheet: document.getElementById('costSheet'),
    chargePerCover: document.getElementById('chargePerCover'),
    toast: document.getElementById('toast'),
    orderList: document.getElementById('orderList'),
    composeWrap: document.getElementById('composeWrap'),
    customTagList: document.getElementById('customTagList'),
    badgeOrders: document.getElementById('badgeOrders'),
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
   * The table and nothing else. This used to carry &brand= as well, because a
   * guest's phone has never been to this site and had nothing to brand itself
   * from - the brand is pinned now, so the codes are shorter and a code that
   * was printed and laminated cannot go stale when the brand changes.
   */
  function tagUrl(tag) {
    return state.base.replace(/\/+$/, '') + '/?t=' + tag.id;
  }

  function renderQrs() {
    var versions = [];
    el.qrgrid.innerHTML = allTags().map(function (tag) {
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

    el.tents.innerHTML = allTags().map(function (tag) {
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
    el.qrMeta.textContent = allTags().length + ' codes \u00b7 QR version ' + maxVersion +
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
      // The crust is a choice now, so the heading lists them rather than
      // stating one. A gluten-free base changes what the pie carries, which
      // is the first thing a manager fielding an allergy question needs.
      '<span class="menu-station-sub">' +
      escapeHtml(m.pizzaCrusts.map(function (c) {
        return c.name + (c.allergens.length ? ' (' + c.allergens.join(', ') + ')' : ' (no allergens)');
      }).join(' \u00b7 ')) +
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

  // -------------------------------------------------------------------- night

  /**
   * Which night the venue is running.
   *
   * Shared, not per device: flipping it here changes what a guest is offered
   * on a phone already open at a table, and which stations the kitchen routes
   * to. That is the whole point - the alternative is a deploy, and a themed
   * night that needs a deploy to move is a night nobody can move.
   *
   * Tickets already on the rail keep the night they were taken under. The
   * kitchen finishes what it started.
   */
  function renderNightSwitch() {
    el.nightSwitch.innerHTML = nightList().map(function (n) {
      var on = n.id === state.night;
      return html`<button class="nightopt" type="button"
        data-act="setNight" data-id="${n.id}" aria-pressed="${on ? 'true' : 'false'}">
        <span class="nightopt-name">${n.label}</span>
        <span class="nightopt-sub">${n.kinds.join(' + ')}</span>
      </button>`;
    }).join('');

    var live = state.orders.filter(function (o) {
      return order.LIVE_STATUSES.indexOf(o.status) !== -1;
    }).length;

    el.nightNote.textContent = 'Changes every guest phone and the kitchen rail within a second. '
      + (live
        ? live + ' ticket' + (live === 1 ? '' : 's') + ' still open - those keep the night they were taken under.'
        : 'Nothing open right now, so this is a clean switch.');
  }

  document.addEventListener('click', async function (ev) {
    var btn = ev.target.closest('[data-act="setNight"]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    if (id === state.night) return;
    try {
      await db.setServiceNight(id);
      toast(nightById(id).label + ' is on. Guest screens have switched.');
    } catch (err) {
      toast('Could not switch the night: ' + err.message, true);
    }
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
  var TABS = ['orders', 'qr', 'cost', 'menu'];
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

  // ---------------------------------------------------------------------- boot

  // ------------------------------------------------------------------ orders

  /**
   * What a manager has to be able to pick for each kind when taking an order
   * by word of mouth.
   *
   * Derived from the same groups the guest app builds from, in the order the
   * kitchen thinks about them. `single` is the choice a dish cannot have two
   * of - you get one shape and one size, one bun.
   */
  var COMPOSE = {
    pasta: [
      { field: 'pasta', group: 'pastas', label: 'Shape', single: true },
      { field: 'sauces', group: 'sauces', label: 'Sauce' },
      { field: 'proteins', group: 'proteins', label: 'Protein' },
      { field: 'toppings', group: 'toppings', label: 'Toppings' },
      { field: 'portion', group: 'portions', label: 'Size', single: true },
    ],
    pizza: [
      { field: 'base', group: 'pizzaCrusts', label: 'Crust', single: true },
      { field: 'sauces', group: 'pizzaSauces', label: 'Sauce' },
      { field: 'cheeses', group: 'pizzaCheeses', label: 'Cheese' },
      { field: 'proteins', group: 'pizzaProteins', label: 'Protein' },
      { field: 'toppings', group: 'pizzaToppings', label: 'Toppings' },
    ],
    burger: [
      { field: 'proteins', group: 'burgerPatties', label: 'Patty' },
      { field: 'base', group: 'burgerBuns', label: 'Bun', single: true },
      { field: 'cheeses', group: 'burgerCheeses', label: 'Cheese' },
      { field: 'toppings', group: 'burgerToppings', label: 'Toppings' },
      { field: 'sauces', group: 'burgerSauces', label: 'Sauce' },
      { field: 'sides', group: 'burgerSides', label: 'Side' },
    ],
  };

  var CATALOG = menu.catalog();

  function groupItems(groupName) {
    return (CATALOG[groupName] || []).filter(function (x) { return !x.retired; });
  }

  function itemLabel(groupName, id) {
    var found = (CATALOG[groupName] || []).find(function (x) { return x.id === id; });
    return found ? found.name : id;
  }

  /** A blank line of the given kind, with the single choices pre-filled. */
  /**
   * Swap in what a newly chosen base brings with it, and take out what the
   * last one brought. Same rule as the guest app, for the same reason: a
   * manager taking a dessert pizza by phone should get Nutella, strawberries
   * and powdered sugar already on it, and switching back to a classic crust
   * should take them off again rather than leave them on a pepperoni pie.
   */
  function applyBaseDefaults(line, groupName, oldId, newId) {
    if (oldId === newId || !groupName) return;

    var was = (CATALOG[groupName] || []).find(function (x) { return x.id === oldId; });
    if (was && was.defaults) {
      Object.keys(was.defaults).forEach(function (field) {
        line[field] = (line[field] || []).filter(function (id) {
          return was.defaults[field].indexOf(id) === -1;
        });
      });
    }

    var now = (CATALOG[groupName] || []).find(function (x) { return x.id === newId; });
    if (now && now.defaults) {
      Object.keys(now.defaults).forEach(function (field) {
        line[field] = now.defaults[field].slice();
      });
    }
  }

  function blankLine(kind, i) {
    var line = {
      guestLabel: 'Guest ' + (i + 1),
      sauces: [], proteins: [], toppings: [], cheeses: [], sides: [], notes: '',
    };
    (COMPOSE[kind] || []).forEach(function (spec) {
      if (!spec.single) return;
      var first = groupItems(spec.group)[0];
      line[spec.field] = first ? first.id : null;
      // The first crust is the classic one and brings nothing with it, but
      // that is a fact about today's menu rather than a rule - so ask.
      if (spec.field === 'base') applyBaseDefaults(line, spec.group, null, line[spec.field]);
    });
    return line;
  }

  function pickerHtml(spec, line, path) {
    var items = groupItems(spec.group);
    if (spec.single) {
      return html`<div class="field">
        <label>${spec.label}</label>
        <select class="select" data-edit="${path}" data-field="${spec.field}">
          ${items.map(function (x) {
            return html`<option value="${x.id}" ${raw(line[spec.field] === x.id ? 'selected' : '')}>${x.name}</option>`;
          })}
        </select>
      </div>`;
    }
    var chosen = line[spec.field] || [];
    return html`<div class="field">
      <label>${spec.label}</label>
      <div class="chips">
        ${items.map(function (x) {
          var on = chosen.indexOf(x.id) !== -1;
          return html`<button class="chip" type="button" data-toggle="${path}"
            data-field="${spec.field}" data-id="${x.id}"
            aria-pressed="${on ? 'true' : 'false'}">${x.name}</button>`;
        })}
      </div>
    </div>`;
  }

  function lineEditor(line, kind, path, index, canRemove) {
    return html`<div class="oline">
      <div class="row" style="align-items:flex-end;flex-wrap:wrap">
        <div class="field grow" style="min-width:160px">
          <label>Who it is for</label>
          <input class="input" type="text" maxlength="24" value="${line.guestLabel || ''}"
            data-edit="${path}" data-field="guestLabel">
        </div>
        ${raw(canRemove
          ? '<button class="btn btn-ghost" type="button" data-removeline="' + path + '">Remove</button>'
          : '')}
      </div>
      ${(COMPOSE[kind] || []).map(function (spec) { return pickerHtml(spec, line, path); })}
      <div class="field">
        <label>Note for the kitchen</label>
        <input class="input" type="text" maxlength="140" value="${line.notes || ''}"
          data-edit="${path}" data-field="notes">
      </div>
    </div>`;
  }

  function tagOptions(selectedId) {
    return allTags().map(function (tg) {
      return html`<option value="${tg.id}" ${raw(tg.id === selectedId ? 'selected' : '')}>${tg.label}</option>`;
    });
  }

  // --------------------------------------------------------------- the list

  function orderSummary(o) {
    return (o.lines || []).map(function (l) {
      return l.guestLabel + ': ' + l.dish;
    }).join(' \u00b7 ');
  }

  function orderRow(o) {
    var editable = o.status !== 'delivered' && o.status !== 'voided';
    var isOpen = state.editing === o.id;
    var edited = order.isEdited(o);

    var head = html`<div class="orow-head">
      <span class="orow-no">#${o.ticketNo}</span>
      <span class="orow-status is-${o.status}">${o.status}</span>
      <span class="orow-where">${o.tagLabel}</span>
      <span class="muted">${o.memberName || 'Member ' + o.memberNumber} \u00b7 ${o.guestCount} guests</span>
      ${raw(edited ? '<span class="orow-edited">Changed</span>' : '')}
      <span class="grow"></span>
      ${raw(editable
        ? '<button class="btn btn-ghost" type="button" data-openorder="' + o.id + '">'
          + (isOpen ? 'Close' : 'Change') + '</button>'
        : '')}
    </div>`;

    if (!isOpen) {
      return html`<div class="orow ${edited ? 'is-edited' : ''}">
        ${raw(head)}
        <div class="orow-body muted">${orderSummary(o)}</div>
      </div>`;
    }

    var d = state.draft;
    return html`<div class="orow is-open ${edited ? 'is-edited' : ''}">
      ${raw(head)}
      <div class="orow-edit stack">
        <div class="row" style="flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="min-width:200px">
            <label>Table</label>
            <select class="select" data-edit="order" data-field="tagId">${tagOptions(d.tagId)}</select>
          </div>
          <div class="field" style="width:120px">
            <label>Guests</label>
            <input class="input" type="number" min="1" max="${config.order.maxGuests}"
              value="${d.guestCount}" data-edit="order" data-field="guestCount">
          </div>
        </div>
        <div class="field">
          <label>Note for the whole ticket</label>
          <input class="input" type="text" maxlength="240" value="${d.notes || ''}"
            data-edit="order" data-field="notes">
        </div>
        ${d.lines.map(function (l, i) {
          return lineEditor(l, o.kind, 'line:' + i, i, d.lines.length > 1);
        })}
        <div class="row" style="flex-wrap:wrap">
          <button class="btn btn-primary" type="button" data-saveorder="${o.id}">Save changes</button>
          <button class="btn btn-ghost" type="button" data-openorder="${o.id}">Cancel</button>
          <span class="grow"></span>
          <button class="btn btn-ghost" type="button" data-voidorder="${o.id}">Void this ticket</button>
        </div>
      </div>
    </div>`;
  }

  function renderOrders() {
    var orders = (state.orders || []).slice().sort(function (a, b) {
      return (b.ticketNo || 0) - (a.ticketNo || 0);
    });

    var live = orders.filter(function (o) {
      return o.status !== 'delivered' && o.status !== 'voided';
    }).length;
    el.badgeOrders.hidden = live === 0;
    el.badgeOrders.textContent = String(live);

    el.orderList.innerHTML = orders.length
      ? orders.map(orderRow).join('')
      : '<div class="card muted">Nothing has been ordered yet tonight.</div>';

    el.composeWrap.innerHTML = state.composing ? composePanel() : '';
  }

  // ------------------------------------------------------------- composing

  function composePanel() {
    var c = state.compose;
    return html`<div class="card stack" style="margin-top:14px">
      <div class="row" style="align-items:center">
        <strong class="grow">Take an order</strong>
        <button class="btn btn-ghost" type="button" data-cancelcompose="1">Cancel</button>
      </div>
      <div class="row" style="flex-wrap:wrap;align-items:flex-end">
        <div class="field" style="min-width:200px">
          <label>Table</label>
          <select class="select" data-edit="compose" data-field="tagId">${tagOptions(c.tagId)}</select>
        </div>
        <div class="field" style="width:160px">
          <label>${config.venue.memberLabel}</label>
          <input class="input" type="text" inputmode="numeric" maxlength="4" value="${c.memberNumber}"
            data-edit="compose" data-field="memberNumber" placeholder="1794">
        </div>
        <div class="field" style="width:120px">
          <label>Guests</label>
          <input class="input" type="number" min="1" max="${config.order.maxGuests}"
            value="${c.guestCount}" data-edit="compose" data-field="guestCount">
        </div>
        <div class="field" style="min-width:150px">
          <label>Kind</label>
          <select class="select" data-edit="compose" data-field="kind">
            ${kindsForNight(state.night).map(function (k) {
              return html`<option value="${k}" ${raw(c.kind === k ? 'selected' : '')}>${k}</option>`;
            })}
          </select>
        </div>
      </div>
      ${c.lines.map(function (l, i) {
        return lineEditor(l, c.kind, 'cline:' + i, i, c.lines.length > 1);
      })}
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-ghost" type="button" data-addline="1">Add another item</button>
        <span class="grow"></span>
        <button class="btn btn-primary" type="button" data-placeorder="1"
          ${raw(state.busy ? 'disabled' : '')}>${state.busy ? 'Sending...' : 'Send to the kitchen'}</button>
      </div>
    </div>`;
  }

  function freshCompose() {
    var kinds = kindsForNight(state.night);
    var kind = kinds[0];
    var firstTable = allTags()[0];
    return {
      tagId: firstTable ? firstTable.id : null,
      memberNumber: '',
      guestCount: 1,
      kind: kind,
      lines: [blankLine(kind, 0)],
    };
  }

  // ---------------------------------------------------------------- actions

  /** Find the object a data-edit path points at. */
  function targetFor(path) {
    if (path === 'order') return state.draft;
    if (path === 'compose') return state.compose;
    var m = /^line:(\d+)$/.exec(path);
    if (m) return state.draft.lines[Number(m[1])];
    m = /^cline:(\d+)$/.exec(path);
    if (m) return state.compose.lines[Number(m[1])];
    return null;
  }

  function openOrder(id) {
    if (state.editing === id) { state.editing = null; state.draft = null; renderOrders(); return; }
    var o = (state.orders || []).find(function (x) { return x.id === id; });
    if (!o) return;
    state.editing = id;
    // A copy. Editing the live snapshot would mean a Firestore update halfway
    // through typing silently rewriting what is on screen.
    state.draft = {
      tagId: o.tag,
      guestCount: o.guestCount,
      notes: o.notes || '',
      lines: (o.lines || []).map(function (l) { return JSON.parse(JSON.stringify(l)); }),
    };
    renderOrders();
  }

  async function saveOrder(id) {
    var d = state.draft;
    if (!d) return;
    try {
      var result = await db.editOrder(id, {
        lines: d.lines,
        guestCount: Number(d.guestCount),
        notes: d.notes,
      }, { actor: 'manager', tagId: d.tagId });

      state.editing = null;
      state.draft = null;
      renderOrders();
      toast(result ? 'Saved. The kitchen screen is showing the change.' : 'Nothing had changed.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function voidOrder(id) {
    try {
      await db.transition(id, 'void', { actor: 'manager', note: 'voided by manager' });
      state.editing = null;
      state.draft = null;
      toast('Ticket voided.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function placeOrder() {
    var c = state.compose;
    if (!/^[1-9][0-9]{0,3}$/.test(String(c.memberNumber || ''))) {
      toast('A member number is needed so the night bills correctly.', true);
      return;
    }
    state.busy = true;
    renderOrders();
    try {
      var created = await db.submitOrder({
        memberNumber: String(c.memberNumber),
        memberName: '',
        memberStatus: 'unverified',
        lang: 'en',
        guestCount: Number(c.guestCount),
        // Says where it came from, so the close-out can tell a ticket a member
        // built from one a manager took at the bar.
        source: 'manager',
        avoidAllergens: [],
        notes: '',
        lines: c.lines.map(function (l) { return Object.assign({ kind: c.kind }, l); }),
      }, { tagId: c.tagId, queueDepth: 0 });

      state.busy = false;
      state.composing = false;
      state.compose = null;
      renderOrders();
      toast('Ticket #' + created.ticketNo + ' is on the rail.');
    } catch (err) {
      state.busy = false;
      renderOrders();
      toast(err.errors && err.errors.length ? err.errors[0] : err.message, true);
    }
  }

  // ------------------------------------------------------------- locations

  function renderCustomTags() {
    var list = customTagList();
    el.customTagList.innerHTML = list.length
      ? '<div class="chips">' + list.map(function (tg) {
        return html`<span class="chip is-static">${tg.label}
          <button class="chip-x" type="button" data-removetag="${tg.id}"
            aria-label="Remove ${tg.label}">&times;</button></span>`;
      }).join('') + '</div>'
      : '<p class="muted" style="margin:0;font-size:14px">No extra locations yet.</p>';
  }

  async function addTag() {
    var label = document.getElementById('newTagLabel').value.trim();
    var area = document.getElementById('newTagArea').value.trim() || 'Clubhouse';
    var id = tagIdFor(label);
    if (!id) { toast('Give the location a name.', true); return; }
    if (allTags().some(function (tg) { return tg.id === id; })) {
      toast('There is already a location called that.', true);
      return;
    }
    try {
      await db.saveTags(customTagList().concat([{ id: id, label: label, kind: 'table', area: area }]));
      document.getElementById('newTagLabel').value = '';
      document.getElementById('newTagArea').value = '';
      toast(label + ' added. Its code is below.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function removeTag(id) {
    try {
      await db.saveTags(customTagList().filter(function (tg) { return tg.id !== id; }));
      toast('Location removed. Any code already printed for it will stop working.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // --------------------------------------------------------------- wiring

  document.getElementById('newOrderBtn').addEventListener('click', function () {
    state.composing = !state.composing;
    state.compose = state.composing ? freshCompose() : null;
    renderOrders();
  });

  document.getElementById('addTagBtn').addEventListener('click', addTag);

  // One delegated listener for the whole panel. The markup is re-rendered on
  // every keystroke that matters, so individually bound handlers would be
  // rebound constantly and leak.
  document.getElementById('panel-orders').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-openorder],[data-saveorder],[data-voidorder],[data-toggle],[data-removeline],[data-addline],[data-placeorder],[data-cancelcompose]');
    if (!t) return;
    if (t.dataset.openorder) return openOrder(t.dataset.openorder);
    if (t.dataset.saveorder) return saveOrder(t.dataset.saveorder);
    if (t.dataset.voidorder) return voidOrder(t.dataset.voidorder);
    if (t.dataset.placeorder) return placeOrder();
    if (t.dataset.cancelcompose) {
      state.composing = false; state.compose = null; return renderOrders();
    }
    if (t.dataset.addline) {
      state.compose.lines.push(blankLine(state.compose.kind, state.compose.lines.length));
      return renderOrders();
    }
    if (t.dataset.removeline) {
      var rm = /^(c?)line:(\d+)$/.exec(t.dataset.removeline);
      if (!rm) return;
      var list = rm[1] ? state.compose.lines : state.draft.lines;
      list.splice(Number(rm[2]), 1);
      return renderOrders();
    }
    if (t.dataset.toggle) {
      var obj = targetFor(t.dataset.toggle);
      if (!obj) return;
      var field = t.dataset.field;
      var arr = obj[field] || (obj[field] = []);
      var at = arr.indexOf(t.dataset.id);
      if (at === -1) arr.push(t.dataset.id); else arr.splice(at, 1);
      return renderOrders();
    }
    return undefined;
  });

  // Typing is kept out of the re-render path: rewriting the panel on every
  // keystroke would move the caret to the end of whatever was being typed.
  document.getElementById('panel-orders').addEventListener('input', function (ev) {
    var t = ev.target.closest('[data-edit]');
    if (!t) return;
    var obj = targetFor(t.dataset.edit);
    if (obj) obj[t.dataset.field] = t.value;
  });

  document.getElementById('panel-orders').addEventListener('change', function (ev) {
    var t = ev.target.closest('[data-edit]');
    if (!t || t.tagName !== 'SELECT') return;
    var obj = targetFor(t.dataset.edit);
    if (!obj) return;
    // A base can come with a recipe attached, and the swap has to happen
    // before the new value lands so the old one can be undone.
    if (t.dataset.field === 'base') {
      var forKind = /^cline:/.test(t.dataset.edit)
        ? state.compose.kind
        : (state.orders.find(function (o) { return o.id === state.editing; }) || {}).kind;
      var spec = (COMPOSE[forKind] || []).find(function (x) { return x.field === 'base'; });
      if (spec) applyBaseDefaults(obj, spec.group, obj.base, t.value);
    }

    obj[t.dataset.field] = t.value;
    // Switching kind invalidates every choice already made - a pizza has no
    // shape and a bowl has no bun.
    if (t.dataset.field === 'kind' && t.dataset.edit === 'compose') {
      state.compose.lines = state.compose.lines.map(function (_, i) {
        return blankLine(state.compose.kind, i);
      });
    }
    renderOrders();
  });

  document.getElementById('panel-qr').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-removetag]');
    if (t) removeTag(t.dataset.removetag);
  });

  async function boot() {
    document.getElementById('masthead').innerHTML = mastheadHtml(art('mark'));
    document.title = pageTitle('Manager');

    if (!(await requireStaff())) {
      throw new Error('Staff passcode required.');
    }

    // Whichever section this manager was last working in. A cost sheet takes
    // more than one sitting to fill in, and landing back on QR codes every
    // time would make that worse than it needs to be.
    showTab(recall('admin.tab', 'orders'), false);

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
    renderNightSwitch();
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
    db.watchServiceNight(function (night) {
      state.night = night;
      renderNightSwitch();
      renderMenu();
    }, {
      onError: function (err) { toast('Could not read the service night: ' + err.code, true); },
    });

    db.watchCosts(function (costs) {
      state.costs = costs;
      applyCosts();
    }, {
      onError: function (err) { toast('Could not read the cost sheet: ' + err.code, true); },
    });

    db.watchTags(function () {
      renderCustomTags();
      renderQrs();
      // An order panel that is open shows a table dropdown built from this.
      if (state.editing || state.composing) renderOrders();
    }, {
      onError: function (err) { toast('Could not read the locations: ' + err.code, true); },
    });

    db.watchToday(function (orders) {
      state.orders = orders;
      renderStats(order.metrics(orders, config.sla));
      renderNightSwitch();
      applyCosts();
      renderOrders();
    }, {
      onError: function (err) { toast('Lost the connection: ' + err.code, true); },
    });
  }

  boot().catch(function (err) {
    el.statgrid.innerHTML = '<div class="notice notice-bad">' + escapeHtml(err.message) + '</div>';
  });
})();
