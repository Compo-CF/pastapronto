/**
 * The only file that knows Firestore exists.
 *
 * Replaces what used to be a Node server (REST + Server-Sent Events). The
 * shapes it hands back are identical, so the screens barely changed:
 *
 *   server.js + lib/store.js + lib/api.js  ->  this file
 *   GET /api/stream (SSE)                  ->  onSnapshot listeners
 *   POST /api/orders                       ->  submitOrder() in a transaction
 *   POST /api/orders/:id/transition        ->  transition() in a transaction
 *
 * Firestore layout
 *   orders/{orderId}         one document per order, the whole chit
 *   counters/{serviceDate}   { lastTicket } - allocates human ticket numbers
 *   members/{memberNumber}   { name, tier, dietaryNotes, defaultGuests }
 *   config/availability      { unavailable: [ingredientId] } - the 86 list
 *
 * Every screen listens to "today's orders" with a single-field query and does
 * its own filtering and sorting in memory. A service day is tens to a few
 * hundred documents, so this is cheap, and it means no composite indexes to
 * deploy and keep in sync.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseConfig, isConfigured } from './firebase-config.js';
import { config, serviceDate, tagById } from './config.js';
import * as order from './order.js';
import * as menu from './menu.js';
import { noteClockSkew } from './ui.js';

export { isConfigured };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Offline-first: an IndexedDB cache means a guest on hotel wifi can still send
// an order (it queues and syncs), and the kitchen rail survives a blip.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

/**
 * Local development against `firebase emulators:start`.
 *
 * Guarded twice on purpose - it only engages on localhost AND when the project
 * id is a `demo-` one, which the emulator suite reserves and a real project can
 * never be. A production deploy cannot fall into this branch.
 */
if (
  typeof location !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(location.hostname)
  && firebaseConfig.projectId.startsWith('demo-')
) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  console.info('[db] using the local Firebase emulators');
}

const ordersCol = collection(db, 'orders');
const availabilityRef = doc(db, 'config', 'availability');

/** Resolves once we have an anonymous identity, which the rules require. */
let readyPromise = null;
export function ready() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
      signInAnonymously(auth).catch(reject);
    });
  }
  return readyPromise;
}

export const uid = () => (auth.currentUser ? auth.currentUser.uid : null);

/**
 * Normalise a Firestore document into the plain order object the rest of the
 * app expects, and opportunistically learn this device's clock error.
 */
function toOrder(snap) {
  const data = snap.data();
  if (data && data.submittedAtServer && data.submittedAtServer.toDate) {
    noteClockSkew(data.submittedAt, data.submittedAtServer.toDate());
  }
  return { id: snap.id, ...data };
}

// -------------------------------------------------------------- 86 list

/**
 * Live feed of what the kitchen has run out of ("86'd", from the line-cook
 * shorthand). One document, watched by every screen, so a manager toggling
 * shrimp off greys it out on every guest's phone within a moment.
 *
 * @param {(unavailable: string[]) => void} cb
 * @returns {() => void} unsubscribe
 */
export function watchAvailability(cb, { onError } = {}) {
  return onSnapshot(
    availabilityRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      cb(data && Array.isArray(data.unavailable) ? data.unavailable : []);
    },
    (err) => {
      console.error('[db] watchAvailability failed:', err.code, err.message);
      // Failing open is the right call: a screen that cannot read the 86 list
      // should still take orders, and validateDraft re-checks on submit.
      cb([]);
      if (onError) onError(err);
    },
  );
}

/** Replace the 86 list. Manager screen only. */
export async function setUnavailable(ids) {
  await ready();
  await setDoc(availabilityRef, {
    unavailable: [...new Set(ids)],
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  }, { merge: true });
  return ids.length;
}

/** One read of the 86 list, for the submit-time re-check. */
export async function getUnavailable() {
  await ready();
  try {
    const snap = await getDoc(availabilityRef);
    const data = snap.exists() ? snap.data() : null;
    return data && Array.isArray(data.unavailable) ? data.unavailable : [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------- members

/**
 * Resolve a member number against the `members` collection.
 *
 * An unrecognised number is accepted as 'unverified' rather than refused: a
 * child mistyping a digit should still be able to eat, and the kitchen sees the
 * flag on the chit.
 */
export async function lookupMember(raw) {
  // One member is one document id, whatever the guest typed - 0002 and 2 both
  // read members/2.
  const memberNumber = order.normalizeMemberNumber(raw);

  if (!memberNumber) {
    return {
      status: 'invalid',
      memberNumber: String(raw || '').trim(),
      message: 'Member numbers are 1 to 4 digits.',
    };
  }

  let hit = null;
  try {
    const snap = await getDoc(doc(db, 'members', memberNumber));
    if (snap.exists()) hit = snap.data();
  } catch {
    // Offline or rules refused: fall through to unverified rather than
    // stranding the guest at a keypad.
  }

  if (hit) {
    return {
      status: 'verified',
      memberNumber,
      name: hit.name || '',
      tier: hit.tier || 'member',
      dietaryNotes: hit.dietaryNotes || '',
      defaultGuests: hit.defaultGuests || 2,
      // The directory holds family names, not people, so the greeting is
      // addressed to the party rather than to an individual.
      message: hit.name ? `Buonasera, ${hit.name} Party!` : 'Buonasera!',
    };
  }

  if (!config.order.allowUnverifiedMembers) {
    return { status: 'not_found', memberNumber, message: 'We could not find that member number.' };
  }

  return {
    status: 'unverified',
    memberNumber,
    name: '',
    tier: 'guest',
    dietaryNotes: '',
    defaultGuests: 2,
    message: 'We will pass this to your server to confirm.',
  };
}

// -------------------------------------------------------------------- orders

/**
 * Create an order. The ticket number and the document are written in one
 * transaction, so two phones ordering at the same instant cannot collide on a
 * number - one of them simply retries and takes the next.
 */
export async function submitOrder(draft, { tagId, queueDepth = 0 } = {}) {
  await ready();

  // Re-check the 86 list at submit. A phone that has had the review screen open
  // for ten minutes may be offering something the kitchen has since run out of.
  const unavailable = await getUnavailable();
  const errors = order.validateDraft(draft, config, unavailable);
  if (errors.length) {
    throw Object.assign(new Error('Order failed validation'), { code: 'VALIDATION', errors });
  }

  const date = serviceDate();
  const tag = tagId ? tagById(tagId) : null;
  // Pasta and pizza are cooked by different people on different equipment, so
  // the kind decides which pool of stations this ticket can land on.
  const kind = menu.kindOf((draft.lines || [])[0] || {});
  const ref = doc(ordersCol);
  const counterRef = doc(db, 'counters', date);

  // Note there is no read outside the transaction. Station assignment is
  // derived from the ticket number, and the queue depth used for the guest's
  // promise is passed in by whoever already had it on screen. Placing an order
  // is the one path that must never stall, and every read is a chance to.
  const created = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const lastTicket = counterSnap.exists() ? (counterSnap.data().lastTicket || 0) : 0;
    const ticketNo = lastTicket + 1;

    const built = order.buildOrder(draft, {
      ticketNo,
      claimCode: order.claimCode(),
      station: order.stationForTicket(
        ticketNo, config.kitchen.stations, config.kitchen.autoAssignStations, kind,
      ),
      queueDepth,
      tag,
      serviceDate: date,
      now: new Date(),
    });

    tx.set(counterRef, { lastTicket: ticketNo, serviceDate: date }, { merge: true });
    tx.set(ref, {
      ...built,
      // Firestore's own clock, used to correct device clock skew on the chits.
      submittedAtServer: serverTimestamp(),
      createdBy: uid(),
    });
    return built;
  });

  return { id: ref.id, ...created };
}

/**
 * Advance or undo a chit. Read-modify-write inside a transaction, so the state
 * machine is enforced against the *current* server state: if another screen
 * already moved this order, this throws ILLEGAL_TRANSITION instead of
 * clobbering their work. This is the Firestore equivalent of the old 409.
 */
export async function transition(orderId, action, { actor = 'kitchen', note = '' } = {}) {
  await ready();
  const ref = doc(db, 'orders', orderId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      throw Object.assign(new Error('Order not found'), { code: 'NOT_FOUND' });
    }
    const current = { id: snap.id, ...snap.data() };
    const patch = order.transitionPatch(current, action, { actor, note, sla: config.sla });
    tx.update(ref, patch);
    return { ...current, ...patch };
  });
}

// ----------------------------------------------------------------- listeners

/**
 * Live feed of today's orders. This is what replaced the SSE stream: Firestore
 * pushes a new snapshot to every screen within a few hundred milliseconds of a
 * write, with no server in the middle.
 *
 * @param {(orders: object[]) => void} cb
 * @returns {() => void} unsubscribe
 */
export function watchToday(cb, { onError } = {}) {
  const q = query(ordersCol, where('serviceDate', '==', serviceDate()));
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs.map(toOrder);
      orders.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
      cb(orders);
    },
    (err) => {
      console.error('[db] watchToday failed:', err.code, err.message);
      if (onError) onError(err);
    },
  );
}

/**
 * Follow one ticket, for the guest's status screen. Scoped to a single document
 * so a guest is never sent the rest of the room's data.
 */
export function watchOrder(orderId, cb, { onError } = {}) {
  return onSnapshot(
    doc(db, 'orders', orderId),
    (snap) => { if (snap.exists()) cb(toOrder(snap)); },
    (err) => {
      console.error('[db] watchOrder failed:', err.code, err.message);
      if (onError) onError(err);
    },
  );
}

export async function getOrder(orderId) {
  await ready();
  const snap = await getDoc(doc(db, 'orders', orderId));
  return snap.exists() ? toOrder(snap) : null;
}

/**
 * One read of a service day.
 *
 * Uses the first snapshot from a listener rather than getDocs(). Observed on a
 * live project: getDocs() on this query stalled indefinitely while the
 * identical query delivered 13 documents through onSnapshot in 3ms. Listeners
 * are the transport that reliably works, so everything reads through them, and
 * a timeout means a stall degrades to an empty result instead of a hang.
 */
export function getDay(date = serviceDate()) {
  return new Promise((resolve, reject) => {
    let unsub = null;
    let done = false;
    let timer = null;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // The callback can fire before onSnapshot() has returned its unsubscribe.
      if (unsub) unsub();
      else queueMicrotask(() => { if (unsub) unsub(); });
      fn(value);
    };

    timer = setTimeout(() => finish(resolve, []), 8000);

    unsub = onSnapshot(
      query(ordersCol, where('serviceDate', '==', date)),
      (snap) => finish(resolve, snap.docs.map(toOrder)),
      (err) => finish(reject, err),
    );
  });
}

// --------------------------------------------------------------- admin tools

/** Seed the member directory. Idempotent - safe to run repeatedly. */
export async function seedMembers(members) {
  await ready();
  await Promise.all(members.map((m) => setDoc(doc(db, 'members', m.memberNumber), {
    name: m.name,
    tier: m.tier,
    dietaryNotes: m.dietaryNotes || '',
    defaultGuests: m.defaultGuests || 2,
  })));
  return members.length;
}

/**
 * Write the demo rail.
 *
 * These orders need to end up mid-cook, plated or delivered, but the security
 * rules deliberately refuse a client that tries to *create* an order in any
 * state but `queued` - otherwise anyone could inject a delivered order with a
 * price they made up. So the seeder does what real service does: create each
 * order as queued, then advance it with updates the rules allow (contents
 * unchanged, audit trail only growing).
 *
 * A backdated `submittedAt` has to be set at create time, because the rules
 * make it immutable afterwards.
 */
export async function seedOrders(built) {
  await ready();
  const date = serviceDate();

  // Push the ticket counter past whatever we are about to write.
  const maxTicket = built.reduce((a, o) => Math.max(a, o.ticketNo), 0);
  await setDoc(doc(db, 'counters', date), { lastTicket: maxTicket, serviceDate: date }, { merge: true });

  let written = 0;
  for (const target of built) {
    const ref = doc(ordersCol);
    try {
      // Phase 1 - create it the way a guest would.
      await setDoc(ref, {
        ...target,
        status: 'queued',
        acceptedAt: null, readyAt: null, deliveredAt: null,
        acceptedBy: null, readyBy: null, deliveredBy: null,
        events: [target.events[0]],
        serviceDate: date,
        createdBy: uid(),
        demo: true,
      });

      // Phase 2 - walk it to its demo state, if it is not simply queued.
      if (target.status !== 'queued' || target.events.length > 1) {
        await updateDoc(ref, {
          status: target.status,
          acceptedAt: target.acceptedAt || null,
          readyAt: target.readyAt || null,
          deliveredAt: target.deliveredAt || null,
          acceptedBy: target.acceptedBy || null,
          readyBy: target.readyBy || null,
          deliveredBy: target.deliveredBy || null,
          priority: target.priority,
          events: target.events,
        });
      }
      written += 1;
    } catch (err) {
      // Name the ticket rather than failing anonymously - a rules rejection
      // here is a real signal, not noise to swallow.
      throw new Error('Seeding ticket #' + target.ticketNo + ' failed: ' + (err.code || err.message));
    }
  }
  return written;
}

/** Delete today's orders and reset ticket numbering. Manager screen only. */
export async function resetDay() {
  await ready();
  const date = serviceDate();
  const todays = await getDay(date);
  await Promise.all(todays.map((o) => deleteDoc(doc(db, 'orders', o.id))));
  await setDoc(doc(db, 'counters', date), { lastTicket: 0, serviceDate: date }, { merge: true });
  return todays.length;
}

export { db, auth };
