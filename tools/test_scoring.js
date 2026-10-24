// Runs the scoring script's feed logic against a made-up payload, with no Google services.
// Usage: node tools/test_scoring.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const api = new Function(src + '\nreturn { publicPayload_, sealAt_, CONFIG };')();

const payload = {
  name: 'Platinum +1 Club',
  contestStart: '2026-10-22T20:26:00Z',
  contestEnd: '2026-11-13T00:20:00Z',
  sealAt: '2026-11-12T00:20:00.000Z',
  days: [{ n: 1 }],
  competitors: ['Jen', 'Kathy', 'Blas'],
  entries: [
    { t: '2026-10-22T20:26:36.661Z', c: 'Kathy', p: -1, r: 'Rolling her eyes' },
    { t: '2026-11-05T09:00:00.000Z', c: 'Blas', p: 2, r: 'Found the corner table' },
    { t: '2026-11-12T00:19:59.000Z', c: 'Jen', p: 1, r: 'Just under the wire' },
    { t: '2026-11-12T00:20:00.000Z', c: 'Jen', p: 2, r: 'At the seal exactly' },
    { t: '2026-11-12T20:00:00.000Z', c: 'Kathy', p: -2, r: 'During the blackout' }
  ]
};

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }

test('the seal is 24 hours before the end', () => {
  assert.strictEqual(api.sealAt_(), '2026-11-12T00:20:00.000Z');
});

test('before the seal, the feed is the whole payload', () => {
  const out = api.publicPayload_(payload, new Date('2026-11-11T12:00:00Z'));
  assert.strictEqual(out, payload);
  assert.strictEqual(out.entries.length, 5);
  assert.strictEqual('held' in out, false);
});

test('during the final 24 hours, rulings from the seal onward are held back', () => {
  const out = api.publicPayload_(payload, new Date('2026-11-12T21:00:00Z'));
  assert.deepStrictEqual(out.entries.map((e) => e.r), ['Rolling her eyes', 'Found the corner table', 'Just under the wire']);
  assert.strictEqual(out.held, 2);
  assert.strictEqual(payload.entries.length, 5, 'the original is untouched');
});

test('the held copy keeps every other field, so the page still shows the countdown', () => {
  const out = api.publicPayload_(payload, new Date('2026-11-12T00:20:00Z'));
  for (const k of ['name', 'contestStart', 'contestEnd', 'sealAt', 'days', 'competitors']) assert.deepStrictEqual(out[k], payload[k], k);
  assert.strictEqual(out.entries.length, 3, 'the seal instant itself is already sealed');
});

test('at takeoff and after, everything is published', () => {
  for (const now of ['2026-11-13T00:20:00Z', '2026-11-13T01:00:00Z', '2026-12-01T00:00:00Z']) {
    const out = api.publicPayload_(payload, new Date(now));
    assert.strictEqual(out.entries.length, 5, now);
    assert.strictEqual('held' in out, false, now);
  }
});

console.log(`\n${passed} tests passed`);
