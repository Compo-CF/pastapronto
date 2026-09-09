'use strict';

const { config, tagById, serviceDate, isOpen } = require('./config');
const menu = require('./menu');
const members = require('./members');
const cooktime = require('./cooktime');
const { store, STATUS, LIVE_STATUSES } = require('./store');
const { seedDemo } = require('./seed');
const bus = require('./bus');
const { json, fail, readJson, lanAddresses } = require('./http');

/** Shape an order for the guest: no other table's data, no staff names. */
function publicOrder(order) {
  return {
    id: order.id,
    ticketNo: order.ticketNo,
    claimCode: order.claimCode,
    status: order.status,
    tagLabel: order.tagLabel,
    guestCount: order.guestCount,
    submittedAt: order.submittedAt,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
    cookEstimateSec: order.cookEstimateSec,
    promiseSec: order.promiseSec,
    promisedReadyAt: order.promisedReadyAt,
    totalPrice: order.totalPrice,
    lines: order.lines.map((l) => ({
      lineId: l.lineId, guestLabel: l.guestLabel, dish: l.dish,
      toppings: l.toppings, sides: l.sides, portion: l.portion,
      spice: l.spice, notes: l.notes, price: l.price,
    })),
  };
}

/** Shape an order for the kitchen: everything, plus the buttons to show. */
function kitchenOrder(order) {
  return { ...order, allowedActions: store.allowedActions(order) };
}

async function handle(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  // ------------------------------------------------------------- bootstrap
  if (method === 'GET' && path === '/api/bootstrap') {
    const tag = url.searchParams.get('tag');
    return json(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      venue: config.venue,
      serviceDate: serviceDate(),
      open: isOpen(),
      limits: {
        maxGuests: config.order.maxGuests,
        maxToppingsPerBowl: config.order.maxToppingsPerBowl,
        maxSidesPerBowl: config.order.maxSidesPerBowl,
      },
      sla: config.sla,
      stations: config.kitchen.stations,
      tag: tag ? tagById(tag) : null,
      tagUnknown: Boolean(tag && !tagById(tag)),
      menu: menu.catalog(),
    });
  }

  // ------------------------------------------------------------ member lookup
  if (method === 'POST' && path === '/api/members/lookup') {
    const body = await readJson(req);
    const result = members.lookup(body.memberNumber);
    return json(res, result.status === 'invalid' ? 422 : 200, { ok: result.status !== 'invalid', ...result });
  }

  // ---------------------------------------------------------------- estimate
  if (method === 'POST' && path === '/api/estimate') {
    const body = await readJson(req);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const depth = store.queueDepth();
    return json(res, 200, {
      ok: true,
      queueDepth: depth,
      cookEstimateSec: cooktime.orderCookSec(lines),
      promiseSec: cooktime.promiseSec(lines, depth),
      breakdown: cooktime.explain(lines),
      subtotal: Math.round(lines.reduce((a, l) => a + menu.priceFor(l), 0) * 100) / 100,
    });
  }

  // ------------------------------------------------------------ create order
  if (method === 'POST' && path === '/api/orders') {
    if (!isOpen()) return fail(res, 409, 'The pasta station is closed right now.');
    const body = await readJson(req);
    try {
      const order = store.submit(body, { userAgent: req.headers['user-agent'] });
      return json(res, 201, { ok: true, order: publicOrder(order) });
    } catch (err) {
      if (err.code === 'VALIDATION') return fail(res, 422, 'Please fix these first', { errors: err.errors });
      throw err;
    }
  }

  // ------------------------------------------------------------- guest ticket
  const guestMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)$/);
  if (method === 'GET' && guestMatch) {
    const order = store.get(guestMatch[1]);
    if (!order) return fail(res, 404, 'Ticket not found');
    const full = url.searchParams.get('view') === 'kitchen';
    return json(res, 200, { ok: true, order: full ? kitchenOrder(order) : publicOrder(order) });
  }

  // ------------------------------------------------------------- kitchen list
  if (method === 'GET' && path === '/api/kitchen/orders') {
    const station = url.searchParams.get('station') || undefined;
    const scope = url.searchParams.get('scope') || 'live';
    const statuses = scope === 'all' ? undefined : LIVE_STATUSES;
    const orders = store.list({ statuses, station }).map(kitchenOrder);
    return json(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      serviceDate: serviceDate(),
      orders,
      counts: store.metrics().counts,
    });
  }

  // -------------------------------------------------------------- transitions
  const transitionMatch = path.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/transition$/);
  if (method === 'POST' && transitionMatch) {
    const body = await readJson(req);
    try {
      const order = store.transition(transitionMatch[1], body.action, {
        actor: body.actor || 'kitchen',
        note: body.note,
      });
      return json(res, 200, { ok: true, order: kitchenOrder(order) });
    } catch (err) {
      if (err.code === 'NOT_FOUND') return fail(res, 404, 'Order not found');
      if (err.code === 'BAD_ACTION') return fail(res, 400, err.message);
      if (err.code === 'ILLEGAL_TRANSITION') {
        return fail(res, 409, err.message, { status: err.status, allowed: err.allowed });
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ metrics
  if (method === 'GET' && path === '/api/metrics') {
    return json(res, 200, { ok: true, metrics: store.metrics(url.searchParams.get('date') || undefined) });
  }

  // --------------------------------------------------------------------- tags
  if (method === 'GET' && path === '/api/tags') {
    const hostHeader = req.headers.host || ('localhost:' + config.port);
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const lan = lanAddresses();
    const preferred = lan.length > 0 ? proto + '://' + lan[0].address + ':' + config.port : proto + '://' + hostHeader;
    return json(res, 200, {
      ok: true,
      requestBase: proto + '://' + hostHeader,
      lanBase: preferred,
      lanAddresses: lan,
      tags: config.tags.map((t) => ({ ...t, path: '/t/' + t.id })),
    });
  }

  // --------------------------------------------------------------------- demo
  if (method === 'POST' && path === '/api/demo/seed') {
    const count = seedDemo(store);
    return json(res, 200, { ok: true, live: count });
  }
  if (method === 'POST' && path === '/api/demo/reset') {
    store.reset();
    return json(res, 200, { ok: true });
  }

  // ------------------------------------------------------------ event stream
  if (method === 'GET' && path === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write('event: hello\ndata: ' + JSON.stringify({ serverTime: new Date().toISOString() }) + '\n\n');

    // Only stream events this client cares about. A guest watching their own
    // ticket must not receive the whole room's traffic.
    const watchOrder = url.searchParams.get('order');
    const relevant = (event) => {
      if (!watchOrder) return true;
      const id = event.payload && event.payload.order && event.payload.order.id;
      return id === watchOrder;
    };
    const shape = (event) => {
      if (!event.payload || !event.payload.order) return event.payload;
      const order = watchOrder ? publicOrder(event.payload.order) : kitchenOrder(event.payload.order);
      return { ...event.payload, order };
    };

    const unsubscribe = bus.subscribe((event) => {
      if (!relevant(event)) return;
      res.write('id: ' + event.seq + '\n');
      res.write('event: ' + event.type + '\n');
      res.write('data: ' + JSON.stringify(shape(event)) + '\n\n');
    });

    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    const cleanup = () => { clearInterval(ping); unsubscribe(); };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return true;
  }

  return false; // not an API route
}

module.exports = { handle, publicOrder, kitchenOrder, STATUS };
