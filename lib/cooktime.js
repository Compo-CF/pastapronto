'use strict';

const menu = require('./menu');

/**
 * Cook-time model. Deliberately explicit so a chef can argue with the numbers
 * and change them in one place.
 *
 * One bowl:
 *   boil(pasta) + finish(sauce) + add(protein) + topping prep + portion extra
 *   ... plus the slowest side, which bakes in parallel with the boil.
 *
 * A whole order is NOT the sum of its bowls: a station boils several pans at
 * once. So we take the slowest bowl, then add a batch penalty for every pan
 * load beyond the station's capacity, plus plating time per bowl.
 */
const MODEL = {
  pansPerStation: 3,
  batchPenaltySec: 120,
  platePerBowlSec: 20,
  // Rough queue drag used only for the guest-facing promise, not the SLA.
  queueDragPerOrderSec: 45,
  minPromiseSec: 240,
};

/** Seconds of active cooking for a single bowl. */
function bowlCookSec(line) {
  const pasta = menu.find('pastas', line.pasta);
  const sauce = menu.find('sauces', line.sauce);
  const protein = menu.find('proteins', line.protein);
  const portion = menu.find('portions', line.portion) || menu.find('portions', 'regular');

  let sec = 0;
  sec += pasta ? pasta.boilSec : 480;
  sec += sauce ? sauce.finishSec : 60;
  sec += protein ? protein.addSec : 0;
  sec += portion.extraSec;
  // Toppings that need heat/prep; cold garnishes are 0.
  sec += (line.toppings || []).reduce((acc, id) => {
    const t = menu.find('toppings', id);
    return acc + (t ? t.addSec : 0);
  }, 0);
  // Sides go in the oven alongside the boil, so only the slowest one can
  // become the binding constraint.
  const slowestSide = (line.sides || []).reduce((acc, id) => {
    const s = menu.find('sides', id);
    return Math.max(acc, s ? s.cookSec : 0);
  }, 0);
  return Math.max(sec, slowestSide);
}

/** Seconds of cooking for the whole order, measured from ACCEPT. */
function orderCookSec(lines) {
  if (!lines || lines.length === 0) return 0;
  const each = lines.map(bowlCookSec);
  const slowest = Math.max(...each);
  const panLoads = Math.ceil(lines.length / MODEL.pansPerStation);
  const batch = (panLoads - 1) * MODEL.batchPenaltySec;
  const plating = lines.length * MODEL.platePerBowlSec;
  return slowest + batch + plating;
}

/**
 * What we tell the guest: cook time plus however long the queue ahead of them
 * is likely to take. Kept separate from the kitchen SLA on purpose - the
 * kitchen is graded on cook time, not on how busy the room was.
 */
function promiseSec(lines, queueDepth = 0) {
  const cook = orderCookSec(lines);
  const drag = Math.max(0, queueDepth) * MODEL.queueDragPerOrderSec;
  return Math.max(MODEL.minPromiseSec, cook + drag);
}

/** Per-bowl breakdown, used by the admin screen to explain an estimate. */
function explain(lines) {
  return {
    bowls: lines.map((l) => ({
      guest: l.guestLabel,
      dish: menu.describe(l),
      cookSec: bowlCookSec(l),
    })),
    panLoads: Math.ceil(lines.length / MODEL.pansPerStation),
    orderCookSec: orderCookSec(lines),
    model: MODEL,
  };
}

module.exports = { MODEL, bowlCookSec, orderCookSec, promiseSec, explain };
