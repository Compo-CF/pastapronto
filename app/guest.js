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
import { catalog as menuCatalog, saucesOf, groupRules } from './menu.js';
import * as cooktime from './cooktime.js';
import * as order from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import { mastheadHtml, pageTitle, activeBrand } from './brand.js';
import {
  html, raw, humanMins, escapeHtml,
  remember, recall, chime, unlockAudio, toast, now,
} from './ui.js';

(function () {
  'use strict';

  /**
   * The build wizard, per kind. Pizza has one step fewer because every pizza is
   * the same size, so there is nothing to ask about portions.
   */
  var STEPS = {
    pasta: [
      { id: 'pasta', label: 'Pasta', group: 'pastas', title: 'Pick your pasta', sub: 'Tap the shape you want.' },
      { id: 'sauces', label: 'Sauce', group: 'sauces', title: 'Now the sauce', sub: '', multi: true },
      { id: 'proteins', label: 'Protein', group: 'proteins', title: 'Add a protein?', sub: '', multi: true },
      { id: 'toppings', label: 'Toppings', group: 'toppings', title: 'Toppings!', sub: '' },
      { id: 'finish', label: 'Size', group: 'portions', title: 'How big?', sub: '' },
    ],
    pizza: [
      { id: 'sauces', label: 'Sauce', group: 'pizzaSauces', title: 'Pick your sauce', sub: 'Light or heavy goes on top of your pick.', multi: true },
      { id: 'cheeses', label: 'Cheese', group: 'pizzaCheeses', title: 'And the cheese', sub: 'Light or heavy goes on top of your pick.', multi: true },
      { id: 'proteins', label: 'Protein', group: 'pizzaProteins', title: 'Add a protein?', sub: '', multi: true },
      { id: 'toppings', label: 'Toppings', group: 'pizzaToppings', title: 'Toppings!', sub: '' },
      { id: 'finishers', label: 'Finish', group: 'finishers', title: 'Anything on top?', sub: 'Added after it comes out of the oven.', multi: true },
    ],
  };

  /** Guest-facing words for each lane, so no screen has to branch on strings. */
  var LANES = {
    pasta: {
      one: 'bowl', many: 'bowls',
      title: 'Build your <em>bowl</em>',
      blurb: 'Pick a pasta, pick a sauce, pile on toppings. We cook it fresh and bring it over.',
      art: 'bowl',
    },
    pizza: {
      one: 'pizza', many: 'pizzas',
      title: 'Build your <em>pizza</em>',
      blurb: 'One size, three sauces, all the toppings. Straight into the oven.',
      art: 'pie',
    },
  };

  function lane() {
    return LANES[state.kind] || LANES.pasta;
  }

  function steps() {
    return STEPS[state.kind] || STEPS.pasta;
  }

  var TRACK = [
    { status: 'queued', label: 'Sent' },
    { status: 'cooking', label: 'Cooking' },
    { status: 'ready', label: 'Ready' },
    { status: 'delivered', label: 'Enjoy' },
  ];

  var state = {
    screen: 'welcome',
    kind: null,
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
    unavailable: [],
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
    var base = {
      guestLabel: 'Guest ' + (index + 1),
      kind: state.kind,
      sauces: [],
      proteins: [],
      toppings: [],
      notes: '',
    };
    if (state.kind === 'pizza') return Object.assign(base, { cheeses: [], finishers: [] });
    return Object.assign(base, {
      pasta: null, sides: [], portion: null, spice: 'mild',
    });
  }

  function currentBowl() {
    return state.bowls[state.activeBowl];
  }

  function bowlComplete(bowl) {
    if (!bowl) return false;
    if (bowl.kind === 'pizza') return bowl.sauces.length > 0 && bowl.cheeses.length > 0;
    return Boolean(bowl.pasta && bowl.sauces.length > 0 && bowl.portion);
  }

  function allBowlsComplete() {
    return state.bowls.length > 0 && state.bowls.every(bowlComplete);
  }

  /** Items to show for a group, honouring simple mode and the "more" toggle. */
  /**
   * Sub-heading for a step whose list mixes choices with "none" and amounts.
   * Says back what was picked, because a guest who taps Heavy Sauce wants to
   * see that it landed on something.
   */
  function amountSub(groupKey, chosen, one, many, empty) {
    var rule = groupRules(groupKey, chosen);
    if (rule.exclusive) return rule.exclusive.name + ' it is.';
    if (!rule.bases.length) return empty;
    var names = rule.bases.map(function (id) { return (item(groupKey, id) || {}).name || id; });
    var text = names.length > 1
      ? 'Mixing ' + names.length + ' ' + many
      : names[0];
    if (rule.amount) text += ', ' + rule.amount.amount;
    return text + ' - tap Next when you are happy.';
  }

  /**
   * Toggle inside a group where some entries cancel others.
   *
   * Tapping "No Sauce" clears the rest rather than refusing the tap, and
   * tapping a sauce afterwards clears "No Sauce" - a guest changing their mind
   * should not have to undo first. Light and Heavy swap for each other. The
   * cap counts real choices, so Marinara + Alfredo + Heavy is two sauces.
   */
  function toggleRuled(bowl, field, groupKey, id, cap, capMessage) {
    var chosen = bowl[field];
    var i = chosen.indexOf(id);
    if (i !== -1) { chosen.splice(i, 1); return true; }

    var entry = item(groupKey, id) || {};

    if (entry.exclusive) { bowl[field] = [id]; return true; }

    // Anything else cancels the "none" answer and any competing amount.
    bowl[field] = chosen.filter(function (other) {
      var o = item(groupKey, other) || {};
      if (o.exclusive) return false;
      if (entry.amount && o.amount) return false;
      return true;
    });

    if (!entry.amount && groupRules(groupKey, bowl[field]).bases.length >= cap) {
      toast(capMessage);
      return false;
    }
    bowl[field].push(id);
    return true;
  }

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
    var soldOut = state.unavailable.indexOf(entry.id) !== -1;
    var clash = conflicts(entry);
    // A third reason a tile can be unavailable: the choices already made in
    // this group rule it out - "No Sauce" greys the sauces, "Light" greys
    // "Heavy". The caller works that out through menu.groupRules() so the
    // screen and the validator are reading the same rulebook.
    var ruledOut = opts.ruledOut || '';
    var blocked = soldOut || clash.length > 0 || !!ruledOut;
    // Never silently hide a choice. A child who wants shrimp should see that
    // shrimp exists and is sold out, not wonder where it went.
    var reason = soldOut
      ? 'sold out'
      : (clash.length ? 'has ' + clash.map(allergenName).join(', ') : ruledOut);
    var meta = [];
    if (state.mode === 'pro') {
      if (entry.boilSec) meta.push(Math.round(entry.boilSec / 60) + ' min');
      if (entry.glutenFree) meta.push('GF');
      if (entry.spicy) meta.push('spicy');
    }

    return html`<button class="tile ${opts.multi ? 'is-multi' : ''} ${blocked ? 'is-blocked' : ''}"
      type="button"
      data-act="${opts.act}" data-group="${opts.group}" data-id="${entry.id}"
      aria-pressed="${opts.selected ? 'true' : 'false'}"
      ${raw(blocked ? 'disabled aria-describedby="clash-' + entry.id + '"' : '')}>
      <span class="tile-art">${raw(art(entry.shape || entry.icon || 'none'))}</span>
      <span class="tile-label">${entry.name}</span>
      ${raw(meta.length && !blocked ? '<span class="tile-meta">' + escapeHtml(meta.join(' \u00b7 ')) + '</span>' : '')}
      ${raw(reason ? '<span class="tile-warn" id="clash-' + entry.id + '">' + escapeHtml(reason) + '</span>' : '')}
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
        ruledOut: (opts.blocked || {})[entry.id] || '',
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
        ${raw(state.boot.venue.orgName
          ? '<p class="hero-org">' + escapeHtml(state.boot.venue.orgName) + '</p>'
          : '')}
        <h1>What are we making?</h1>
        <p>${state.boot.venue.tagline}</p>
        ${raw(where)}
      </div>

      <div class="lanepick">
        ${['pasta', 'pizza'].map(function (k) {
          var l = LANES[k];
          return html`<button class="lanetile" type="button" data-act="pickKind" data-id="${k}">
            <span class="lanetile-art">${raw(art(l.art))}</span>
            <span class="lanetile-title">${raw(l.title)}</span>
            <span class="lanetile-blurb">${l.blurb}</span>
          </button>`;
        })}
      </div>

      <ul class="howto">
        <li><span class="n">1</span> Enter your ${state.boot.venue.memberLabel.toLowerCase()}</li>
        <li><span class="n">2</span> Tell us how many are eating</li>
        <li><span class="n">3</span> Build one for each person</li>
        <li><span class="n">4</span> Send it to the kitchen</li>
      </ul>`;
  }

  function screenMember() {
    var digits = state.memberDigits;
    var boxes = [];
    for (var i = 0; i < config.order.maxMemberNumberLength; i += 1) {
      boxes.push(html`<span class="${digits[i] ? 'is-filled' : ''}">${digits[i] || ''}</span>`);
    }
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

    return html`
      <div class="step-head">
        <p class="step-kicker">Step 1 of 4</p>
        <h1 class="step-title">What is your ${state.boot.venue.memberLabel.toLowerCase()}?</h1>
        <p class="step-sub">However it reads on your card - up to four digits. A grown-up can help.</p>
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
        <p class="step-sub">We will build one ${lane().one} per person. You can change it later.</p>
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
    var step = steps()[state.buildStep];

    var tabs = state.bowls.map(function (b, i) {
      return html`<button class="bowltab ${bowlComplete(b) ? 'is-done' : ''}" type="button"
        data-act="gotoBowl" data-id="${i}" aria-current="${i === state.activeBowl ? 'true' : 'false'}">
        ${b.guestLabel}
        <small>${bowlComplete(b) ? 'ready' : 'building'}</small>
      </button>`;
    });

    var stepTabs = steps().map(function (s, i) {
      var done = i < state.buildStep;
      return html`<button class="buildstep ${done ? 'is-done' : ''}" type="button"
        data-act="gotoStep" data-id="${i}" aria-current="${i === state.buildStep ? 'true' : 'false'}">${s.label}</button>`;
    });

    var body;
    if (step.id === 'toppings') body = buildToppings(bowl);
    else if (step.id === 'finish') body = buildFinish(bowl);
    else if (step.id === 'finishers') {
      body = tileGrid('finishers', { act: 'toggleFinisher', value: bowl.finishers, multi: true, small: true })
        + detailPanel(bowl);
    } else if (step.id === 'sauces') {
      body = tileGrid(step.group, {
        act: 'toggleSauce', value: bowl.sauces, multi: true,
        blocked: groupRules(step.group, bowl.sauces).blocked,
      });
    } else if (step.id === 'cheeses') {
      body = tileGrid(step.group, {
        act: 'toggleCheese', value: bowl.cheeses, multi: true,
        blocked: groupRules(step.group, bowl.cheeses).blocked,
      });
    } else if (step.id === 'proteins') {
      body = tileGrid(step.group, { act: 'toggleProtein', value: bowl.proteins, multi: true });
    } else {
      body = tileGrid(step.group, {
        act: 'pick', value: bowl[step.id], multi: false,
      });
    }

    var sub = step.sub;
    if (step.id === 'toppings') {
      sub = 'Pick up to ' + toppingCap() + '. Or none at all.';
    }
    if (step.id === 'finishers' && bowl.finishers.length) {
      sub = bowl.finishers.length + ' on top, added after the bake.';
    }
    if (step.id === 'proteins') {
      sub = bowl.proteins.length
        ? bowl.proteins.length + ' chosen - tap Next when you are happy.'
        : 'Pick as many as you like, or skip it - totally fine.';
    }
    if (step.id === 'sauces') {
      sub = amountSub(step.group, bowl.sauces, 'sauce', 'sauces',
        'Pick one, or tap two to mix them.');
    }
    if (step.id === 'cheeses') {
      sub = amountSub(step.group, bowl.cheeses, 'cheese', 'cheeses',
        'Pick one, or mix them. No Cheese is fine too.');
    }

    return html`
      <div class="bowltabs">${tabs}</div>
      <div class="step-head">
        <p class="step-kicker">${lane().one[0].toUpperCase() + lane().one.slice(1)} ${state.activeBowl + 1} of ${state.bowls.length} &middot; ${bowl.guestLabel}</p>
        <h1 class="step-title">${step.title}</h1>
        <p class="step-sub">${sub}</p>
      </div>
      <div class="buildsteps">${stepTabs}</div>
      ${raw(body)}`;
  }

  /** Toppings cap differs by kind: a pizza takes more than a bowl. */
  function toppingCap() {
    return state.kind === 'pizza'
      ? state.boot.limits.maxToppingsPerPizza
      : state.boot.limits.maxToppingsPerBowl;
  }

  function buildToppings(bowl) {
    var group = state.kind === 'pizza' ? 'pizzaToppings' : 'toppings';
    var grid = tileGrid(group, { act: 'toggleTopping', value: bowl.toppings, multi: true, small: true });

    // Sides are a pasta-station thing; a pizza order does not offer them.
    var sides = state.kind === 'pasta' && (state.mode === 'pro' || bowl.sides.length > 0)
      ? html`<div class="stack" style="margin-top:22px">
          <strong>Add a side?</strong>
          ${raw(tileGrid('sides', { act: 'toggleSide', value: bowl.sides, multi: true, small: true }))}
        </div>`
      : '';

    return html`${raw(grid)}
      <p class="muted" style="margin-top:12px">${bowl.toppings.length} of ${toppingCap()} chosen</p>
      ${raw(sides)}`;
  }

  /**
   * The pro-mode detail panel: who it is for, and anything the kitchen needs to
   * know. Shared by both lanes - it used to live inside the pasta-only size
   * step, which left a pizza guest with no way to leave a note at all.
   *
   * Spice level is pasta-only; on a pizza the heat comes from a topping or a
   * finisher, so asking twice would be noise.
   */
  function detailPanel(bowl) {
    if (state.mode !== 'pro') {
      return html`<div class="chips" style="margin-top:18px">
        <button class="chip" type="button" data-act="mode" data-id="pro">Add a note${bowl.kind === 'pizza' ? '' : ' or spice level'}</button>
      </div>`;
    }

    var spice = bowl.kind === 'pizza' ? '' : html`<div class="field">
        <label>Spice level</label>
        <div class="chips">
          ${state.boot.menu.spice.map(function (x) {
            return html`<button class="chip" type="button" data-act="setSpice" data-id="${x.id}"
              aria-pressed="${bowl.spice === x.id ? 'true' : 'false'}">${x.name}</button>`;
          })}
        </div>
      </div>`;

    return html`<div class="card stack" style="margin-top:22px">
      <div class="field">
        <label for="whoName">Who is this ${lane().one} for?</label>
        <input class="input" id="whoName" type="text" maxlength="24" value="${bowl.guestLabel}"
          data-act="setName" placeholder="Name or seat">
      </div>
      ${raw(spice)}
      <div class="field">
        <label for="bowlNotes">Notes for the kitchen</label>
        <textarea class="textarea" id="bowlNotes" maxlength="140" data-act="setNotes"
          placeholder="${bowl.kind === 'pizza' ? 'Well done, light sauce, cut in squares...' : 'Sauce on the side, no onions, allergy details...'}">${bowl.notes}</textarea>
      </div>
    </div>`;
  }

  function buildFinish(bowl) {
    // Pasta only - a pizza has one size, so it never reaches this step.
    var portions = tileGrid('portions', { act: 'pick', value: bowl.portion, multi: false });
    return html`${raw(portions)}${raw(detailPanel(bowl))}`;
  }

  var estimate = { queueDepth: 0, cookEstimateSec: 0, promiseSec: 0 };

  function screenReview() {
    var bowls = state.bowls.map(function (bowl, i) {
      var isPizza = bowl.kind === 'pizza';
      var glyph = isPizza ? 'pie' : (item('pastas', bowl.pasta) || {}).shape || 'none';
      var toppingGroup = isPizza ? 'pizzaToppings' : 'toppings';

      var extras = [];
      if (bowl.toppings.length) {
        extras.push('with ' + bowl.toppings.map(function (t) {
          return (item(toppingGroup, t) || {}).name || t;
        }).join(', '));
      }
      if (isPizza) {
        if (bowl.finishers.length) {
          extras.push('finished with ' + bowl.finishers.map(function (f) {
            return (item('finishers', f) || {}).name || f;
          }).join(', '));
        }
        extras.push('12" - one size');
      } else {
        if (bowl.sides.length) {
          extras.push('side of ' + bowl.sides.map(function (x) {
            return (item('sides', x) || {}).name || x;
          }).join(', '));
        }
        if (bowl.spice !== 'mild') {
          var spice = item('spice', bowl.spice);
          if (spice) extras.push(spice.name + ' spice');
        }
        var portion = item('portions', bowl.portion);
        if (portion) extras.push(portion.name);
      }
      if (bowl.notes) extras.push('Note: ' + bowl.notes);

      return html`<div class="bowl">
        <span class="bowl-art">${raw(art(glyph))}</span>
        <div class="grow">
          <div class="bowl-who">${bowl.guestLabel}</div>
          <div class="bowl-dish">${dishText(bowl)}</div>
          <div class="bowl-extras">${extras.filter(Boolean).join(' · ')}</div>
        </div>
        <div style="text-align:right">
          <button class="btn btn-ghost btn-sm"
            type="button" data-act="editBowl" data-id="${i}">Change</button>
        </div>
      </div>`;
    });

    // Roll the allergens up from whichever groups this lane actually uses,
    // plus the crust for a pizza - every pie carries the crust's gluten, and
    // its dairy now comes from whichever cheese was chosen.
    var allergens = [];
    var addAll = function (list) {
      list.forEach(function (a) { if (allergens.indexOf(a) === -1) allergens.push(a); });
    };
    state.bowls.forEach(function (b) {
      var isPizza = b.kind === 'pizza';
      var entries = saucesOf(b).map(function (x) { return item(isPizza ? 'pizzaSauces' : 'sauces', x); })
        .concat(b.toppings.map(function (t) { return item(isPizza ? 'pizzaToppings' : 'toppings', t); }));

      if (isPizza) {
        addAll(state.boot.menu.pizzaBase.allergens);
        entries = entries
          .concat((b.cheeses || []).map(function (c) { return item('pizzaCheeses', c); }))
          .concat((b.finishers || []).map(function (f) { return item('finishers', f); }));
      } else {
        entries = entries
          .concat([item('pastas', b.pasta), item('proteins', b.protein)])
          .concat((b.sides || []).map(function (x) { return item('sides', x); }));
      }

      entries.forEach(function (entry) { addAll(entry && entry.allergens ? entry.allergens : []); });
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
          <div class="summary-line"><span>${lane().many[0].toUpperCase() + lane().many.slice(1)}</span><span>${state.bowls.length}</span></div>
          <div class="summary-line"><span>Guests</span><span>${state.guestCount}</span></div>
          <div class="summary-line"><span>Where</span><span>${state.boot.tag ? state.boot.tag.label : 'Takeout'}</span></div>
          <div class="summary-total"><span>Cook time</span><span>${humanMins(estimate.cookEstimateSec)}</span></div>
          <p class="muted" style="margin:0;font-size:14px">On ${state.boot.venue.memberLabel.toLowerCase()} ${state.memberDigits}</p>
        </div>
        ${raw(notesField)}
      </div>`;
  }

  function dishText(bowl) {
    var isPizza = bowl.kind === 'pizza';
    var nameIn = function (group) {
      return function (id) { return (item(group, id) || {}).name; };
    };
    var sauceText = saucesOf(bowl)
      .map(nameIn(isPizza ? 'pizzaSauces' : 'sauces')).filter(Boolean).join(' + ');
    var proteins = (bowl.proteins || [])
      .map(nameIn(isPizza ? 'pizzaProteins' : 'proteins')).filter(Boolean);

    if (isPizza) {
      var sauceRule = groupRules('pizzaSauces', bowl.sauces);
      var cheeseRule = groupRules('pizzaCheeses', bowl.cheeses || []);
      var qualify = function (text, rule) {
        return rule.amount && text ? text + ' (' + rule.amount.amount + ')' : text;
      };
      var sauceLabel = sauceRule.exclusive ? 'No-sauce'
        : qualify(sauceRule.bases.map(nameIn('pizzaSauces')).filter(Boolean).join(' + '), sauceRule);
      var cheeseLabel = cheeseRule.exclusive ? 'no cheese'
        : qualify(cheeseRule.bases.map(nameIn('pizzaCheeses')).filter(Boolean).join(' + '), cheeseRule);

      var on = proteins.concat(bowl.toppings.map(nameIn('pizzaToppings')).filter(Boolean));
      var out = [sauceLabel ? sauceLabel + ' Pizza' : 'Pizza'];
      if (cheeseLabel) out.push('w/ ' + cheeseLabel);
      if (on.length) out.push((cheeseLabel ? '+ ' : 'w/ ') + on.join(', '));
      return out.join(' ');
    }

    var pasta = item('pastas', bowl.pasta);
    var parts = [];
    if (pasta) parts.push(pasta.name);
    if (sauceText) parts.push('w/ ' + sauceText);
    if (proteins.length) parts.push('+ ' + proteins.join(', '));
    return parts.join(' ');
  }

  /**
   * Time the order. This used to be a server round trip; the model lives in
   * cooktime.js so it now runs on the device, and the only thing we still need
   * from Firestore is how deep the queue is right now.
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
    };
  }

  function screenSent() {
    var ticket = state.order;
    var stepIndex = TRACK.findIndex(function (t) { return t.status === ticket.status; });
    if (stepIndex < 0) stepIndex = 0;

    var segs = TRACK.map(function (t, i) {
      var cls = i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : '';
      return html`<div class="track-seg ${cls}"></div>`;
    });
    var labels = TRACK.map(function (t, i) {
      return html`<span class="${i === stepIndex ? 'is-now' : ''}">${t.label}</span>`;
    });

    var headline, note;
    if (ticket.status === 'queued') {
      headline = 'Sent to the kitchen!';
      note = 'A cook will pick it up in a moment.';
    } else if (ticket.status === 'cooking') {
      headline = 'Your pasta is cooking';
      note = 'Water is boiling. Hang tight.';
    } else if (ticket.status === 'ready') {
      headline = 'Ready!';
      note = 'A runner is bringing it to ' + ticket.tagLabel + '.';
    } else if (ticket.status === 'delivered') {
      headline = 'Buon appetito!';
      note = 'Enjoy. Tap below to order another round.';
    } else {
      headline = 'We are on it';
      note = '';
    }

    var eta = '';
    if (ticket.status === 'queued' || ticket.status === 'cooking') {
      var remaining = Math.max(0, (new Date(ticket.promisedReadyAt).getTime() - now()) / 1000);
      eta = html`<p class="eta">Ready in <strong>${humanMins(remaining)}</strong></p>`;
    }

    var readyBanner = ticket.status === 'ready'
      ? html`<div class="ready-banner">Ticket #${ticket.ticketNo} is up!</div>`
      : '';

    var bowls = ticket.lines.map(function (line) {
      return html`<div class="sentbowl">
        ${raw(art(line.kind === 'pizza' ? 'pie' : 'bowl'))}
        <div class="grow">
          <strong>${line.guestLabel}</strong>
          <div class="muted">${line.dish}</div>
        </div>
      </div>`;
    });

    return html`
      <div class="sentwrap stack">
        ${raw(ticket.status === 'cooking' ? '<div class="pot">' + art('pot') + '</div>' : '')}
        ${raw(readyBanner)}
        <div class="ticket">
          <div class="ticket-label">Ticket</div>
          <div class="ticket-no">#${ticket.ticketNo}</div>
          <div class="ticket-label" style="margin-top:10px">Show this code if a server asks</div>
          <div class="ticket-code">${ticket.claimCode}</div>
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
          <div class="summary-line"><span>Table</span><span>${ticket.tagLabel}</span></div>
          <div class="summary-line"><span>Guests</span><span>${ticket.guestCount}</span></div>
          <div class="summary-line"><span>${ticket.kind === 'pizza' ? 'Pizzas' : 'Bowls'}</span><span>${ticket.lines.length}</span></div>
        </div>
      </div>`;
  }

  // -------------------------------------------------------------------- footbar

  function renderFootbar() {
    var s = state.screen;
    var parts = '';

    if (s === 'welcome') {
      // The two lane tiles are the call to action; a button here would just be
      // a third thing to read.
      parts = '';
    } else if (s === 'member') {
      // Any length from one digit up is a real member number.
      var ready = state.memberDigits.length >= 1;
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="welcome">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="submitMember"
          ${raw(ready && !state.busy ? '' : 'disabled')}>${state.busy ? 'Checking...' : 'Next'}</button>`;
    } else if (s === 'guests') {
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="member">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="startBuilding">
          Build ${state.guestCount} ${state.guestCount === 1 ? lane().one : lane().many}</button>`;
    } else if (s === 'build') {
      var bowl = currentBowl();
      var step = steps()[state.buildStep];
      var chosen = step.id === 'toppings' || step.id === 'proteins' || step.id === 'finishers' ? true
        : step.id === 'finish' ? Boolean(bowl.portion)
        : step.id === 'sauces' ? bowl.sauces.length > 0
        : step.id === 'cheeses' ? bowl.cheeses.length > 0
        : Boolean(bowl[step.id]);
      var lastStep = state.buildStep === steps().length - 1;
      var lastBowl = state.activeBowl === state.bowls.length - 1;
      var label = !lastStep ? 'Next' : lastBowl ? 'Review order' : ('Next ' + lane().one);
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
    var sequence = ['member', 'guests', 'build', 'review'];
    var idx = sequence.indexOf(state.screen);
    crumbs.innerHTML = sequence.map(function (name, i) {
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

  var GROUP_FIELD = { pastas: 'pasta', proteins: 'protein', portions: 'portion' };

  /** Move forward through steps, then bowls, then to review. */
  function advance() {
    if (state.buildStep < steps().length - 1) {
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
    pickKind: function (el) {
      state.kind = el.dataset.id;
      // Changing lane invalidates anything already built - the shapes differ.
      state.bowls = [];
      state.activeBowl = 0;
      state.buildStep = 0;
      state.screen = 'member';
      render();
    },

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
      else if (state.memberDigits.length < config.order.maxMemberNumberLength) state.memberDigits += k;
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

    toggleProtein: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.proteins.indexOf(id);
      if (i !== -1) {
        bowl.proteins.splice(i, 1);
      } else if (bowl.proteins.length >= state.boot.limits.maxProteinsPerItem) {
        toast('Up to ' + state.boot.limits.maxProteinsPerItem + ' proteins. Tap one to swap it.');
        return;
      } else {
        bowl.proteins.push(id);
      }
      state.showAll = false;
      render({ keepScroll: true });
    },

    toggleSauce: function (el) {
      var bowl = currentBowl();
      var cap = state.boot.limits.maxSaucesPerBowl;
      var group = state.kind === 'pizza' ? 'pizzaSauces' : 'sauces';
      if (!toggleRuled(bowl, 'sauces', group, el.dataset.id, cap,
        'Up to ' + cap + ' sauces. Tap one to swap it.')) return;
      state.showAll = false;
      render({ keepScroll: true });
    },

    toggleCheese: function (el) {
      var bowl = currentBowl();
      var cap = state.boot.limits.maxCheesesPerPizza;
      if (!toggleRuled(bowl, 'cheeses', 'pizzaCheeses', el.dataset.id, cap,
        'Up to ' + cap + ' cheeses. Tap one to swap it.')) return;
      state.showAll = false;
      render({ keepScroll: true });
    },

    toggleFinisher: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.finishers.indexOf(id);
      if (i !== -1) {
        bowl.finishers.splice(i, 1);
      } else if (bowl.finishers.length >= state.boot.limits.maxFinishersPerPizza) {
        toast('That is all four - tap one to swap it.');
        return;
      } else {
        bowl.finishers.push(id);
      }
      render({ keepScroll: true });
    },

    toggleTopping: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.toppings.indexOf(id);
      if (i !== -1) bowl.toppings.splice(i, 1);
      else if (bowl.toppings.length >= toppingCap()) {
        toast('That is ' + toppingCap() + ' toppings - plenty! Tap one to swap it.');
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
        state.buildStep = steps().length - 1;
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
      // Back to the lane picker, because the usual second order is the other
      // kind - the table that just had pasta now wants a pizza.
      state.kind = null;
      state.screen = 'welcome';
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
    if (/^[0-9]$/.test(e.key) && state.memberDigits.length < config.order.maxMemberNumberLength) {
      state.memberDigits += e.key;
      state.member = null;
      render({ keepScroll: true });
    } else if (e.key === 'Backspace') {
      state.memberDigits = state.memberDigits.slice(0, -1);
      state.member = null;
      render({ keepScroll: true });
    } else if (e.key === 'Enter' && state.memberDigits.length >= 1) {
      actions.submitMember();
    }
  });

  // ------------------------------------------------------------------------ boot

  async function boot() {
    document.getElementById('masthead').innerHTML = mastheadHtml(art('mark'));
    document.title = pageTitle('');

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
    var brand = activeBrand();
    state.boot = {
      venue: {
        ...config.venue,
        name: brand.venueName,
        orgName: brand.orgName,
        tagline: brand.tagline,
      },
      limits: {
        maxGuests: config.order.maxGuests,
        maxSaucesPerBowl: config.order.maxSaucesPerBowl,
        maxProteinsPerItem: config.order.maxProteinsPerItem,
        maxToppingsPerBowl: config.order.maxToppingsPerBowl,
        maxSidesPerBowl: config.order.maxSidesPerBowl,
        maxToppingsPerPizza: config.order.maxToppingsPerPizza,
        maxFinishersPerPizza: config.order.maxFinishersPerPizza,
        maxCheesesPerPizza: config.order.maxCheesesPerPizza,
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

    document.title = pageTitle('Order');
    state.screen = 'welcome';
    render();

    try {
      await db.ready();
    } catch (err) {
      toast('We cannot reach the kitchen right now - ask your server.', true);
      return;
    }

    // Live 86 list. If the kitchen runs out of shrimp while a guest is mid-build
    // the tile greys out under them, and submitOrder re-checks anyway.
    db.watchAvailability(function (list) {
      var was = state.unavailable.join(',');
      state.unavailable = list;
      if (was !== list.join(',') && state.screen === 'build') render({ keepScroll: true });
    });

    if (state.boot.tagUnknown) {
      toast('That table code is not one of ours - a server can sort it out.', true);
    }
    if (!state.boot.open) {
      toast('The pasta station is closed right now.', true);
    }
  }

  boot();
})();
