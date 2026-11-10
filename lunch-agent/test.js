import assert from 'node:assert/strict';
import { buildMessage, addDays, todayIn } from './send-lunch.js';

const m = (d) => buildMessage(d);

// Tue night -> Wed menu
assert.match(m('2026-11-10'), /Wed, Nov 11[\s\S]*Turkey Pot Pie[\s\S]*Veg: Buffalo Cauliflower/);
// Sunday night -> Monday menu
assert.match(m('2026-11-15'), /Mon, Nov 16[\s\S]*Spaghetti and Meatballs/);
// Friday and Saturday nights -> silent
assert.equal(m('2026-11-13'), null);
assert.equal(m('2026-11-14'), null);
// Early release
assert.match(m('2026-11-19'), /Fri, Nov 20: Early Release/);
// Thanksgiving week: one notice Sunday night, then silence
assert.match(m('2026-11-22'), /No school Mon, Nov 23[\s\S]*resumes Mon, Nov 30/);
for (const d of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) assert.equal(m(d), null, d);
// Sunday after break -> Monday 30 menu, plus reminder that December is not loaded
assert.match(m('2026-11-29'), /Cheese Tortellini[\s\S]*Reminder: the 2026-12 menu is not loaded/);
// Mon Nov 30 night -> Dec 1, no file
assert.match(m('2026-11-30'), /no menu loaded for Tue, Dec 1/);
// date helpers
assert.equal(addDays('2026-11-30', 1), '2026-12-01');
assert.equal(todayIn('America/Chicago', new Date('2026-11-11T01:30:00Z')), '2026-11-10'); // 7:30pm CST still the 10th
console.log('all lunch tests pass');
