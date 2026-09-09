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
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, where, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { firebaseConfig, isConfigured } from './firebase-config.js';
import { config, serviceDate, tagById } from './config.js';
import * as order from './order.js';
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

// ------------------------------------------------------------------- members

/**
 * Resolve a member number against the `members` collection.
 *
 * An unrecognised number is accepted as 'unverified' rather than refused: a
 * child mistyping a digit should still be able to eat, and the kitchen sees the
 * flag on the chit.
 */
export async function lookupMember(raw) {
  const memberNumber = String(raw || '').trim();

  if (!config.order.memberNumberPattern.test(memberNumber)) {
    return { status: 'invalid', memberNumber, message: 'Member numbers are 4 to 6 digits.' };
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
      message: `Welcome back, ${hit.name || 'friend'}!`,
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
export async function submitOrder(draft, { tagId } = {}) {
  await ready();

  const errors = order.validateDraft(draft, config);
  if (errors.length) {
    throw Object.assign(new Error('Order failed validation'), { code: 'VALIDATION', errors });
  }

  const date = serviceDate();
  const tag = tagId ? tagById(tagId) : null;

  // Station load and queue depth come from what is already on the rail.
  const live = await getDocs(query(ordersCol, where('serviceDate', '==', date)));
  const stationLoad = {};
  let queueDepth = 0;
  live.forEach((snap) => {
    const o = snap.data();
    if (['queued', 'cooking'].includes(o.status)) {
      stationLoad[o.station] = (stationLoad[o.station] || 0) + 1;
      queueDepth += 1;
    }
  });

  const ref = doc(ordersCol);
  const counterRef = doc(db, 'counters', date);

  const created = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const lastTicket = counterSnap.exists() ? (counterSnap.data().lastTicket || 0) : 0;
    const ticketNo = lastTicket + 1;

    const built = order.buildOrder(draft, {
      ticketNo,
      claimCode: order.claimCode(),
      station: order.pickStation(config.kitchen.stations, stationLoad),
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

/** One-shot read of a service day, for metrics. */
export async function getDay(date = serviceDate()) {
  await ready();
  const snap = await getDocs(query(ordersCol, where('serviceDate', '==', date)));
  return snap.docs.map(toOrder);
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
 * Write a batch of demo orders straight in, backdated so the kitchen rail opens
 * with a believable mix. Bypasses submitOrder because these need timestamps in
 * the past and specific statuses.
 */
export async function seedOrders(built) {
  await ready();
  const date = serviceDate();

  // Push the ticket counter past whatever we are about to write.
  const maxTicket = built.reduce((a, o) => Math.max(a, o.ticketNo), 0);
  await setDoc(doc(db, 'counters', date), { lastTicket: maxTicket, serviceDate: date }, { merge: true });

  await Promise.all(built.map((o) => {
    const ref = doc(ordersCol);
    return setDoc(ref, { ...o, serviceDate: date, createdBy: uid(), demo: true });
  }));
  return built.length;
}

/** Delete today's orders and reset ticket numbering. Manager screen only. */
export async function resetDay() {
  await ready();
  const date = serviceDate();
  const snap = await getDocs(query(ordersCol, where('serviceDate', '==', date)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await setDoc(doc(db, 'counters', date), { lastTicket: 0, serviceDate: date }, { merge: true });
  return snap.size;
}

export { db, auth };
