'use strict';

/**
 * Tiny pub/sub used to fan store changes out to every connected screen over
 * Server-Sent Events. One process, one bus - swap for Redis pub/sub if you
 * ever run more than one node.
 */
class Bus {
  constructor() {
    this.subscribers = new Set();
    this.seq = 0;
  }

  /** @param {(event: {seq:number,type:string,at:string,payload:any}) => void} fn */
  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(type, payload) {
    this.seq += 1;
    const event = { seq: this.seq, type, at: new Date().toISOString(), payload };
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (err) {
        // A dead socket must never take down the kitchen.
        console.error('[bus] subscriber failed:', err.message);
      }
    }
    return event;
  }

  get size() {
    return this.subscribers.size;
  }
}

module.exports = new Bus();
