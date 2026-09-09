'use strict';

const { config } = require('./config');

/**
 * Stand-in for the club's membership system. In production this is one HTTP
 * call to the POS / CRM; the shape returned here is the contract the rest of
 * the app codes against, so swapping the backing store touches only this file.
 */
const DIRECTORY = [
  { memberNumber: '10432', name: 'Compofelice', tier: 'gold',   dietaryNotes: 'Shellfish allergy on file', defaultGuests: 4 },
  { memberNumber: '20871', name: 'Nakamura',    tier: 'silver', dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '31500', name: 'Okonkwo',     tier: 'gold',   dietaryNotes: 'Gluten free - Sam', defaultGuests: 5 },
  { memberNumber: '44219', name: 'Delgado',     tier: 'bronze', dietaryNotes: '', defaultGuests: 3 },
  { memberNumber: '50077', name: 'Whitfield',   tier: 'silver', dietaryNotes: '', defaultGuests: 2 },
  { memberNumber: '61234', name: 'Petrov',      tier: 'gold',   dietaryNotes: 'No dairy - Ana', defaultGuests: 6 },
];

/**
 * Resolve a member number.
 *
 * Returns { status, memberNumber, name, ... }. An unrecognised number is
 * accepted as 'unverified' when config allows it: a nine-year-old fat-fingering
 * a digit should still be able to eat, and the kitchen can see the flag on the
 * chit and sort it out at the table.
 */
function lookup(raw) {
  const memberNumber = String(raw || '').trim();

  if (!config.order.memberNumberPattern.test(memberNumber)) {
    return {
      status: 'invalid',
      memberNumber,
      message: 'Member numbers are 4 to 6 digits.',
    };
  }

  const hit = DIRECTORY.find((m) => m.memberNumber === memberNumber);
  if (hit) {
    return {
      status: 'verified',
      memberNumber: hit.memberNumber,
      name: hit.name,
      tier: hit.tier,
      dietaryNotes: hit.dietaryNotes,
      defaultGuests: hit.defaultGuests,
      message: 'Welcome back, ' + hit.name + '!',
    };
  }

  if (!config.order.allowUnverifiedMembers) {
    return {
      status: 'not_found',
      memberNumber,
      message: 'We could not find that member number. Ask a server for help.',
    };
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

module.exports = { lookup, DIRECTORY };
