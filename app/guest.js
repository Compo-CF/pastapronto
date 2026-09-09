/**
 * Guest ordering app.
 *
 * One state object, one render pass, delegated events. No framework, no build.
 *
 * Two modes share every screen:
 *   simple - the default a child gets: short tile sets, 4 taps per bowl,
 *            no typing beyond the member number
 *   pro    - reveals allergen filters, spice, per-bowl notes, cook times and
 *            a compact review, for adults and staff taking an order
 */
import { config, tagById, isOpen } from './config.js';
import { catalog as menuCatalog, priceFor as menuPriceFor } from './menu.js';
import * as cooktime from './cooktime.js';
import * as order from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import {
  html, raw, money, humanMins, escapeHtml,
  remember, recall, chime, unlockAudio, toast, now,
} from './ui.js';

(function () {
  'use strict';

  var BUILD_STEPS = [
    { id: 'pasta', label: 'Pasta', group: 'pastas', title: 'Pick your pasta', sub: 'Tap the shape you want.' },
    { id: 'sauce', label: 'Sauce', group: 'sauces', title: 'Now the sauce', sub: 'One sauce per bowl.' },
    { id: 'protein', label: 'Protein', group: 'proteins', title: 'Add a protein?', sub: 'Or skip it - totally fine.' },
    { id: 'toppings', label: 'Toppings', group: 'toppings', title: 'Toppings!', sub: '' },
    { id: 'finish', label: 'Size', group: 'portions', title: 'How big?', sub: '' },
  ];

  var TRACK = [
    { status: 'queued', label: 'Sent' },
    { status: 'cooking', label: 'Cooking' },
    { status: 'ready', label: 'Ready' },
    { status: 'delivered', label: 'Enjoy' },
  ];

  var state = {
    screen: 'welcome',
    mode: recall('mode', 'simple'),
    boot: null,
    tag: null,
    memberDigits: '',
    member: null,
    guestCount: 2,
    bowls: [],
    activeBowl: 0,
    buildStep: 0,
    showAll: false,
    avoid: [],
    orderNotes: '',
    order: null,
    busy: false,
    stopStream: null,
  };

  var stage = document.getElementById('stage');
  var footbar = document.getElementById('footbar');
  var footbarInner = document.getElementById('footbarInner');
  var crumbs = document.getElementById('crumbs');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  // ------------------------------------------------------------------- helpers

  function menu(group) {
    return (state.boot && state.boot.menu[group]) || [];
  }

  function item(group, id) {
    return menu(group).filter(function (x) { return x.id === id; })[0] || null;
  }

  function newBowl(index) {
    return {
      guestLabel: 'Guest ' + (index + 1),
      pasta: null, sauce: null, protein: 'none',
      toppings: [], sides: [], portion: null,
      spice: 'mild', notes: '',
    };
  }

  function currentBowl() {
    return state.bowls[state.activeBowl];
  }

  function bowlComplete(bowl) {
    return Boolean(bowl && bowl.pasta && bowl.sauce && bowl.portion);
  }

  function allBowlsComplete() {
    return state.bowls.length > 0 && state.bowls.every(bowlComplete);
  }

  /** Items to show for a group, honouring simple mode and the "more" toggle. */
  function choicesFor(group) {
    var all = menu(group);
    if (state.mode === 'pro' || state.showAll) return all;
    var kid = all.filter(function (x) { return x.kid; });
    return kid.length >= 3 ? kid : all;
  }

  function hasHiddenChoices(group) {
    return state.mode === 'simple' && !state.showAll && choicesFor(group).length < menu(group).length;
  }

  /** Allergens the guest asked us to avoid that this item contains. */
  function conflicts(entry) {
    if (!entry || !entry.allergens) return [];
    return entry.allergens.filter(function (a) { return state.avoid.indexOf(a) !== -1; });
  }

  function allergenName(id) {
    var hit = (state.boot.menu.allergens || []).filter(function (a) { return a.id === id; })[0];
    return hit ? hit.name : id;
  }

  function toast(message, bad) {
    toastEl.textContent = message;
    toastEl.className = 'toast' + (bad ? ' is-bad' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3600);
  }

  // -------------------------------------------------------------- tile builder

  /**
   * One choice tile. Multi-select tiles get aria-pressed and a green check;
   * single-select get red. Items clashing with an avoided allergen are
   * disabled with the reason printed on the tile - never silently hidden.
   */
  function tile(entry, opts) {
    var clash = conflicts(entry);
    var blocked = clash.length > 0;
    var meta = [];
    if (state.mode === 'pro') {
      if (entry.price) meta.push('+' + money(entry.price).replace('$', '$'));
      if (entry.boilSec) meta.push(Math.round(entry.boilSec / 60) + ' min');
      if (entry.glutenFree) meta.push('GF');
      if (entry.spicy) meta.push('spicy');
    } else if (entry.price) {
      meta.push('+' + money(entry.price));
    }

    return html`<button class="tile ${opts.multi ? 'is-multi' : ''} ${blocked ? 'is-blocked' : ''}"
      type="button"
      data-act="${opts.act}" data-group="${opts.group}" data-id="${entry.id}"
      aria-pressed="${opts.selected ? 'true' : 'false'}"
      ${raw(blocked ? 'disabled aria-describedby="clash-' + entry.id + '"' : '')}>
      <span class="tile-art">${raw(art(entry.shape || entry.icon || 'none'))}</span>
      <span class="tile-label">${entry.name}</span>
      ${raw(meta.length && !blocked ? '<span class="tile-meta">' + escapeHtml(meta.join(' \u00b7 ')) + '</span>' : '')}
      ${raw(blocked ? '<span class="tile-warn" id="clash-' + entry.id + '">has ' + escapeHtml(clash.map(allergenName).join(', ')) + '</span>' : '')}
    </button>`;
  }

  function tileGrid(group, opts) {
    var entries = choicesFor(group);
    var markup = entries.map(function (entry) {
      var selected = opts.multi
        ? opts.value.indexOf(entry.id) !== -1
        : opts.value === entry.id;
      return tile(entry, {
        act: opts.act, group: group, multi: opts.multi, selected: selected,
      });
    });
    var more = hasHiddenChoices(group)
      ? html`<div class="moretoggle"><button class="btn btn-ghost" type="button" data-act="showAll">
          Show all ${menu(group).length} choices</button></div>`
      : '';
    return html`<div class="tiles ${opts.small ? 'tiles-sm' : ''}">${markup}</div>${raw(more)}`;
  }

  // --------------------------------------------------------------- screens

  function screenWelcome() {
    var tag = state.boot.tag;
    var where = tag
      ? html`<div class="wherecard">${raw(art('runner', { size: 26 }))} You are at <strong>&nbsp;${tag.label}</strong></div>`
      : html`<div class="wherecard is-unknown">Scan the QR code at your table to start</div>`;

    return html`
      <div class="hero">
        <div class="hero-art">${raw(art('bowl'))}</div>
        <h1>Build your <em>bowl</em></h1>
        <p>Pick a pasta, pick a sauce, pile on toppings. We cook it fresh and bring it over.</p>
        ${raw(where)}
        <ul class="howto">
          <li><span class="n">1</span> Enter your ${state.boot.venue.memberLabel.toLowerCase()}</li>
          <li><span class="n">2</span> Tell us how many are eating</li>
          <li><span class="n">3</span> Build a bowl for each person</li>
          <li><span class="n">4</span> Send it to the kitchen</li>
        </ul>
      </div>`;
  }

  function screenMember() {
    var digits = state.memberDigits;
    var boxes = [];
    for (var i = 0; i < 6; i += 1) {
      boxes.push(html`<span class="${digits[i] ? 'is-filled' : ''}">${digits[i] || ''}</span>`);
    }
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

    return html`
      <div class="step-head">
        <p class="step-kicker">Step 1 of 4</p>
        <h1 class="step-title">What is your ${state.boot.venue.memberLabel.toLowerCase()}?</h1>
        <p class="step-sub">4 to 6 digits. It is on your card - a grown-up can help.</p>
      </div>
      <div class="stack">
        <div class="memberview" aria-label="Member number entry">${boxes}</div>
        ${raw(state.member ? renderMemberResult() : '')}
        <div class="keypad">
          ${keys.map(function (k) {
            var label = k === 'clear' ? 'Clear' : k === 'back' ? '&#9003;' : k;
            return html`<button type="button" data-act="key" data-key="${k}" aria-label="${k === 'back' ? 'Delete' : k}">${raw(label)}</button>`;
          })}
        </div>
      </div>`;
  }

  function renderMemberResult() {
    var m = state.member;
    if (m.status === 'verified') {
      return html`<div class="notice notice-ok">${m.message}</div>`;
    }
    if (m.status === 'unverified') {
      return html`<div class="notice notice-warn">We do not recognise ${m.memberNumber} yet - you can keep going and your server will confirm it.</div>`;
    }
    return html`<div class="notice notice-bad">${m.message}</div>`;
  }

  function screenGuests() {
    var counts = [];
    for (var n = 1; n <= state.boot.limits.maxGuests; n += 1) {
      counts.push(html`<button class="tile" type="button" data-act="guests" data-id="${n}"
        aria-pressed="${state.guestCount === n ? 'true' : 'false'}">
        <span class="tile-art">${raw(peopleGlyph(n))}</span>
        <span class="tile-label">${n}</span>
        <span class="tile-meta">${n === 1 ? 'just me' : 'people'}</span>
      </button>`);
    }

    var allergenPanel = state.mode === 'pro' || state.avoid.length > 0
      ? html`<div class="card stack">
          <div>
            <strong>Anything to avoid?</strong>
            <p class="muted" style="margin:4px 0 0">We will grey out anything that contains it.</p>
          </div>
          <div class="chips">
            ${state.boot.menu.allergens.map(function (a) {
              return html`<button class="chip" type="button" data-act="avoid" data-id="${a.id}"
                aria-pressed="${state.avoid.indexOf(a.id) !== -1 ? 'true' : 'false'}">${a.name}</button>`;
            })}
          </div>
        </div>`
      : html`<button class="btn btn-ghost" type="button" data-act="mode" data-id="pro">
          Someone has a food allergy?</button>`;

    return html`
      <div class="step-head">
        <p class="step-kicker">Step 2 of 4</p>
        <h1 class="step-title">How many are eating?</h1>
        <p class="step-sub">We will build one bowl per person. You can change it later.</p>
      </div>
      <div class="stack">
        <div class="tiles tiles-sm">${counts}</div>
        ${raw(allergenPanel)}
      </div>`;
  }

  /**
   * Stacked-people glyph for the guest-count tiles. Draws at most four figures
   * in a tidy 2-up grid and counts the rest as "+N", so 8 guests still reads
   * cleanly instead of turning into a smear of overlapping heads.
   */
  function peopleGlyph(n) {
    var shown = Math.min(n, 4);
    var cols = shown <= 2 ? shown : 2;
    var rows = Math.ceil(shown / 2);
    var body = '';
    for (var i = 0; i < shown; i += 1) {
      var col = i % cols;
      var row = Math.floor(i / cols);
      // Lift the grid when a "+N" caption needs room underneath.
      var centreY = n > shown ? 22 : 27;
      var x = 32 + (col - (cols - 1) / 2) * 22;
      var y = centreY + (row - (rows - 1) / 2) * 21;
      body += '<circle cx="' + x + '" cy="' + y + '" r="6.5" fill="#d33f30"/>' +
        '<path d="M' + (x - 8.5) + ' ' + (y + 17) + 'a8.5 10.5 0 0 1 17 0z" fill="#d33f30"/>';
    }
    if (n > shown) {
      body += '<text x="32" y="63" text-anchor="middle" font-size="14" font-weight="700" ' +
        'font-family="ui-sans-serif, system-ui, sans-serif" fill="#6b6058">+' + (n - shown) + '</text>';
    }
    return '<svg viewBox="0 0 64 64" aria-hidden="true">' + body + '</svg>';
  }

  function screenBuild() {
    var bowl = currentBowl();
    var step = BUILD_STEPS[state.buildStep];

    var tabs = state.bowls.map(function (b, i) {
      return html`<button class="bowltab ${bowlComplete(b) ? 'is-done' : ''}" type="button"
        data-act="gotoBowl" data-id="${i}" aria-current="${i === state.activeBowl ? 'true' : 'false'}">
        ${b.guestLabel}
        <small>${bowlComplete(b) ? 'ready' : 'building'}</small>
      </button>`;
    });

    var steps = BUILD_STEPS.map(function (s, i) {
      var done = i < state.buildStep;
      return html`<button class="buildstep ${done ? 'is-done' : ''}" type="button"
        data-act="gotoStep" data-id="${i}" aria-current="${i === state.buildStep ? 'true' : 'false'}">${s.label}</button>`;
    });

    var body;
    if (step.id === 'toppings') body = buildToppings(bowl);
    else if (step.id === 'finish') body = buildFinish(bowl);
    else {
      body = tileGrid(step.group, {
        act: 'pick', value: bowl[step.id], multi: false,
      });
    }

    var sub = step.sub;
    if (step.id === 'toppings') sub = 'Pick up to ' + state.boot.limits.maxToppingsPerBowl + '. Or none at all.';

    return html`
      <div class="bowltabs">${tabs}</div>
      <div class="step-head">
        <p class="step-kicker">Bowl ${state.activeBowl + 1} of ${state.bowls.length} &middot; ${bowl.guestLabel}</p>
        <h1 class="step-title">${step.title}</h1>
        <p class="step-sub">${sub}</p>
      </div>
      <div class="buildsteps">${steps}</div>
      ${raw(body)}`;
  }

  function buildToppings(bowl) {
    var limit = state.boot.limits.maxToppingsPerBowl;
    var grid = tileGrid('toppings', { act: 'toggleTopping', value: bowl.toppings, multi: true, small: true });
    var sides = state.mode === 'pro' || bowl.sides.length > 0
      ? html`<div class="stack" style="margin-top:22px">
          <strong>Add a side?</strong>
          ${raw(tileGrid('sides', { act: 'toggleSide', value: bowl.sides, multi: true, small: true }))}
        </div>`
      : '';
    return html`${raw(grid)}
      <p class="muted" style="margin-top:12px">${bowl.toppings.length} of ${limit} chosen</p>
      ${raw(sides)}`;
  }

  function buildFinish(bowl) {
    var portions = tileGrid('portions', { act: 'pick', value: bowl.portion, multi: false });
    var extras = state.mode === 'pro'
      ? html`<div class="card stack" style="margin-top:22px">
          <div class="field">
            <label for="whoName">Who is this bowl for?</label>
            <input class="input" id="whoName" type="text" maxlength="24" value="${bowl.guestLabel}"
              data-act="setName" placeholder="Name or seat">
          </div>
          <div class="field">
            <label>Spice level</label>
            <div class="chips">
              ${state.boot.menu.spice.map(function (s) {
                return html`<button class="chip" type="button" data-act="setSpice" data-id="${s.id}"
                  aria-pressed="${bowl.spice === s.id ? 'true' : 'false'}">${s.name}</button>`;
              })}
            </div>
          </div>
          <div class="field">
            <label for="bowlNotes">Notes for the kitchen</label>
            <textarea class="textarea" id="bowlNotes" maxlength="140" data-act="setNotes"
              placeholder="Sauce on the side, no onions, allergy details...">${bowl.notes}</textarea>
          </div>
        </div>`
      : html`<div class="chips" style="margin-top:18px">
          <button class="chip" type="button" data-act="mode" data-id="pro">Add a note or spice level</button>
        </div>`;
    return html`${raw(portions)}${raw(extras)}`;
  }

  var estimate = { queueDepth: 0, cookEstimateSec: 0, promiseSec: 0, subtotal: 0 };

  function screenReview() {
    var bowls = state.bowls.map(function (bowl, i) {
      var pasta = item('pastas', bowl.pasta);
      var extras = [];
      if (bowl.toppings.length) {
        extras.push('with ' + bowl.toppings.map(function (t) { return item('toppings', t).name; }).join(', '));
      }
      if (bowl.sides.length) {
        extras.push('side of ' + bowl.sides.map(function (s) { return item('sides', s).name; }).join(', '));
      }
      if (bowl.spice !== 'mild') {
        var spice = item('spice', bowl.spice);
        if (spice) extras.push(spice.name + ' spice');
      }
      var portion = item('portions', bowl.portion);
      if (portion) extras.push(portion.name);
      if (bowl.notes) extras.push('Note: ' + bowl.notes);

      return html`<div class="bowl">
        <span class="bowl-art">${raw(art(pasta ? pasta.shape : 'none'))}</span>
        <div class="grow">
          <div class="bowl-who">${bowl.guestLabel}</div>
          <div class="bowl-dish">${dishText(bowl)}</div>
          <div class="bowl-extras">${extras.filter(Boolean).join(' \u00b7 ')}</div>
        </div>
        <div style="text-align:right">
          <div class="bowl-price">${money(bowlPrice(bowl))}</div>
          <button class="btn btn-ghost" style="min-height:40px;padding:0 14px;font-size:14px;margin-top:8px"
            type="button" data-act="editBowl" data-id="${i}">Change</button>
        </div>
      </div>`;
    });

    var allergens = [];
    state.bowls.forEach(function (b) {
      [item('pastas', b.pasta), item('sauces', b.sauce), item('proteins', b.protein)]
        .concat(b.toppings.map(function (t) { return item('toppings', t); }))
        .concat(b.sides.map(function (s) { return item('sides', s); }))
        .forEach(function (entry) {
          (entry && entry.allergens ? entry.allergens : []).forEach(function (a) {
            if (allergens.indexOf(a) === -1) allergens.push(a);
          });
        });
    });

    var allergenRow = allergens.length
      ? html`<div class="notice ${state.avoid.length ? 'notice-warn' : ''}" style="${state.avoid.length ? '' : 'background:#f4ece0;color:#6b6058'}">
          This order contains: ${allergens.map(allergenName).join(', ')}
        </div>`
      : '';

    var notesField = state.mode === 'pro'
      ? html`<div class="field">
          <label for="orderNotes">Anything else for the kitchen?</label>
          <textarea class="textarea" id="orderNotes" maxlength="240" data-act="setOrderNotes"
            placeholder="Celebrating a birthday, seat numbers, timing...">${state.orderNotes}</textarea>
        </div>`
      : '';

    return html`
      <div class="step-head">
        <p class="step-kicker">Step 4 of 4</p>
        <h1 class="step-title">Look good?</h1>
        <p class="step-sub">Check it over, then send it to the cook.</p>
      </div>
      <div class="stack">
        ${bowls}
        ${raw(allergenRow)}
        <div class="card stack">
          <div class="summary-line"><span>Bowls</span><span>${state.bowls.length}</span></div>
          <div class="summary-line"><span>Guests</span><span>${state.guestCount}</span></div>
          <div class="summary-line"><span>Where</span><span>${state.boot.tag ? state.boot.tag.label : 'Takeout'}</span></div>
          <div class="summary-line"><span>Cook time</span><span>${humanMins(estimate.cookEstimateSec)}</span></div>
          <div class="summary-total"><span>Total</span><span>${money(estimate.subtotal)}</span></div>
          <p class="muted" style="margin:0;font-size:14px">Charged to ${state.boot.venue.memberLabel.toLowerCase()} ${state.memberDigits}</p>
        </div>
        ${raw(notesField)}
      </div>`;
  }

  function dishText(bowl) {
    var pasta = item('pastas', bowl.pasta);
    var sauce = item('sauces', bowl.sauce);
    var protein = item('proteins', bowl.protein);
    var parts = [];
    if (pasta) parts.push(pasta.name);
    if (sauce) parts.push('w/ ' + sauce.name);
    if (protein && protein.id !== 'none') parts.push('+ ' + protein.name);
    return parts.join(' ');
  }

  function bowlPrice(bowl) {
    var total = 0;
    var portion = item('portions', bowl.portion);
    if (portion) total += portion.price;
    var protein = item('proteins', bowl.protein);
    if (protein) total += protein.price;
    bowl.toppings.forEach(function (t) { var x = item('toppings', t); if (x) total += x.price; });
    bowl.sides.forEach(function (s) { var x = item('sides', s); if (x) total += x.price; });
    return total;
  }

  /**
   * Price and time the order. This used to be a server round trip; the model
   * lives in cooktime.js so it now runs on the device, and the only thing we
   * still need from Firestore is how deep the queue is right now.
   */
  async function refreshEstimate() {
    var depth = 0;
    try {
      var day = await db.getDay();
      depth = day.filter(function (o) {
        return o.status === 'queued' || o.status === 'cooking';
      }).length;
    } catch (err) {
      // Offline: quote the cook time alone rather than blocking the review.
    }
    estimate = {
      queueDepth: depth,
      cookEstimateSec: cooktime.orderCookSec(state.bowls),
      promiseSec: cooktime.promiseSec(state.bowls, depth),
      subtotal: state.bowls.reduce(function (a, b) { return a + menuPriceFor(b); }, 0),
    };
  }

  function screenSent() {
    var order = state.order;
    var stepIndex = TRACK.findIndex(function (t) { return t.status === order.status; });
    if (stepIndex < 0) stepIndex = 0;

    var segs = TRACK.map(function (t, i) {
      var cls = i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : '';
      return html`<div class="track-seg ${cls}"></div>`;
    });
    var labels = TRACK.map(function (t, i) {
      return html`<span class="${i === stepIndex ? 'is-now' : ''}">${t.label}</span>`;
    });

    var headline, note;
    if (order.status === 'queued') {
      headline = 'Sent to the kitchen!';
      note = 'A cook will pick it up in a moment.';
    } else if (order.status === 'cooking') {
      headline = 'Your pasta is cooking';
      note = 'Water is boiling. Hang tight.';
    } else if (order.status === 'ready') {
      headline = 'Ready!';
      note = 'A runner is bringing it to ' + order.tagLabel + '.';
    } else if (order.status === 'delivered') {
      headline = 'Buon appetito!';
      note = 'Enjoy. Tap below to order another round.';
    } else {
      headline = 'We are on it';
      note = '';
    }

    var eta = '';
    if (order.status === 'queued' || order.status === 'cooking') {
      var remaining = Math.max(0, (new Date(order.promisedReadyAt).getTime() - now()) / 1000);
      eta = html`<p class="eta">Ready in <strong>${humanMins(remaining)}</strong></p>`;
    }

    var readyBanner = order.status === 'ready'
      ? html`<div class="ready-banner">Ticket #${order.ticketNo} is up!</div>`
      : '';

    var bowls = order.lines.map(function (line) {
      return html`<div class="sentbowl">
        ${raw(art('bowl'))}
        <div class="grow">
          <strong>${line.guestLabel}</strong>
          <div class="muted">${line.dish}</div>
        </div>
      </div>`;
    });

    return html`
      <div class="sentwrap stack">
        ${raw(order.status === 'cooking' ? '<div class="pot">' + art('pot') + '</div>' : '')}
        ${raw(readyBanner)}
        <div class="ticket">
          <div class="ticket-label">Ticket</div>
          <div class="ticket-no">#${order.ticketNo}</div>
          <div class="ticket-label" style="margin-top:10px">Show this code if a server asks</div>
          <div class="ticket-code">${order.claimCode}</div>
          <div class="track">${segs}</div>
          <div class="track-labels">${labels}</div>
        </div>
        <div>
          <p class="statusline">${headline}</p>
          <p class="statusnote">${note}</p>
          ${raw(eta)}
        </div>
        <div class="sentbowls">${bowls}</div>
        <div class="card">
          <div class="summary-line"><span>Table</span><span>${order.tagLabel}</span></div>
          <div class="summary-line"><span>Guests</span><span>${order.guestCount}</span></div>
          <div class="summary-total"><span>Total</span><span>${money(order.totalPrice)}</span></div>
        </div>
      </div>`;
  }

  // -------------------------------------------------------------------- footbar

  function renderFootbar() {
    var s = state.screen;
    var parts = '';

    if (s === 'welcome') {
      parts = html`<button class="btn btn-primary btn-lg btn-block" type="button" data-act="go" data-id="member">
        Start my order</button>`;
    } else if (s === 'member') {
      var ready = state.memberDigits.length >= 4;
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="welcome">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="submitMember"
          ${raw(ready && !state.busy ? '' : 'disabled')}>${state.busy ? 'Checking...' : 'Next'}</button>`;
    } else if (s === 'guests') {
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="member">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="startBuilding">
          Build ${state.guestCount} bowl${state.guestCount === 1 ? '' : 's'}</button>`;
    } else if (s === 'build') {
      var bowl = currentBowl();
      var step = BUILD_STEPS[state.buildStep];
      var chosen = step.id === 'toppings' ? true : step.id === 'finish' ? Boolean(bowl.portion) : Boolean(bowl[step.id]);
      var lastStep = state.buildStep === BUILD_STEPS.length - 1;
      var lastBowl = state.activeBowl === state.bowls.length - 1;
      var label = !lastStep ? 'Next' : lastBowl ? 'Review order' : 'Next bowl';
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="buildBack">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="buildNext"
          ${raw(chosen ? '' : 'disabled')}>${label}</button>`;
    } else if (s === 'review') {
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="editBowl" data-id="0">Change</button>
        <button class="btn btn-go btn-lg grow" type="button" data-act="send"
          ${raw(state.busy || !allBowlsComplete() ? 'disabled' : '')}>
          ${state.busy ? 'Sending...' : 'Send to the kitchen'}</button>`;
    } else if (s === 'sent') {
      parts = html`<button class="btn btn-ghost btn-block" type="button" data-act="restart">
        Start another order</button>`;
    }

    footbarInner.innerHTML = parts;
    footbar.hidden = !parts;
  }

  function renderCrumbs() {
    var order = ['member', 'guests', 'build', 'review'];
    var idx = order.indexOf(state.screen);
    crumbs.innerHTML = order.map(function (name, i) {
      var cls = idx < 0 ? '' : i < idx ? 'is-done' : i === idx ? 'is-now' : '';
      return '<span class="dot ' + cls + '"></span>';
    }).join('');
    crumbs.hidden = idx < 0;
  }

  // --------------------------------------------------------------------- render

  var SCREENS = {
    welcome: screenWelcome,
    member: screenMember,
    guests: screenGuests,
    build: screenBuild,
    review: screenReview,
    sent: screenSent,
  };

  function render(opts) {
    opts = opts || {};
    stage.innerHTML = SCREENS[state.screen]();
    renderFootbar();
    renderCrumbs();
    document.getElementById('modeSwitch').setAttribute('aria-pressed', state.mode === 'pro' ? 'true' : 'false');
    document.getElementById('modeLabel').textContent = state.mode === 'pro' ? 'Detailed' : 'Simple';
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }

  var GROUP_FIELD = { pastas: 'pasta', sauces: 'sauce', proteins: 'protein', portions: 'portion' };

  /** Move forward through steps, then bowls, then to review. */
  function advance() {
    if (state.buildStep < BUILD_STEPS.length - 1) {
      state.buildStep += 1;
      state.showAll = false;
      return render();
    }
    if (state.activeBowl < state.bowls.length - 1) {
      state.activeBowl += 1;
      state.buildStep = 0;
      state.showAll = false;
      return render();
    }
    state.screen = 'review';
    render();
    return refreshEstimate().then(function () {
      if (state.screen === 'review') render({ keepScroll: true });
    });
  }

  // --------------------------------------------------------------------- actions

  var actions = {
    go: function (el) {
      state.screen = el.dataset.id;
      state.showAll = false;
      render();
    },

    mode: function (el) {
      state.mode = el.dataset.id;
      remember('mode', state.mode);
      render({ keepScroll: true });
    },

    showAll: function () {
      state.showAll = true;
      render({ keepScroll: true });
    },

    key: function (el) {
      var k = el.dataset.key;
      if (k === 'clear') state.memberDigits = '';
      else if (k === 'back') state.memberDigits = state.memberDigits.slice(0, -1);
      else if (state.memberDigits.length < 6) state.memberDigits += k;
      state.member = null;
      render({ keepScroll: true });
    },

    submitMember: async function () {
      state.busy = true;
      render({ keepScroll: true });
      try {
        var res = await db.lookupMember(state.memberDigits);
        state.member = res;
        if (res.status === 'verified' && res.defaultGuests) state.guestCount = res.defaultGuests;
        state.busy = false;
        if (res.status === 'invalid') return render({ keepScroll: true });
        state.screen = 'guests';
        return render();
      } catch (err) {
        state.busy = false;
        state.member = { status: 'invalid', message: err.message, memberNumber: state.memberDigits };
        return render({ keepScroll: true });
      }
    },

    guests: function (el) {
      state.guestCount = Number(el.dataset.id);
      render({ keepScroll: true });
    },

    avoid: function (el) {
      var id = el.dataset.id;
      var i = state.avoid.indexOf(id);
      if (i === -1) state.avoid.push(id);
      else state.avoid.splice(i, 1);
      render({ keepScroll: true });
    },

    startBuilding: function () {
      // Keep bowls already built if the guest changes the head count.
      var next = [];
      for (var i = 0; i < state.guestCount; i += 1) next.push(state.bowls[i] || newBowl(i));
      state.bowls = next;
      state.activeBowl = 0;
      state.buildStep = 0;
      state.screen = 'build';
      state.showAll = false;
      render();
    },

    pick: function (el) {
      var field = GROUP_FIELD[el.dataset.group];
      if (!field) return;
      currentBowl()[field] = el.dataset.id;
      state.showAll = false;
      // Tapping a choice moves you on - fewer buttons for a child to hunt for.
      advance();
    },

    toggleTopping: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.toppings.indexOf(id);
      if (i !== -1) bowl.toppings.splice(i, 1);
      else if (bowl.toppings.length >= state.boot.limits.maxToppingsPerBowl) {
        toast('That is ' + state.boot.limits.maxToppingsPerBowl + ' toppings - plenty! Tap one to swap it.');
        return;
      } else bowl.toppings.push(id);
      render({ keepScroll: true });
    },

    toggleSide: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.sides.indexOf(id);
      if (i !== -1) bowl.sides.splice(i, 1);
      else if (bowl.sides.length >= state.boot.limits.maxSidesPerBowl) {
        toast('Up to ' + state.boot.limits.maxSidesPerBowl + ' sides per bowl.');
        return;
      } else bowl.sides.push(id);
      render({ keepScroll: true });
    },

    gotoBowl: function (el) {
      state.activeBowl = Number(el.dataset.id);
      state.buildStep = 0;
      state.showAll = false;
      render();
    },

    gotoStep: function (el) {
      state.buildStep = Number(el.dataset.id);
      state.showAll = false;
      render();
    },

    buildBack: function () {
      if (state.buildStep > 0) state.buildStep -= 1;
      else if (state.activeBowl > 0) {
        state.activeBowl -= 1;
        state.buildStep = BUILD_STEPS.length - 1;
      } else state.screen = 'guests';
      state.showAll = false;
      render();
    },

    buildNext: function () { advance(); },

    editBowl: function (el) {
      state.activeBowl = Number(el.dataset.id);
      state.buildStep = 0;
      state.screen = 'build';
      state.showAll = false;
      render();
    },

    setName: function (el) {
      currentBowl().guestLabel = el.value.trim() || 'Guest ' + (state.activeBowl + 1);
    },
    setSpice: function (el) {
      currentBowl().spice = el.dataset.id;
      render({ keepScroll: true });
    },
    setNotes: function (el) { currentBowl().notes = el.value; },
    setOrderNotes: function (el) { state.orderNotes = el.value; },

    send: async function () {
      state.busy = true;
      render({ keepScroll: true });
      try {
        var created = await db.submitOrder({
          memberNumber: state.memberDigits,
          memberName: state.member ? state.member.name : '',
          memberStatus: state.member ? state.member.status : 'unverified',
          memberTier: state.member ? state.member.tier : 'guest',
          guestCount: state.guestCount,
          source: 'qr',
          avoidAllergens: state.avoid,
          notes: state.orderNotes,
          lines: state.bowls,
        }, {
          tagId: state.boot.tag ? state.boot.tag.id : null,
          // Reuse the depth the review screen already measured, so placing the
          // order needs no read of its own.
          queueDepth: estimate.queueDepth || 0,
        });

        state.busy = false;
        state.order = order.publicView(created);
        state.screen = 'sent';
        render();
        watchOrder(created.id);
      } catch (err) {
        state.busy = false;
        render({ keepScroll: true });
        toast(err.errors && err.errors.length ? err.errors[0] : err.message, true);
      }
    },

    restart: function () {
      if (state.stopStream) state.stopStream();
      state.bowls = [];
      state.order = null;
      state.orderNotes = '';
      state.activeBowl = 0;
      state.buildStep = 0;
      state.screen = 'guests';
      render();
    },
  };

  /**
   * Follow this one ticket. The server only streams events for the order id we
   * pass, so a guest never sees the rest of the room.
   */
  var countdownTimer = null;

  function watchOrder(orderId) {
    if (state.stopStream) state.stopStream();
    state.stopStream = db.watchOrder(orderId, function (doc) {
      var was = state.order ? state.order.status : null;
      state.order = order.publicView(doc);
      if (state.screen === 'sent') render({ keepScroll: true });
      if (was !== 'ready' && doc.status === 'ready') {
        chime('runner');
        if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
      }
    });

    // Keep the "ready in about N min" countdown honest between events. Clear
    // any previous one first: a guest ordering a second round would otherwise
    // stack a new interval on every send.
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function () {
      if (state.screen === 'sent' && state.order &&
        (state.order.status === 'queued' || state.order.status === 'cooking')) {
        render({ keepScroll: true });
      }
    }, 15000);
  }

  // ---------------------------------------------------------------------- events

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.act];
    if (!fn) return;
    // Text inputs handle their own events; a click on one must not fire twice.
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    e.preventDefault();
    unlockAudio();
    fn(el);
  });

  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    var fn = actions[el.dataset.act];
    if (fn) fn(el);
  });

  document.getElementById('modeSwitch').addEventListener('click', function () {
    state.mode = state.mode === 'pro' ? 'simple' : 'pro';
    remember('mode', state.mode);
    render({ keepScroll: true });
  });

  document.addEventListener('keydown', function (e) {
    if (state.screen !== 'member') return;
    if (/^[0-9]$/.test(e.key) && state.memberDigits.length < 6) {
      state.memberDigits += e.key;
      state.member = null;
      render({ keepScroll: true });
    } else if (e.key === 'Backspace') {
      state.memberDigits = state.memberDigits.slice(0, -1);
      state.member = null;
      render({ keepScroll: true });
    } else if (e.key === 'Enter' && state.memberDigits.length >= 4) {
      actions.submitMember();
    }
  });

  // ------------------------------------------------------------------------ boot

  async function boot() {
    document.getElementById('brandMark').innerHTML = art('mark');

    // On a static host there is no server to route /t/<tag>, so the QR codes
    // carry the table as a query parameter: ...?t=table-12
    var params = new URLSearchParams(location.search);
    var tagId = params.get('t');
    // Still honour an old-style /t/<tag> link if one is floating around.
    if (!tagId) {
      var legacy = location.pathname.match(/\/t\/([A-Za-z0-9_-]+)/);
      if (legacy) tagId = legacy[1];
    }

    // What used to be GET /api/bootstrap is now assembled on the device.
    state.boot = {
      venue: config.venue,
      limits: {
        maxGuests: config.order.maxGuests,
        maxToppingsPerBowl: config.order.maxToppingsPerBowl,
        maxSidesPerBowl: config.order.maxSidesPerBowl,
      },
      sla: config.sla,
      open: isOpen(),
      tag: tagId ? tagById(tagId) : null,
      tagUnknown: Boolean(tagId && !tagById(tagId)),
      menu: menuCatalog(),
    };

    if (!db.isConfigured) {
      stage.innerHTML = '<div class="step-head"><h1 class="step-title">Almost ready</h1>' +
        '<p class="step-sub">This install has no Firebase project connected yet. ' +
        'A manager needs to fill in app/firebase-config.js.</p></div>';
      return;
    }

    document.title = state.boot.venue.name + ' - Build Your Bowl';
    state.screen = 'welcome';
    render();

    try {
      await db.ready();
    } catch (err) {
      toast('We cannot reach the kitchen right now - ask your server.', true);
      return;
    }

    if (state.boot.tagUnknown) {
      toast('That table code is not one of ours - a server can sort it out.', true);
    }
    if (!state.boot.open) {
      toast('The pasta station is closed right now.', true);
    }
  }

  boot();
})();
