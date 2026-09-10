import * as menu from './menu.js';

/**
 * Cook-time model. Deliberately explicit so a chef can argue with the numbers
 * and change them in one place.
 *
 * One bowl:
 *   boil(pasta) + finish(sauces) + add(protein) + topping prep + portion extra
 *   ... plus the slowest side, which bakes in parallel with the boil.
 *
 * Boil times come from PARCOOKED pasta held at the station, so they are
 * finish-to-order times rather than from-dry times.
 *
 * A bowl can take more than one sauce. They go in the same pan, so the cost is
 * the slowest sauce plus a small handling penalty for each extra one - not the
 * sum, which would badly over-quote a half-marinara-half-alfredo bowl.
 *
 * A whole order is NOT the sum of its bowls: a station boils several pans at
 * once. So we take the slowest bowl, then add a batch penalty for every pan
 * load beyond the station's capacity, plus plating time per bowl.
 */
export const MODEL = {
  pansPerStation: 3,
  batchPenaltySec: 120,
  platePerBowlSec: 20,
  extraSaucePenaltySec: 20,
  // Rough queue drag used only for the guest-facing promise, not the SLA.
  queueDragPerOrderSec: 45,
  minPromiseSec: 240,
};

/** Seconds of active cooking for a single bowl. */
export function bowlCookSec(line) {
  const pasta = menu.find('pastas', line.pasta);
  const sauces = menu.saucesOf(line).map((id) => menu.find('sauces', id)).filter(Boolean);
  const protein = menu.find('proteins', line.protein);
  const portion = menu.find('portions', line.portion) || menu.find('portions', 'regular');

  let sec = 0;
  sec += pasta ? pasta.boilSec : 480;
  sec += sauces.length
    ? Math.max(...sauces.map((x) => x.finishSec)) + (sauces.length - 1) * MODEL.extraSaucePenaltySec
    : 60;
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
export function orderCookSec(lines) {
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
export function promiseSec(lines, queueDepth = 0) {
  const cook = orderCookSec(lines);
  const drag = Math.max(0, queueDepth) * MODEL.queueDragPerOrderSec;
  return Math.max(MODEL.minPromiseSec, cook + drag);
}

/** Per-bowl breakdown, used by the admin screen to explain an estimate. */
export function explain(lines) {
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
