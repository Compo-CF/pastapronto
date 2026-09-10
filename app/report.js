/**
 * End-of-night close-out report.
 *
 * Separate from the manager screen on purpose: that one answers "how is
 * service going right now" and stays light, this one answers "how did the night
 * go and what do we prep tomorrow", reads any past service date, and is built
 * to be printed for the folder.
 *
 * All the arithmetic lives in order.shiftReport() so it is unit-tested; this
 * file only renders and exports.
 */
import { config, serviceDate } from './config.js';
import * as order from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import { html, raw, mmss, escapeHtml, toast, requireStaff } from './ui.js';

const el = {
  body: document.getElementById('reportBody'),
  datePick: document.getElementById('datePick'),
};

let current = { date: null, report: null, orders: [] };

// ------------------------------------------------------------------ helpers

/** Previous service date, honouring the 4am roll via the same helper. */
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ------------------------------------------------------------------ sections

function statTiles(r) {
  const tiles = [
    {
      label: 'Covers = charges', value: r.totals.covers,
      note: 'one AYCE charge per guest · ' + r.totals.members + ' member' + (r.totals.members === 1 ? '' : 's'),
    },
    {
      label: 'Items', value: r.totals.bowls,
      note: (r.byKind.pasta.items || 0) + ' bowls / ' + (r.byKind.pizza.items || 0) + ' pizzas',
    },
    {
      label: 'Items per cover', value: r.totals.bowlsPerCover,
      note: 'how much the room ate',
    },
    { label: 'Delivered', value: r.totals.delivered, note: r.totals.stillOpen + ' still open' },
    {
      label: 'On time', value: r.onTime.pct == null ? '--' : r.onTime.pct + '%',
      note: r.onTime.lateCount + ' late of ' + (r.onTime.count + r.onTime.lateCount),
      good: r.onTime.pct != null && r.onTime.pct >= 90,
      bad: r.onTime.pct != null && r.onTime.pct < 75,
    },
    { label: 'Avg ticket', value: mmss(r.timings.avgTotalSec), note: 'order to table' },
    { label: 'Ticket p90', value: mmss(r.timings.p90TotalSec), note: 'worst ' + mmss(r.timings.worstTotalSec) },
    { label: 'Avg cook', value: mmss(r.timings.avgCookSec), note: 'accept to food up' },
    { label: 'Avg to accept', value: mmss(r.timings.avgQueueSec), note: 'target under ' + mmss(config.sla.acceptWarnSec) },
  ];
  return html`<div class="statgrid">
    ${tiles.map((t) => html`<div class="stat ${t.good ? 'is-good' : ''} ${t.bad ? 'is-bad' : ''}">
      <div class="stat-label">${t.label}</div>
      <div class="stat-value">${t.value}</div>
      <div class="stat-note">${t.note}</div>
    </div>`)}
  </div>`;
}

/**
 * Service curve: bowls and pizzas per quarter-hour, stacked.
 *
 * Two series now, so a legend is always present and both are named in it -
 * identity is never carried by colour alone. Only the peak column gets a value
 * label rather than every bar. The pair (#d33f30 / #6b4b8a) was checked with
 * the palette validator against this light surface: CVD separation dE 16.4,
 * normal-vision 23.0, both well clear of the floor.
 *
 * The same numbers are available as a table underneath for anyone who cannot
 * use the chart.
 */
function serviceCurve(r) {
  if (!r.curve.length) return '';
  const max = Math.max(...r.curve.map((b) => b.items));
  const showLabel = (i) => r.curve.length <= 12 || i % Math.ceil(r.curve.length / 12) === 0;
  const pct = (n) => (n > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0);
  const anyPizza = r.curve.some((b) => b.pizzas > 0);

  return html`<section class="rpt-section">
    <h2 class="sec-title">Bowls and pizzas per 15 minutes</h2>
    <div class="card">
      <div class="curve-legend">
        <span class="curve-key"><i class="is-pasta"></i>Bowls</span>
        <span class="curve-key"><i class="is-pizza"></i>Pizzas</span>
      </div>

      <div class="curve" role="img"
        aria-label="${'Bowls and pizzas per quarter hour. Peak ' + r.peak.items + ' items at ' + r.peak.bucket + ', being ' + r.peak.bowls + ' bowls and ' + r.peak.pizzas + ' pizzas.'}">
        ${r.curve.map((b) => html`<div class="curve-col" tabindex="0" data-peak="${b === r.peak ? 'true' : 'false'}">
          ${raw(b === r.peak ? '<span class="curve-peak">' + b.items + '</span>' : '')}
          <span class="curve-tip">${b.bucket} &middot; ${b.bowls} bowls &middot; ${b.pizzas} pizzas &middot; ${b.orders} orders</span>
          <div class="curve-stack">
            ${raw(b.pizzas > 0 ? '<div class="curve-seg is-pizza" style="height:' + pct(b.pizzas) + '%"></div>' : '')}
            ${raw(b.bowls > 0 ? '<div class="curve-seg is-pasta" style="height:' + pct(b.bowls) + '%"></div>' : '')}
          </div>
        </div>`)}
      </div>
      <div class="curve-axis">
        ${r.curve.map((b, i) => html`<span>${showLabel(i) ? b.bucket : ''}</span>`)}
      </div>

      ${raw(anyPizza ? '' : '<p class="muted" style="margin:12px 0 0;font-size:14px">No pizzas on this service date.</p>')}

      <details style="margin-top:14px">
        <summary class="muted" style="cursor:pointer;font-size:14px">Show as a table</summary>
        <div class="mtable-wrap" style="margin-top:10px">
          <table class="rpt-table">
            <thead><tr>
              <th>Time</th><th class="num">Orders</th><th class="num">Bowls</th>
              <th class="num">Pizzas</th><th class="num">Total</th><th class="num">Covers</th>
            </tr></thead>
            <tbody>${r.curve.map((b) => html`<tr>
              <td>${b.bucket}</td><td class="num">${b.orders}</td>
              <td class="num">${b.bowls}</td><td class="num">${b.pizzas}</td>
              <td class="num">${b.items}</td><td class="num">${b.covers}</td>
            </tr>`)}</tbody>
          </table>
        </div>
      </details>
    </div>
  </section>`;
}

/**
 * What sold, split into the two prep lists. The pasta cook and the pizza cook
 * work from different boards, and a combined "Marinara x14" tells neither of
 * them how much to make.
 */
function menuMix(r) {
  const lanes = [
    ['Pasta station', 'pasta', [
      ['Pasta shapes', r.mix.pasta.pastas], ['Sauces', r.mix.pasta.sauces],
      ['Proteins', r.mix.pasta.proteins], ['Toppings', r.mix.pasta.toppings],
      ['Sides', r.mix.pasta.sides], ['Portions', r.mix.pasta.portions],
    ]],
    ['Pizza station', 'pizza', [
      ['Sauces', r.mix.pizza.sauces], ['Proteins', r.mix.pizza.proteins],
      ['Toppings', r.mix.pizza.toppings], ['Finishers', r.mix.pizza.finishers],
    ]],
  ];

  const rendered = lanes
    .map(([label, kind, groups]) => {
      const live = groups.filter(([, rows]) => rows.length);
      if (!live.length) return '';
      const k = r.byKind[kind] || { orders: 0, items: 0, covers: 0 };
      return html`<div class="rpt-lane">
        <h3 class="rpt-lane-head">
          ${label}
          <span class="rpt-lane-sub">${k.orders} orders &middot; ${k.items} ${kind === 'pizza' ? 'pizzas' : 'bowls'} &middot; ${k.covers} covers</span>
        </h3>
        <div class="mixgrid">
          ${live.map(([groupLabel, rows]) => {
            const max = Math.max(...rows.map((x) => x.count));
            return html`<div class="mixcard">
              <h3>${groupLabel}</h3>
              ${rows.map((x) => html`<div class="mixrow">
                <span>${x.name}</span><b>${x.count}</b>
                <span class="mixbar"><i style="width:${Math.round((x.count / max) * 100)}%"></i></span>
              </div>`)}
            </div>`;
          })}
        </div>
      </div>`;
    })
    .filter(Boolean);

  if (!rendered.length) return '';

  return html`<section class="rpt-section">
    <h2 class="sec-title">What sold - prep guide for tomorrow</h2>
    ${rendered}
    <p class="muted" style="font-size:14px;margin:12px 0 0">
      Sauce counts exceed item counts where something was mixed - a bowl or a
      pizza can carry up to ${config.order.maxSaucesPerBowl} sauces. Finishers
      go on after the bake, so they cost nothing on the oven clock.
    </p>
  </section>`;
}

/**
 * Who ate, and how much.
 *
 * The venue is all-you-can-eat - one price covers pasta and pizza - so the
 * billable unit is a person, not an order. A party that orders pasta and comes
 * back for pizza is still one charge, which is why "party" here is the largest
 * head count that member reported and not the sum of their orders. Orders and
 * items are consumption, useful for spotting a table that ran the kitchen hard.
 */
function memberList(r) {
  if (!r.members.length) return '';

  const maxItems = Math.max(...r.members.map((m) => m.items));

  return html`<section class="rpt-section">
    <h2 class="sec-title">Members and covers</h2>
    <div class="card mtable-wrap">
      <table class="rpt-table">
        <thead><tr>
          <th>Member</th><th>Name</th>
          <th class="num">Orders</th><th class="num">Charges</th>
          <th class="num">Bowls</th><th class="num">Pizzas</th>
          <th class="num">Items</th><th class="num">Per cover</th>
          <th>Ate</th>
        </tr></thead>
        <tbody>
          ${r.members.map((m) => html`<tr>
            <td class="mono">${m.memberNumber}</td>
            <td>${m.name || (m.status === 'unverified' ? '(unverified)' : '-')}</td>
            <td class="num">${m.orders}</td>
            <td class="num"><b>${m.partySize}</b></td>
            <td class="num">${m.bowls || ''}</td>
            <td class="num">${m.pizzas || ''}</td>
            <td class="num">${m.items}</td>
            <td class="num">${m.itemsPerCover}</td>
            <td>
              <span class="mixbar" style="display:block;width:70px">
                <i style="width:${Math.round((m.items / maxItems) * 100)}%"></i>
              </span>
            </td>
          </tr>`)}
        </tbody>
        <tfoot><tr>
          <th>${r.members.length} members</th><th></th>
          <th class="num">${r.totals.orders}</th>
          <th class="num">${r.totals.covers}</th>
          <th class="num">${r.byKind.pasta.items}</th>
          <th class="num">${r.byKind.pizza.items}</th>
          <th class="num">${r.totals.bowls}</th>
          <th class="num">${r.totals.bowlsPerCover}</th>
          <th></th>
        </tr></tfoot>
      </table>
    </div>
    <p class="muted" style="font-size:14px;margin:12px 0 0">
      <strong>Charges is the billing column.</strong> One price per person covers
      both pasta and pizza, so four guests at a table are four charges no matter
      how many bowls or pizzas they order. It is the largest head count that
      member reported, never the sum of their orders. ${r.totals.repeatOrders > 0
        ? 'Tonight ' + r.totals.repeatOrders + ' order' + (r.totals.repeatOrders === 1 ? ' was' : 's were') + ' a repeat trip by a member already counted.'
        : 'Nobody ordered twice tonight.'}
    </p>
  </section>`;
}

/** Tickets that blew the cook SLA, worst first. */
function lateTable(r) {
  if (!r.late.length) {
    return html`<section class="rpt-section">
      <h2 class="sec-title">Late tickets</h2>
      <div class="rpt-empty">Nothing ran late. Every delivered ticket finished inside
        ${config.sla.cookLateFactor}x its estimate.</div>
    </section>`;
  }
  return html`<section class="rpt-section">
    <h2 class="sec-title">Late tickets (${r.late.length})</h2>
    <div class="card mtable-wrap">
      <table class="rpt-table">
        <thead><tr>
          <th>Ticket</th><th>Where</th><th>Station</th>
          <th class="num">Bowls</th><th class="num">Estimate</th>
          <th class="num">Actual</th><th class="num">Over by</th>
        </tr></thead>
        <tbody>${r.late.map((x) => html`<tr class="is-late">
          <td>#${x.ticketNo}</td><td>${x.tagLabel}</td><td>${x.station}</td>
          <td class="num">${x.bowls}</td><td class="num">${mmss(x.estimateSec)}</td>
          <td class="num">${mmss(x.cookSec)}</td><td class="num">+${mmss(x.overSec)}</td>
        </tr>`)}</tbody>
      </table>
    </div>
  </section>`;
}

function stationsTable(r) {
  if (!r.stations.length) return '';
  return html`<section class="rpt-section">
    <h2 class="sec-title">By station</h2>
    <div class="card mtable-wrap">
      <table class="rpt-table">
        <thead><tr><th>Station</th><th class="num">Orders</th><th class="num">Bowls</th><th class="num">Avg cook</th></tr></thead>
        <tbody>${r.stations.map((s) => html`<tr>
          <td>${s.id}</td><td class="num">${s.orders}</td>
          <td class="num">${s.bowls}</td><td class="num">${mmss(s.avgCookSec)}</td>
        </tr>`)}</tbody>
      </table>
    </div>
  </section>`;
}

function exceptions(r) {
  const e = r.exceptions;
  const tickets = (list) => (list.length
    ? list.map((x) => '#' + x.ticketNo).join(', ')
    : 'none');

  const boxes = [
    { label: 'Voided / comped', value: e.voided.length, detail: tickets(e.voided) },
    { label: 'Left on hold', value: e.held.length, detail: tickets(e.held) },
    { label: 'Rushed', value: e.rushed.length, detail: tickets(e.rushed) },
    {
      label: 'Allergy orders', value: e.allergy.length,
      detail: e.allergy.length
        ? e.allergy.map((x) => '#' + x.ticketNo + ' (' + x.avoid.join(', ') + ')').join('; ')
        : 'none',
    },
    {
      label: 'Unverified members', value: e.unverifiedMembers.length,
      detail: e.unverifiedMembers.length
        ? e.unverifiedMembers.map((x) => '#' + x.ticketNo + ' / ' + x.memberNumber).join(', ')
        : 'none',
    },
  ];

  return html`<section class="rpt-section">
    <h2 class="sec-title">Exceptions to follow up</h2>
    <div class="exlist">
      ${boxes.map((b) => html`<div class="exbox">
        <div class="exbox-label">${b.label}</div>
        <div class="exbox-value">${b.value}</div>
        <div class="exbox-detail">${b.detail}</div>
      </div>`)}
    </div>
    <p class="muted" style="font-size:14px;margin:12px 0 0">
      Unverified members are numbers the directory did not recognise - the order
      was taken anyway so nobody went hungry, but the charge needs confirming.
    </p>
  </section>`;
}

// -------------------------------------------------------------------- render

function render() {
  const { date, report: r } = current;

  if (!r || r.totals.orders === 0) {
    el.body.innerHTML = html`
      <div class="rpt-head"><span class="rpt-date">${prettyDate(date)}</span></div>
      <div class="rpt-empty">No orders on this service date.</div>`;
    return;
  }

  el.body.innerHTML = [
    html`<div class="rpt-head">
      <span class="rpt-date">${prettyDate(date)}</span>
      <span class="rpt-gen">generated ${new Date(r.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
    </div>`,
    html`<p class="rpt-headline">
      <strong>${r.totals.covers} charges</strong> tonight - one per guest, all you can eat.
      ${r.totals.bowls} items came out of the kitchen
      (${r.byKind.pasta.items} bowls, ${r.byKind.pizza.items} pizzas) across
      ${r.totals.orders} order${r.totals.orders === 1 ? '' : 's'} from
      ${r.totals.members} member${r.totals.members === 1 ? '' : 's'}.
      How much they ordered does not change what they are charged.
    </p>`,
    statTiles(r),
    serviceCurve(r),
    memberList(r),
    menuMix(r),
    lateTable(r),
    stationsTable(r),
    exceptions(r),
  ].join('');
}

// ---------------------------------------------------------------- csv export

/**
 * One file with every section stacked, because a manager pastes this into a
 * spreadsheet rather than parsing it. Quoted properly so a note containing a
 * comma cannot shift the columns.
 */
function toCsv(r, date) {
  const q = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [];
  const push = (...cells) => rows.push(cells.map(q).join(','));

  push('PastaPresto close-out report');
  push('Service date', date);
  push('Generated', r.generatedAt);
  push('');

  push('TOTALS');
  push('Orders', r.totals.orders);
  push('Delivered', r.totals.delivered);
  push('Still open', r.totals.stillOpen);
  push('Voided', r.totals.voided);
  push('Covers (billable, AYCE)', r.totals.covers);
  push('Members', r.totals.members);
  push('Repeat orders', r.totals.repeatOrders);
  push('Bowls', r.totals.bowls);
  push('Bowls per cover', r.totals.bowlsPerCover);
  push('');

  push('TIMINGS (mm:ss)');
  push('Avg wait to accept', mmss(r.timings.avgQueueSec));
  push('Avg cook', mmss(r.timings.avgCookSec));
  push('Avg runner', mmss(r.timings.avgRunnerSec));
  push('Avg ticket', mmss(r.timings.avgTotalSec));
  push('Ticket p90', mmss(r.timings.p90TotalSec));
  push('Worst ticket', mmss(r.timings.worstTotalSec));
  push('On time %', r.onTime.pct == null ? '' : r.onTime.pct);
  push('');

  push('MEMBERS AND COVERS');
  push('Member', 'Name', 'Status', 'Orders', 'Covers', 'Bowls', 'Pizzas', 'Items', 'Per cover', 'First', 'Last');
  r.members.forEach((m) => push(m.memberNumber, m.name, m.status, m.orders, m.partySize,
    m.bowls, m.pizzas, m.items, m.itemsPerCover, m.firstAt, m.lastAt));
  push('');

  push('SERVICE CURVE');
  push('Time', 'Orders', 'Bowls', 'Pizzas', 'Total items', 'Covers');
  r.curve.forEach((b) => push(b.bucket, b.orders, b.bowls, b.pizzas, b.items, b.covers));
  push('');

  push('MENU MIX');
  push('Station', 'Group', 'Item', 'Count');
  Object.entries(r.mix).forEach(([kind, groups]) => {
    Object.entries(groups).forEach(([group, list]) => {
      list.forEach((x) => push(kind, group, x.name, x.count));
    });
  });
  push('');

  push('BY KIND');
  push('Kind', 'Orders', 'Items', 'Covers');
  Object.entries(r.byKind).forEach(([kind, k]) => push(kind, k.orders, k.items, k.covers));
  push('');

  push('LATE TICKETS');
  push('Ticket', 'Where', 'Station', 'Bowls', 'Estimate', 'Actual', 'Over by');
  r.late.forEach((x) => push('#' + x.ticketNo, x.tagLabel, x.station, x.bowls,
    mmss(x.estimateSec), mmss(x.cookSec), mmss(x.overSec)));
  push('');

  push('BY STATION');
  push('Station', 'Orders', 'Bowls', 'Avg cook');
  r.stations.forEach((s) => push(s.id, s.orders, s.bowls, mmss(s.avgCookSec)));
  push('');

  push('EXCEPTIONS');
  push('Kind', 'Tickets');
  push('Voided', r.exceptions.voided.map((x) => '#' + x.ticketNo).join(' '));
  push('Held', r.exceptions.held.map((x) => '#' + x.ticketNo).join(' '));
  push('Rushed', r.exceptions.rushed.map((x) => '#' + x.ticketNo).join(' '));
  push('Allergy', r.exceptions.allergy.map((x) => '#' + x.ticketNo + '(' + x.avoid.join('/') + ')').join(' '));
  push('Unverified members', r.exceptions.unverifiedMembers.map((x) => '#' + x.ticketNo + '/' + x.memberNumber).join(' '));

  return rows.join('\n');
}

function downloadCsv() {
  if (!current.report || !current.report.totals.orders) {
    toast('Nothing to export for this date.', true);
    return;
  }
  const csv = toCsv(current.report, current.date);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pastapresto-' + current.date + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------------------------------------------- data load

async function load(date) {
  current.date = date;
  el.datePick.value = date;
  el.body.innerHTML = '<div class="rpt-empty">Reading ' + escapeHtml(prettyDate(date)) + '&hellip;</div>';
  try {
    const orders = await db.getDay(date);
    current.orders = orders;
    current.report = order.shiftReport(orders, config.sla);
    render();
  } catch (err) {
    el.body.innerHTML = '<div class="notice notice-bad">Could not read that date: ' + escapeHtml(err.message) + '</div>';
  }
}

// -------------------------------------------------------------------- events

el.datePick.addEventListener('change', () => load(el.datePick.value));
document.getElementById('tonightBtn').addEventListener('click', () => load(serviceDate()));
document.getElementById('yesterdayBtn').addEventListener('click', () => load(shiftDate(serviceDate(), -1)));
document.getElementById('csvBtn').addEventListener('click', downloadCsv);
document.getElementById('printBtn').addEventListener('click', () => window.print());

// ---------------------------------------------------------------------- boot

async function boot() {
  document.getElementById('brandMark').innerHTML = art('mark');

  if (!db.isConfigured) {
    throw new Error('Firebase is not configured yet - see app/firebase-config.js.');
  }
  if (!(await requireStaff())) {
    throw new Error('Staff passcode required.');
  }

  el.datePick.max = serviceDate();
  await db.ready();
  await load(serviceDate());
}

boot().catch((err) => {
  el.body.innerHTML = '<div class="notice notice-bad">' + escapeHtml(err.message) + '</div>';
});
