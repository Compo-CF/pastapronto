/**
 * Expo / runner board.
 *
 * Deliberately narrower than the kitchen display: a runner needs the ticket
 * number, the destination, what is on the tray, and one button. Everything
 * else is noise while carrying four bowls.
 */
(function () {
  'use strict';

  var html = PP.html;
  var raw = PP.raw;

  var state = { boot: null, orders: [], sound: PP.recall('expo.sound', false) };

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

  var toastTimer = null;
  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (bad ? ' is-bad' : '');
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  function menuName(group, id) {
    var hit = (state.boot.menu[group] || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.name : id;
  }

  function pastaShape(id) {
    var hit = (state.boot.menu.pastas || []).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.shape : 'none';
  }

  function waitLevel(sec) {
    var sla = state.boot.sla;
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
    var wait = PP.secondsSince(order.readyAt);
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
        <div class="rcard-wait" data-timer="${order.id}">${PP.mmss(wait)}</div>
      </div>
      ${raw(alert)}
      <div class="rcard-items">
        ${order.lines.map(function (line) {
          return html`<div class="rcard-item">
            ${raw(Art.art(pastaShape(line.pasta)))}
            <span><b>${line.guestLabel}</b> ${line.dish}</span>
          </div>`;
        })}
      </div>
      <button class="rcard-go" data-act="deliver" data-id="${order.id}">Delivered to ${order.tagLabel}</button>
    </article>`;
  }

  function renderNextCard(order) {
    var cooking = PP.secondsSince(order.acceptedAt);
    var remaining = (order.cookEstimateSec || 0) - cooking;
    return html`<div class="ncard">
      <span class="ncard-no">#${order.ticketNo}</span>
      <span class="ncard-where">${order.tagLabel}<br><small class="rcard-sub">${order.lines.length} bowls</small></span>
      <span class="ncard-eta ${remaining < 0 ? 'is-over' : ''}" data-eta="${order.id}">${remaining < 0 ? 'over ' + PP.mmss(-remaining) : PP.mmss(remaining)}</span>
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
    el.clock.textContent = PP.clockTime();
    readyOrders().forEach(function (order) {
      var node = document.querySelector('[data-timer="' + order.id + '"]');
      if (!node) return;
      var wait = PP.secondsSince(order.readyAt);
      node.textContent = PP.mmss(wait);
      var card = node.closest('.rcard');
      if (card) card.dataset.late = waitLevel(wait);
    });
    cookingOrders().forEach(function (order) {
      var node = document.querySelector('[data-eta="' + order.id + '"]');
      if (!node) return;
      var remaining = (order.cookEstimateSec || 0) - PP.secondsSince(order.acceptedAt);
      node.textContent = remaining < 0 ? 'over ' + PP.mmss(-remaining) : PP.mmss(remaining);
      node.classList.toggle('is-over', remaining < 0);
    });
  }

  function upsert(order) {
    var i = state.orders.findIndex(function (o) { return o.id === order.id; });
    var live = ['queued', 'cooking', 'ready', 'held'].indexOf(order.status) !== -1;
    if (!live) {
      if (i !== -1) state.orders.splice(i, 1);
      return;
    }
    if (i === -1) state.orders.push(order);
    else state.orders[i] = order;
  }

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.preventDefault();
    PP.unlockAudio();
    try {
      var res = await PP.api('/api/orders/' + btn.dataset.id + '/transition', {
        method: 'POST', body: { action: btn.dataset.act, actor: 'runner' },
      });
      upsert(res.order);
      render();
    } catch (err) {
      if (err.status === 409) {
        toast('Another screen already ran that ticket.', true);
        await load();
      } else toast(err.message, true);
    }
  });

  function setSound(on) {
    state.sound = on;
    PP.remember('expo.sound', on);
    el.soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.soundIcon.innerHTML = on ? '&#128266;' : '&#128263;';
    if (on) { PP.unlockAudio(); PP.chime('runner'); }
  }
  el.soundToggle.addEventListener('click', function () { setSound(!state.sound); });

  async function load() {
    var res = await PP.api('/api/kitchen/orders');
    state.orders = res.orders;
    render();
    tick();
  }

  async function boot() {
    document.getElementById('brandMark').innerHTML = Art.art('mark');
    state.boot = await PP.api('/api/bootstrap');
    setSound(state.sound);
    await load();

    PP.stream({
      onEvent: function (type, data) {
        if (type === 'store.reset' || type === 'store.seeded') { load(); return; }
        if (!data || !data.order) return;
        var wasReady = state.orders.some(function (o) {
          return o.id === data.order.id && o.status === 'ready';
        });
        upsert(data.order);
        render();
        if (!wasReady && data.order.status === 'ready') {
          if (state.sound) PP.chime('runner');
          toast('Ticket #' + data.order.ticketNo + ' is up for ' + data.order.tagLabel);
        }
      },
      onStatus: function (s) {
        el.conn.className = 'conn ' + (s === 'live' ? 'is-live' : s === 'down' ? 'is-down' : '');
        el.conn.textContent = s === 'live' ? 'live' : s === 'down' ? 'reconnecting' : 'idle';
      },
    });

    setInterval(tick, 1000);
    setInterval(load, 60000);
  }

  boot().catch(function (err) {
    el.readyGrid.innerHTML = '<div class="lane-empty">Cannot reach the server. ' +
      PP.escapeHtml(err.message) + '</div>';
  });
})();
