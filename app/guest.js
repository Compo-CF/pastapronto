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
import { config, tagById, isOpen, kindsForNight, nightById } from './config.js';
import { catalog as menuCatalog, saucesOf, groupRules, nameOf, describe as describeLine, GROUPS_FOR, crustOf } from './menu.js';
import * as i18n from './i18n.js';
import * as cooktime from './cooktime.js';
import * as order from './order.js';
import * as db from './db.js';
import { art } from './art.js';
import { burgerStackSvg } from './burgerstack.js';
import { mastheadHtml, pageTitle, activeBrand, taglineFor } from './brand.js';
import {
  html, raw, humanMins, escapeHtml,
  remember, recall, chime, unlockAudio, toast, now,
} from './ui.js';

(function () {
  'use strict';

  /**
   * The build wizard, per kind.
   *
   * Every kind ends on a `finish` step, which is where the order gets a name.
   * Pasta asks the size there too; a pizza is one size and a burger is one
   * burger, so for them the step is the name and the note alone. It used to
   * exist only for pasta, which left a pizza with no way to be labelled at
   * all - and at a table of eight that is eight anonymous pizzas arriving
   * together.
   */
  var STEPS = {
    pasta: [
      { id: 'pasta', labelKey: 'guest.tab.pasta', group: 'pastas', titleKey: 'guest.step.pasta', subKey: 'guest.step.pasta.sub' },
      { id: 'sauces', labelKey: 'guest.tab.sauce', group: 'sauces', titleKey: 'guest.step.sauce', subKey: '', multi: true },
      { id: 'proteins', labelKey: 'guest.tab.protein', group: 'proteins', titleKey: 'guest.step.protein', subKey: '', multi: true },
      { id: 'toppings', labelKey: 'guest.tab.toppings', group: 'toppings', titleKey: 'guest.step.toppings', subKey: '' },
      { id: 'finish', labelKey: 'guest.tab.size', group: 'portions', titleKey: 'guest.step.size', subKey: '' },
    ],
    pizza: [
      { id: 'base', labelKey: 'guest.tab.crust', group: 'pizzaCrusts', titleKey: 'guest.step.crust', subKey: 'guest.step.crust.sub' },
      { id: 'sauces', labelKey: 'guest.tab.sauce', group: 'pizzaSauces', titleKey: 'guest.step.pizzasauce', subKey: 'guest.step.amountsub', multi: true },
      { id: 'cheeses', labelKey: 'guest.tab.cheese', group: 'pizzaCheeses', titleKey: 'guest.step.cheese', subKey: 'guest.step.amountsub', multi: true },
      { id: 'proteins', labelKey: 'guest.tab.protein', group: 'pizzaProteins', titleKey: 'guest.step.protein', subKey: '', multi: true },
      { id: 'toppings', labelKey: 'guest.tab.toppings', group: 'pizzaToppings', titleKey: 'guest.step.toppings', subKey: '' },
      { id: 'finish', labelKey: 'guest.tab.who', group: null, titleKey: 'guest.step.who', subKey: 'guest.step.who.sub' },
    ],
    burger: [
      { id: 'proteins', labelKey: 'guest.tab.patty', group: 'burgerPatties', titleKey: 'guest.step.patty', subKey: 'guest.step.patty.sub', multi: true },
      { id: 'base', labelKey: 'guest.tab.bun', group: 'burgerBuns', titleKey: 'guest.step.bun', subKey: '' },
      { id: 'cheeses', labelKey: 'guest.tab.cheese', group: 'burgerCheeses', titleKey: 'guest.step.cheese', subKey: '', multi: true },
      { id: 'toppings', labelKey: 'guest.tab.toppings', group: 'burgerToppings', titleKey: 'guest.step.toppings', subKey: '' },
      { id: 'sauces', labelKey: 'guest.tab.sauce', group: 'burgerSauces', titleKey: 'guest.step.burgersauce', subKey: '', multi: true },
      { id: 'sides', labelKey: 'guest.tab.side', group: 'burgerSides', titleKey: 'guest.step.side', subKey: 'guest.step.side.sub' },
      { id: 'finish', labelKey: 'guest.tab.who', group: null, titleKey: 'guest.step.who', subKey: 'guest.step.who.sub' },
    ],
  };

  /** Guest-facing words for each lane, so no screen has to branch on strings. */
  var t = i18n.translator('guest');

  /**
   * What to call a member number on screen. English falls back to whatever the
   * venue configured, so a club calling it something else keeps its wording.
   */
  function memberLabel() {
    return t.isEs ? t('guest.memberLabel')
      : (state.boot.venue.memberLabel || t('guest.memberLabel')).toLowerCase();
  }

  /** Menu item name in the guest's language. */
  function itemName(group, id) {
    return nameOf(group, id, t.lang) || id;
  }

  var LANES = {
    pasta: {
      one: 'bowl', many: 'bowls',
      titleKey: 'guest.lane.pasta.title',
      blurbKey: 'guest.lane.pasta.blurb',
      art: 'bowl',
    },
    pizza: {
      one: 'pizza', many: 'pizzas',
      titleKey: 'guest.lane.pizza.title',
      blurbKey: 'guest.lane.pizza.blurb',
      art: 'pie',
    },
    burger: {
      one: 'burger', many: 'burgers',
      titleKey: 'guest.lane.burger.title',
      blurbKey: 'guest.lane.burger.blurb',
      art: 'meatball',
    },
  };

  function lane() {
    return LANES[state.kind] || LANES.pasta;
  }

  /** The kinds tonight serves. One night, one menu. */
  /** Tonight's tagline, falling back to the brand's if a night has none. */
  /**
   * Masthead and tab title for tonight.
   *
   * Called at boot and again whenever the night changes, because the night
   * arrives from Firestore a moment after the page paints - rendering the
   * chrome once at boot left a burger night wearing the pasta night's name.
   */
  function applyNightChrome() {
    var label = nightById(state.night).label;
    var el = document.getElementById('masthead');
    if (el) el.innerHTML = mastheadHtml(art('mark'), label);
    document.title = pageTitle(state.order ? 'Order' : '', label);
  }

  function nightTagline() {
    var n = nightById(state.night);
    var es = t.lang === 'es';
    return (es ? n.taglineEs : n.tagline) || taglineFor(t.lang);
  }

  function kindsTonight() {
    return kindsForNight(state.night);
  }

  /**
   * Where a guest goes after their member number.
   *
   * On a night with a single lane there is nothing to choose, so asking would
   * be a screen that exists only to be tapped through. Burger Night goes
   * straight to the head count with the kind already set.
   */
  function afterMember() {
    var kinds = kindsTonight();
    if (kinds.length === 1) {
      state.kind = kinds[0];
      return 'guests';
    }
    return 'lane';
  }

  function steps() {
    return STEPS[state.kind] || STEPS.pasta;
  }

  /**
   * The progress bar on a guest's ticket.
   *
   * 'building' is a pizza-only stage, and a bowl never passes through it - so
   * the bar is built per order rather than fixed, and a pasta guest is not
   * shown a step their food will never reach. Without this a member watching
   * a pizza being assembled saw the bar stuck on "Sent", because findIndex
   * returned -1 for a status this list had never heard of.
   */
  var TRACK_ALL = [
    { status: 'queued', key: 'guest.track.sent' },
    { status: 'building', key: 'guest.track.building', kinds: ['pizza'] },
    { status: 'cooking', key: 'guest.track.cooking' },
    { status: 'ready', key: 'guest.track.ready' },
    { status: 'delivered', key: 'guest.track.enjoy' },
  ];

  function trackFor(kind) {
    return TRACK_ALL.filter(function (seg) {
      return !seg.kinds || seg.kinds.indexOf(kind) !== -1;
    });
  }

  var state = {
    screen: 'welcome',
    night: config.defaultNight,
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
    // Every pizza starts classic, so a guest who never thinks about the crust
    // gets the one they would have got before it was a question.
    if (state.kind === 'pizza') return Object.assign(base, { cheeses: [], base: 'classic' });
    // Every field a lane's steps will read has to exist from the start. A
    // burger reaching the cheese step with no `cheeses` array threw inside the
    // tile grid and froze the build on the step before it - which presents as
    // "the button does nothing" rather than as an error.
    if (state.kind === 'burger') {
      return Object.assign(base, { base: null, cheeses: [], sides: [] });
    }
    return Object.assign(base, {
      pasta: null, sides: [], portion: null, spice: 'mild',
    });
  }

  function currentBowl() {
    return state.bowls[state.activeBowl];
  }

  /**
   * Enough to send. Deliberately the minimum each lane needs rather than every
   * step having been visited - a guest who wants a plain burger should not
   * have to tap through toppings to prove it.
   */
  function bowlComplete(bowl) {
    if (!bowl) return false;
    if (bowl.kind === 'pizza') return bowl.sauces.length > 0 && bowl.cheeses.length > 0;
    if (bowl.kind === 'burger') {
      return Boolean(bowl.base) && bowl.proteins.length === 1 && bowl.cheeses.length > 0;
    }
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
    if (rule.exclusive) return t('guest.exclusive', { name: itemName(groupKey, rule.exclusive.id) });
    if (!rule.bases.length) return empty;
    var names = rule.bases.map(function (id) { return itemName(groupKey, id); });
    var text = names.length > 1
      ? t('guest.sauce.mixing', { n: names.length, what: many })
      : names[0];
    if (rule.amount) text += ', ' + itemName(groupKey, rule.amount.id);
    return t('guest.sauce.chosen', { names: text });
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

  /**
   * Everything on the menu, every time.
   *
   * This used to show a short list in simple mode and put the rest behind a
   * "show all" button. The club asked for it to stop: a member looking for
   * mushrooms should see mushrooms, not a button that might lead to them. The
   * only thing filtered now is an item retired from service, which is not a
   * choice being hidden - it is a choice that no longer exists.
   */
  function choicesFor(group) {
    return menu(group).filter(function (x) { return !x.retired; });
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
      ? t('guest.label.soldout')
      : (clash.length ? 'has ' + clash.map(allergenName).join(', ') : ruledOut);
    var meta = [];
    if (state.mode === 'pro') {
      if (entry.glutenFree) meta.push('GF');
      if (entry.spicy) meta.push('spicy');
    }

    return html`<button class="tile ${opts.multi ? 'is-multi' : ''} ${blocked ? 'is-blocked' : ''}"
      type="button"
      data-act="${opts.act}" data-group="${opts.group}" data-id="${entry.id}"
      aria-pressed="${opts.selected ? 'true' : 'false'}"
      ${raw(blocked ? 'disabled aria-describedby="clash-' + entry.id + '"' : '')}>
      <span class="tile-art">${raw(art(entry.shape || entry.icon || 'none'))}</span>
      <span class="tile-label">${entry.es && t.isEs ? entry.es : entry.name}</span>
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
    return html`<div class="tiles ${opts.small ? 'tiles-sm' : ''}">${markup}</div>`;
  }

  // --------------------------------------------------------------- screens

  /**
   * Where the QR code lands. The member number is asked first now, because
   * knowing who is at the table is what lets every screen after this one speak
   * to them by name - and because it is the one answer a guest can give before
   * they have decided anything.
   */
  function screenWelcome() {
    var tag = state.boot.tag;
    return tag
      ? html`<div class="wherecard">${raw(art('runner', { size: 26 }))} ${t('guest.where.at')} <strong>&nbsp;${tag.label}</strong></div>`
      : html`<div class="wherecard is-unknown">${t('guest.where.unknown')}</div>`;
  }

  /**
   * The fork: pasta or pizza. It sits after the member step so it can greet
   * the party by name, which is the whole reason for the reorder - an empty
   * "What are we making?" is a form, and "Buonasera, Compofelice Party!" is a
   * welcome.
   */
  function screenLane() {
    var m = state.member;
    var greeting = m && m.status === 'verified' && m.message ? m.message : '';

    return html`
      <div class="hero">
        ${raw(greeting
          ? '<p class="hero-org">' + escapeHtml(greeting) + '</p>'
          : (state.boot.venue.orgName
            ? '<p class="hero-org">' + escapeHtml(state.boot.venue.orgName) + '</p>'
            : ''))}
        <h1>${t('guest.lane.title')}</h1>
        <p>${nightTagline()}</p>
      </div>

      <div class="lanepick">
        ${kindsTonight().map(function (k) {
          var l = LANES[k];
          return html`<button class="lanetile" type="button" data-act="pickKind" data-id="${k}">
            <span class="lanetile-art">${raw(art(l.art))}</span>
            <span class="lanetile-title">${raw(t(l.titleKey))}</span>
            <span class="lanetile-blurb">${t(l.blurbKey)}</span>
          </button>`;
        })}
      </div>`;
  }

  function screenMember() {
    var digits = state.memberDigits;
    var boxes = [];
    for (var i = 0; i < config.order.maxMemberNumberLength; i += 1) {
      boxes.push(html`<span class="${digits[i] ? 'is-filled' : ''}">${digits[i] || ''}</span>`);
    }
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

    return html`
      ${raw(screenWelcome())}
      <div class="langpick" role="group" aria-label="Language / Idioma">
        ${i18n.LANGS.map(function (l) {
          return html`<button class="langpick-opt" type="button" data-act="setLang" data-id="${l.id}"
            lang="${l.id}" aria-pressed="${l.id === t.lang ? 'true' : 'false'}">${l.name}</button>`;
        })}
      </div>
      <div class="step-head">
        <p class="step-kicker">${t('guest.step', { n: 1 })}</p>
        <h1 class="step-title">${t('guest.member.title', { label: memberLabel() })}</h1>
        <p class="step-sub">${t('guest.member.sub')}</p>
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
      </div>

      <ul class="howto">
        <li><span class="n">1</span> ${t('guest.howto.1', { label: memberLabel() })}</li>
        <li><span class="n">2</span> ${t('guest.howto.2')}</li>
        <li><span class="n">3</span> ${t('guest.howto.3')}</li>
        <li><span class="n">4</span> ${t('guest.howto.4')}</li>
      </ul>`;
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
        <span class="tile-meta">${n === 1 ? t('guest.guests.justme') : t('guest.guests.people')}</span>
      </button>`);
    }

    var allergenPanel = state.mode === 'pro' || state.avoid.length > 0
      ? html`<div class="card stack">
          <div>
            <strong>${t('guest.guests.avoidTitle')}</strong>
            <p class="muted" style="margin:4px 0 0">${t('guest.guests.avoidSub')}</p>
          </div>
          <div class="chips">
            ${state.boot.menu.allergens.map(function (a) {
              return html`<button class="chip" type="button" data-act="avoid" data-id="${a.id}"
                aria-pressed="${state.avoid.indexOf(a.id) !== -1 ? 'true' : 'false'}">${a.name}</button>`;
            })}
          </div>
        </div>`
      : html`<button class="btn btn-ghost" type="button" data-act="mode" data-id="pro">
          ${t('guest.guests.allergy')}</button>`;

    return html`
      <div class="step-head">
        <p class="step-kicker">${t('guest.step', { n: 3 })}</p>
        <h1 class="step-title">${t('guest.guests.title')}</h1>
        <p class="step-sub">${t('guest.guests.sub', { unit: lane().one })}</p>
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
        <small>${bowlComplete(b) ? t('guest.tabs.ready') : t('guest.tabs.building')}</small>
      </button>`;
    });

    var stepTabs = steps().map(function (s, i) {
      var done = i < state.buildStep;
      return html`<button class="buildstep ${done ? 'is-done' : ''}" type="button"
        data-act="gotoStep" data-id="${i}" aria-current="${i === state.buildStep ? 'true' : 'false'}">${t(s.labelKey)}</button>`;
    });

    var body;
    if (step.id === 'toppings') body = buildToppings(bowl);
    else if (step.id === 'finish') body = buildFinish(bowl);
    else if (step.id === 'sauces') {
      body = tileGrid(step.group, {
        act: 'toggleSauce', value: bowl.sauces, multi: true,
        blocked: groupRules(step.group, bowl.sauces).blocked,
      });
    } else if (step.id === 'cheeses') {
      body = tileGrid(step.group, {
        act: 'toggleCheese', value: bowl.cheeses, multi: true,
        blocked: groupRules(step.group, bowl.cheeses).blocked,
      });
    } else if (SINGLE_INTO_ARRAY[step.group]) {
      var field = SINGLE_INTO_ARRAY[step.group];
      body = tileGrid(step.group, {
        act: 'pickOne', value: (bowl[field] || [])[0], multi: false,
      });
    } else if (step.id === 'proteins') {
      body = tileGrid(step.group, { act: 'toggleProtein', value: bowl.proteins, multi: true });
    } else {
      body = tileGrid(step.group, {
        act: 'pick', value: bowl[step.id], multi: false,
      });
    }

    var sub = step.subKey ? t(step.subKey) : '';
    if (step.id === 'toppings') {
      sub = t('guest.step.toppings.sub', { n: toppingAdvice() });
    }
    if (step.id === 'proteins') {
      sub = bowl.proteins.length
        ? t('guest.protein.chosen', { n: bowl.proteins.length })
        : t('guest.step.protein.sub');
    }
    if (step.id === 'sauces') {
      sub = amountSub(step.group, bowl.sauces, 'sauce', 'sauces',
        t('guest.sauce.one'));
    }
    if (step.id === 'cheeses') {
      sub = amountSub(step.group, bowl.cheeses, 'cheese', 'cheeses',
        t('guest.cheese.one'));
    }

    // The burger so far, assembling as they tap. Only the burger lane has it:
    // a bowl is a bowl from above and a stack drawing says nothing useful.
    var hero = state.kind === 'burger'
      ? html`<div class="bstack-wrap">${raw(burgerStackSvg(bowl))}</div>`
      : '';

    return html`
      <div class="bowltabs">${tabs}</div>
      ${raw(hero)}
      <div class="step-head">
        <p class="step-kicker">${lane().one[0].toUpperCase() + lane().one.slice(1)} ${state.activeBowl + 1} of ${state.bowls.length} &middot; ${bowl.guestLabel}</p>
        <h1 class="step-title">${t(step.titleKey)}</h1>
        <p class="step-sub">${sub}</p>
      </div>
      <div class="buildsteps">${stepTabs}</div>
      ${raw(body)}`;
  }

  /**
   * What the kitchen suggests, which is not what the kitchen allows.
   *
   * There is no cap. This number is shown as advice and never enforced, here
   * or in menu.validateLine() - the two agreeing matters more than either
   * number, because a screen that lets a guest build something the validator
   * then rejects is the worst outcome available.
   */
  function toppingAdvice() {
    return state.boot.limits.toppingAdvice;
  }

  /** True for a pizza topping that goes on after the oven, so costs no slot. */
  function isPostBake(id) {
    return state.kind === 'pizza' && Boolean((item('pizzaToppings', id) || {}).postBake);
  }

  /** Only the toppings that actually take up room on the pie in the oven. */
  function bakedToppings(bowl) {
    return (bowl.toppings || []).filter(function (id) { return !isPostBake(id); });
  }

  function buildToppings(bowl) {
    // The group comes from the lane's own step list. Guessing it from a
    // pizza-or-not check was fine while there were two lanes and put pasta
    // toppings on a burger the moment there were three.
    var group = (GROUPS_FOR[state.kind] || {}).toppings || 'toppings';
    var grid = tileGrid(group, { act: 'toggleTopping', value: bowl.toppings, multi: true, small: true });

    // A running count only, with no ceiling to run into. The advice lives in
    // the step subtitle; repeating it here as "7 of 10" would read like a
    // limit, which is the one thing it must not read like.
    var chosen = bowl.toppings.length
      ? html`<p class="muted" style="margin-top:12px">${t('guest.toppings.chosen', { n: bowl.toppings.length })}</p>`
      : '';

    return html`${raw(grid)}${raw(chosen)}`;
  }

  /**
   * Who the dish is for, and anything the kitchen needs to know.
   *
   * On screen always, for every kind. It used to be folded behind an "Add a
   * note" chip in simple mode, which meant the usual path through the app
   * produced a ticket labelled "Guest 3" - and a runner carrying four plates
   * to a table of eight cannot do anything with that.
   *
   * The note box has no placeholder on purpose. It used to suggest birthdays,
   * seat numbers and timing, and the club does not want those reaching the
   * kitchen at all - that is a conversation with a server, not a line on a
   * chit the expo reads at a glance.
   */
  function detailPanel(bowl) {
    return html`<div class="card stack" style="margin-top:22px">
      <div class="field">
        <label for="whoName">${t('guest.who.label', { unit: lane().one })}</label>
        <input class="input" id="whoName" type="text" maxlength="24" value="${bowl.guestLabel}"
          data-act="setName" placeholder="${t('guest.who.name')}">
      </div>
      <div class="field">
        <label for="bowlNotes">${t('guest.who.notes')}</label>
        <textarea class="textarea" id="bowlNotes" maxlength="140" data-act="setNotes">${bowl.notes}</textarea>
      </div>
    </div>`;
  }

  function buildFinish(bowl) {
    // Pasta is the only kind with a size to pick. A pizza is one size and a
    // burger is one burger, so for them this step is the name and note alone.
    var portions = bowl.kind === 'pasta'
      ? tileGrid('portions', { act: 'pick', value: bowl.portion, multi: false })
      : '';
    return html`${raw(portions)}${raw(detailPanel(bowl))}`;
  }

  var estimate = { queueDepth: 0, cookEstimateSec: 0, promiseSec: 0 };

  function screenReview() {
    var bowls = state.bowls.map(function (bowl, i) {
      var isPizza = bowl.kind === 'pizza';
      var isBurger = bowl.kind === 'burger';
      // Groups come from the lane, the same as the build tiles. Guessing them
      // from an is-pizza check printed raw ids on a burger: "with bt_lettuce".
      var bowlGroups = GROUPS_FOR[bowl.kind] || GROUPS_FOR.pasta;
      var glyph = isPizza ? 'pie'
        : isBurger ? 'meatball'
          : (item('pastas', bowl.pasta) || {}).shape || 'none';
      var toppingGroup = bowlGroups.toppings;

      var extras = [];
      if (bowl.toppings.length) {
        extras.push('with ' + bowl.toppings.map(function (t) {
          return (item(toppingGroup, t) || {}).name || t;
        }).join(', '));
      }
      if (isPizza) {
        // What the member picked, not what every pizza used to be.
        extras.push(itemName('pizzaCrusts', bowl.base || 'classic'));
      } else if (isBurger) {
        var bun = item('burgerBuns', bowl.base);
        // The bun goes first - it is the one choice that can make the whole
        // thing gluten free, so it belongs ahead of the toppings, not after.
        if (bun) extras.unshift('on a ' + bun.name);
        if (bowl.sides.length) {
          extras.push('side of ' + bowl.sides.map(function (x) {
            return (item('burgerSides', x) || {}).name || x;
          }).join(', '));
        }
      } else {
        if (bowl.sides.length) {
          extras.push('side of ' + bowl.sides.map(function (x) {
            return (item('sides', x) || {}).name || x;
          }).join(', '));
        }
        var portion = item('portions', bowl.portion);
        if (portion) extras.push(portion.name);
      }
      if (bowl.notes) extras.push('Note: ' + bowl.notes);

      // On review a burger shows the thing itself rather than a badge, so the
      // guest confirms a picture before sending instead of a list of words.
      var artCell = isBurger
        ? html`<span class="bowl-art is-stack">${raw(burgerStackSvg(bowl, { height: 190 }))}</span>`
        : html`<span class="bowl-art">${raw(art(glyph))}</span>`;

      return html`<div class="bowl">
        ${raw(artCell)}
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
        addAll((crustOf(b) || {}).allergens || []);
        entries = entries
          .concat((b.cheeses || []).map(function (c) { return item('pizzaCheeses', c); }));
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
          <textarea class="textarea" id="orderNotes" maxlength="240"
            data-act="setOrderNotes">${state.orderNotes}</textarea>
        </div>`
      : '';

    return html`
      <div class="step-head">
        <p class="step-kicker">${t('guest.step', { n: 4 })}</p>
        <h1 class="step-title">${t('guest.review.title')}</h1>
        <p class="step-sub">${t('guest.review.sub')}</p>
      </div>
      <div class="stack">
        ${bowls}
        ${raw(allergenRow)}
        <div class="card stack">
          <div class="summary-line"><span>${lane().many[0].toUpperCase() + lane().many.slice(1)}</span><span>${state.bowls.length}</span></div>
          <div class="summary-line"><span>Guests</span><span>${state.guestCount}</span></div>
          <div class="summary-line"><span>Where</span><span>${state.boot.tag ? state.boot.tag.label : 'Takeout'}</span></div>
          <div class="summary-total"><span>Cook time</span><span>${humanMins(estimate.cookEstimateSec)}</span></div>
          <p class="muted" style="margin:0;font-size:14px">${memberLabel()} ${state.memberDigits}</p>
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
    var tr = t;
    var TRACK = trackFor(ticket.kind);
    var stepIndex = TRACK.findIndex(function (seg) { return seg.status === ticket.status; });
    if (stepIndex < 0) stepIndex = 0;

    var segs = TRACK.map(function (seg, i) {
      var cls = i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : '';
      return html`<div class="track-seg ${cls}"></div>`;
    });
    var labels = TRACK.map(function (seg, i) {
      return html`<span class="${i === stepIndex ? 'is-now' : ''}">${tr(seg.key)}</span>`;
    });

    var headline, note;
    if (ticket.status === 'queued') {
      headline = t('guest.sent.queued');
      note = 'A cook will pick it up in a moment.';
    } else if (ticket.status === 'cooking') {
      headline = t('guest.sent.cookingSub');
      note = t('guest.sent.queuedSub');
    } else if (ticket.status === 'ready') {
      headline = t('guest.sent.ready');
      note = 'A runner is bringing it to ' + ticket.tagLabel + '.';
    } else if (ticket.status === 'delivered') {
      headline = t('guest.sent.delivered');
      note = t('guest.sent.deliveredSub');
    } else {
      headline = t('guest.sent.cooking');
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

    if (s === 'lane') {
      // The two lane tiles are the call to action; a primary button here would
      // just be a third thing to read. Back only, to fix a mistyped number.
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="member">Back</button>`;
    } else if (s === 'member') {
      // The first screen now, so there is nowhere to go back to - and any
      // length from one digit up is a real member number.
      var ready = state.memberDigits.length >= 1;
      parts = html`
        <button class="btn btn-primary btn-lg btn-block" type="button" data-act="submitMember"
          ${raw(ready && !state.busy ? '' : 'disabled')}>${state.busy ? t('guest.member.checking') : 'Next'}</button>`;
    } else if (s === 'guests') {
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="go" data-id="lane">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="startBuilding">
          Build ${state.guestCount} ${state.guestCount === 1 ? lane().one : lane().many}</button>`;
    } else if (s === 'build') {
      var bowl = currentBowl();
      var step = steps()[state.buildStep];
      // The finish step only gates on a size, and only pasta has one.
      var chosen = step.id === 'toppings' || step.id === 'proteins' ? true
        : step.id === 'finish' ? (bowl.kind !== 'pasta' || Boolean(bowl.portion))
        : step.id === 'sauces' ? bowl.sauces.length > 0
        : step.id === 'cheeses' ? bowl.cheeses.length > 0
        : Boolean(bowl[step.id]);
      var lastStep = state.buildStep === steps().length - 1;
      var lastBowl = state.activeBowl === state.bowls.length - 1;
      var label = !lastStep ? 'Next' : lastBowl ? t('guest.review.reviewOrder') : ('Next ' + lane().one);
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="buildBack">Back</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="buildNext"
          ${raw(chosen ? '' : 'disabled')}>${label}</button>`;
    } else if (s === 'review') {
      parts = html`
        <button class="btn btn-ghost" type="button" data-act="editBowl" data-id="0">Change</button>
        <button class="btn btn-go btn-lg grow" type="button" data-act="send"
          ${raw(state.busy || !allBowlsComplete() ? 'disabled' : '')}>
          ${state.busy ? t('guest.review.sending') : t('guest.review.send')}</button>`;
    } else if (s === 'sent') {
      // Two ways on, and the common one is weighted: another of what they just
      // had. "Something different" throws the build away, so it is the quieter
      // of the two.
      parts = html`
        <button class="btn btn-ghost grow" type="button" data-act="restart">
          ${t('guest.sent.new')}</button>
        <button class="btn btn-primary btn-lg grow" type="button" data-act="again">
          ${t('guest.sent.same')}</button>`;
    }

    footbarInner.innerHTML = parts;
    footbar.hidden = !parts;
  }

  function renderCrumbs() {
    var sequence = ['member', 'lane', 'guests', 'build', 'review'];
    var idx = sequence.indexOf(state.screen);
    crumbs.innerHTML = sequence.map(function (name, i) {
      var cls = idx < 0 ? '' : i < idx ? 'is-done' : i === idx ? 'is-now' : '';
      return '<span class="dot ' + cls + '"></span>';
    }).join('');
    crumbs.hidden = idx < 0;
  }

  // --------------------------------------------------------------------- render

  var SCREENS = {
    member: screenMember,
    lane: screenLane,
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
    document.getElementById('modeLabel').textContent = state.mode === 'pro' ? t('guest.mode.detailed') : t('guest.mode.simple');
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }

  var GROUP_FIELD = {
    pastas: 'pasta', proteins: 'protein', portions: 'portion',
    burgerBuns: 'base', pizzaCrusts: 'base',
  };

  /**
   * Steps that write ONE id into an array field.
   *
   * A burger takes one patty and one basket, but both are stored as arrays so
   * the rest of the app - validateLine, the cost sheet, the close-out - can
   * read them the same way it reads a bowl's. Tapping replaces rather than
   * appends, so the tiles behave like the single choice they are instead of
   * letting a guest build something the review screen will reject.
   */
  var SINGLE_INTO_ARRAY = { burgerPatties: 'proteins', burgerSides: 'sides' };

  /**
   * Swap in whatever the newly chosen base brings with it, and take out what
   * the old one brought.
   *
   * Only ever touches ids the defaults themselves named, so a topping the
   * guest added by hand survives a change of crust. Data-driven from the menu
   * entry rather than a check for "is this the dessert one", so a second
   * pre-filled base is a menu edit and not a code change.
   */
  function applyBaseDefaults(bowl, oldId, newId) {
    if (oldId === newId) return;
    var groupName = (GROUPS_FOR[bowl.kind] || {}).base;
    if (!groupName) return;

    var was = item(groupName, oldId);
    if (was && was.defaults) {
      Object.keys(was.defaults).forEach(function (field) {
        bowl[field] = (bowl[field] || []).filter(function (id) {
          return was.defaults[field].indexOf(id) === -1;
        });
      });
    }

    var now = item(groupName, newId);
    if (now && now.defaults) {
      Object.keys(now.defaults).forEach(function (field) {
        bowl[field] = now.defaults[field].slice();
      });
    }
  }

  /** Move forward through steps, then bowls, then to review. */
  function advance() {
    if (state.buildStep < steps().length - 1) {
      state.buildStep += 1;
      return render();
    }
    if (state.activeBowl < state.bowls.length - 1) {
      state.activeBowl += 1;
      state.buildStep = 0;
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
      state.screen = 'guests';
      render();
    },

    go: function (el) {
      state.screen = el.dataset.id;
      render();
    },

    mode: function (el) {
      state.mode = el.dataset.id;
      remember('mode', state.mode);
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
        var res = await db.lookupMember(state.memberDigits, t.lang);
        state.member = res;
        if (res.status === 'verified' && res.defaultGuests) state.guestCount = res.defaultGuests;
        state.busy = false;
        if (res.status === 'invalid') return render({ keepScroll: true });
        state.screen = afterMember();
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
      render();
    },

    pick: function (el) {
      var field = GROUP_FIELD[el.dataset.group];
      if (!field) return;
      var bowl = currentBowl();
      // A crust can come with a recipe. Dessert Pizza arrives with Nutella,
      // strawberries and powdered sugar already on it, and no savoury sauce
      // or cheese - every one of which the guest can turn off again. Changing
      // crust clears what the last one filled in, so switching back to
      // classic does not leave Nutella on a pepperoni pizza.
      if (field === 'base') applyBaseDefaults(bowl, bowl[field], el.dataset.id);
      bowl[field] = el.dataset.id;
      // Tapping a choice moves you on - fewer buttons for a child to hunt for.
      // Except on the finish step, where the name and the note sit below the
      // tiles: advancing from there carried the guest straight out of a screen
      // they had not filled in, which is how pasta arrived with nobody's name
      // on it.
      if (steps()[state.buildStep].id === 'finish') {
        return render({ keepScroll: true });
      }
      advance();
    },

    pickOne: function (el) {
      var field = SINGLE_INTO_ARRAY[el.dataset.group];
      if (!field) return;
      currentBowl()[field] = [el.dataset.id];
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
      render({ keepScroll: true });
    },

    setLang: function (el) {
      i18n.setLang('guest', el.dataset.id);
    },

    toggleSauce: function (el) {
      var bowl = currentBowl();
      var cap = state.boot.limits.maxSaucesPerBowl;
      var group = state.kind === 'pizza' ? 'pizzaSauces' : 'sauces';
      if (!toggleRuled(bowl, 'sauces', group, el.dataset.id, cap,
        'Up to ' + cap + ' sauces. Tap one to swap it.')) return;
      render({ keepScroll: true });
    },

    toggleCheese: function (el) {
      var bowl = currentBowl();
      var cap = state.boot.limits.maxCheesesPerPizza;
      if (!toggleRuled(bowl, 'cheeses', 'pizzaCheeses', el.dataset.id, cap,
        'Up to ' + cap + ' cheeses. Tap one to swap it.')) return;
      render({ keepScroll: true });
    },

    toggleTopping: function (el) {
      var bowl = currentBowl();
      var id = el.dataset.id;
      var i = bowl.toppings.indexOf(id);
      if (i !== -1) bowl.toppings.splice(i, 1);
      else bowl.toppings.push(id);
      render({ keepScroll: true });
    },

    gotoBowl: function (el) {
      state.activeBowl = Number(el.dataset.id);
      state.buildStep = 0;
      render();
    },

    gotoStep: function (el) {
      state.buildStep = Number(el.dataset.id);
      render();
    },

    buildBack: function () {
      if (state.buildStep > 0) state.buildStep -= 1;
      else if (state.activeBowl > 0) {
        state.activeBowl -= 1;
        state.buildStep = steps().length - 1;
      } else state.screen = 'guests';
      render();
    },

    buildNext: function () { advance(); },

    editBowl: function (el) {
      state.activeBowl = Number(el.dataset.id);
      state.buildStep = 0;
      state.screen = 'build';
      render();
    },

    setName: function (el) {
      currentBowl().guestLabel = el.value.trim() || 'Guest ' + (state.activeBowl + 1);
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
          lang: t.lang,
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

    /**
     * Send the same thing again without rebuilding it.
     *
     * This is the all-you-can-eat case, and it was the obvious missing step: a
     * member who wants a second identical bowl had to walk the whole wizard
     * again to describe something the app already knew. The bowls are still in
     * state - submitting does not consume them - so the only work is to drop
     * the finished ticket and go back to review, where they can change a
     * topping or simply send it.
     */
    again: function () {
      if (state.stopStream) state.stopStream();
      state.order = null;
      state.activeBowl = 0;
      state.buildStep = 0;
      state.screen = 'review';
      render();
      return refreshEstimate().then(function () {
        if (state.screen === 'review') render({ keepScroll: true });
      });
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
      // The same party is still at the same table, so they do not re-enter the
      // number they just typed. Only a guest who never got one is sent back to
      // the keypad. (This said 'member' for one build, which was the lane
      // screen's old name - the comment above was right and the code was not.)
      state.screen = state.member ? 'lane' : 'member';
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
    applyNightChrome();

    var other = i18n.LANGS.filter(function (l) { return l.id !== t.lang; })[0];
    var langBtn = document.getElementById('langSwitch');
    langBtn.textContent = other.short;
    langBtn.setAttribute('aria-label', other.name);
    langBtn.setAttribute('lang', other.id);
    langBtn.addEventListener('click', function () { i18n.setLang('guest', other.id); });
    document.documentElement.setAttribute('lang', t.lang);
    document.title = pageTitle('', nightById(state.night).label);

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
        maxSidesPerBowl: config.order.maxSidesPerBowl,
        maxCheesesPerPizza: config.order.maxCheesesPerPizza,
        maxSidesPerBurger: config.order.maxSidesPerBurger,
        toppingAdvice: config.order.toppingAdvice,
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

    document.title = pageTitle('Order', nightById(state.night).label);
    state.screen = 'member';
    render();

    try {
      await db.ready();
    } catch (err) {
      toast(t('guest.offline'), true);
      return;
    }

    // Locations a manager added since this file was written - the locker
    // room, the halfway house. A code for one cannot resolve at first paint
    // because it exists only in Firestore, and holding every guest behind
    // that read to help the few would be the wrong trade. So the screen
    // paints from the printed tents and corrects itself a moment later; this
    // also means a location renamed mid-service follows without a reload.
    db.watchTags(function () {
      var resolved = tagId ? tagById(tagId) : null;
      var sameAsBefore = (resolved && resolved.id) === (state.boot.tag && state.boot.tag.id);
      if (sameAsBefore) return;
      state.boot.tag = resolved;
      state.boot.tagUnknown = Boolean(tagId && !resolved);
      render();
    });

    // Live 86 list. If the kitchen runs out of shrimp while a guest is mid-build
    // the tile greys out under them, and submitOrder re-checks anyway.
    // Live service night. A manager flipping to Burger Night changes the lane
    // under a guest who is still on the welcome screen, which is the point -
    // nobody should have to reload a phone that is already at the table.
    db.watchServiceNight(function (night) {
      if (night === state.night) return;
      state.night = night;
      applyNightChrome();
      // Anything half-built belongs to the night that is over.
      if (['lane', 'guests', 'build', 'review'].indexOf(state.screen) !== -1) {
        state.kind = null;
        state.bowls = [];
        state.screen = state.member ? afterMember() : 'member';
      }
      render();
    });

    db.watchAvailability(function (list) {
      var was = state.unavailable.join(',');
      state.unavailable = list;
      if (was !== list.join(',') && state.screen === 'build') render({ keepScroll: true });
    });

    if (state.boot.tagUnknown) {
      toast(t('guest.where.badtag'), true);
    }
    if (!state.boot.open) {
      toast(t('guest.closed'), true);
    }
  }

  boot();
})();
