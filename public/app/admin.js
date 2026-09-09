/**
 * Manager screen: service metrics, QR code generation for every table tag,
 * printable table tents, and a menu/cook-time reference for the chef.
 *
 * The QR codes are generated in the browser by /app/qr.js - no external
 * service ever sees the venue's URLs, and it works with the wifi unplugged.
 */
(function () {
  'use strict';

  var html = PP.html;
  var raw = PP.raw;

  var state = { boot: null, tags: null, base: '' };

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

  var toastTimer = null;
  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (bad ? ' is-bad' : '');
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  // -------------------------------------------------------------------- stats

  function renderStats(m) {
    var onTime = m.onTimePct;
    var cards = [
      { label: 'Orders today', value: m.counts.total, note: m.counts.delivered + ' delivered' },
      { label: 'Covers', value: m.covers, note: m.bowls + ' bowls' },
      { label: 'Open now', value: m.counts.queued + m.counts.cooking + m.counts.ready,
        note: m.counts.queued + ' queued / ' + m.counts.cooking + ' cooking / ' + m.counts.ready + ' ready' },
      { label: 'Avg wait to accept', value: PP.mmss(m.timings.avgQueueSec), note: 'target under ' + PP.mmss(state.boot.sla.acceptWarnSec) },
      { label: 'Avg cook time', value: PP.mmss(m.timings.avgCookSec), note: 'accept to food up' },
      { label: 'Avg runner time', value: PP.mmss(m.timings.avgRunnerSec), note: 'food up to table' },
      { label: 'Ticket time (p90)', value: PP.mmss(m.timings.p90TotalSec), note: 'avg ' + PP.mmss(m.timings.avgTotalSec) },
      { label: 'On time', value: onTime == null ? '--' : onTime + '%',
        note: 'within ' + state.boot.sla.cookLateFactor + 'x estimate',
        good: onTime != null && onTime >= 90, bad: onTime != null && onTime < 75 },
      { label: 'Revenue', value: PP.money(m.revenue), note: 'member charges' },
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

  function tagUrl(tag) {
    return state.base.replace(/\/+$/, '') + tag.path;
  }

  function renderQrs() {
    var versions = [];
    el.qrgrid.innerHTML = state.tags.tags.map(function (tag) {
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

    el.tents.innerHTML = state.tags.tags.map(function (tag) {
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
    el.qrMeta.textContent = state.tags.tags.length + ' codes \u00b7 QR version ' + maxVersion +
      ' \u00b7 error correction M (recovers ~15% damage)';
  }

  // ------------------------------------------------------------- menu reference

  function allergenCodes(item) {
    if (!item.allergens || !item.allergens.length) return '';
    return item.allergens.map(function (a) {
      var hit = state.boot.menu.allergens.filter(function (x) { return x.id === a; })[0];
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
            <td class="num">${i[secField] != null ? PP.mmss(i[secField]) : '-'}</td>
            <td class="num">${i.price ? PP.money(i.price) : '-'}</td>
            <td>${i.kid ? 'yes' : ''}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  function renderMenu() {
    var m = state.boot.menu;
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
    PP.remember('admin.base', state.base);
    renderQrs();
    toast('QR codes rebuilt for ' + state.base);
  });

  document.getElementById('printBtn').addEventListener('click', function () {
    window.print();
  });

  document.getElementById('seedBtn').addEventListener('click', async function () {
    try {
      await PP.api('/api/demo/seed', { method: 'POST', body: {} });
      await loadMetrics();
      toast('Demo chits added to the kitchen rail.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('resetBtn').addEventListener('click', async function () {
    try {
      await PP.api('/api/demo/reset', { method: 'POST', body: {} });
      await loadMetrics();
      toast('Today cleared.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function loadMetrics() {
    var res = await PP.api('/api/metrics');
    renderStats(res.metrics);
  }

  // ---------------------------------------------------------------------- boot

  async function boot() {
    document.getElementById('brandMark').innerHTML = Art.art('mark');

    state.boot = await PP.api('/api/bootstrap');
    state.tags = await PP.api('/api/tags');

    // Prefer a LAN address: a QR pointing at localhost is useless on a phone.
    var remembered = PP.recall('admin.base', '');
    state.base = remembered || state.tags.lanBase || state.tags.requestBase;
    el.baseUrl.value = state.base;

    var lan = state.tags.lanAddresses.map(function (a) { return a.address; }).join(', ');
    el.baseHint.textContent = lan
      ? 'Detected on this machine: ' + lan + '. Phones must be on the same wifi to reach it.'
      : 'No LAN address detected - a QR pointing at localhost only works on this computer.';

    renderQrs();
    renderMenu();
    await loadMetrics();

    // Keep the numbers current while the screen sits open on the office desk.
    PP.stream({ onEvent: function () { loadMetrics(); } });
    setInterval(loadMetrics, 30000);
  }

  boot().catch(function (err) {
    el.statgrid.innerHTML = '<div class="notice notice-bad">Cannot reach the server: ' +
      PP.escapeHtml(err.message) + '</div>';
  });
})();
