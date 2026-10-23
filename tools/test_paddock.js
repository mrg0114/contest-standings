// Runs the Paddock Apps Script against in-memory stand-ins for Google's services.
// Usage: node tools/test_paddock.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script-paddock', 'Code.gs'), 'utf8');

function makeEnv(props) {
  const rows = [];
  const logs = [];
  const cache = new Map();
  // A clock that moves one second per "now", so post order is deterministic.
  let clock = Date.UTC(2026, 9, 23, 12, 0, 0);
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else { clock += 1000; super(clock); } }
    static now() { return clock; }
  }
  const sheet = {
    appendRow: (r) => rows.push(r.slice()),
    getLastRow: () => rows.length,
    setFrozenRows: () => {},
    getRange: (row, col, numRows = 1) => ({
      getRow: () => row,
      setValues: (vals) => vals.forEach((v, i) => { rows[row - 1 + i] = v.slice(); }),
      insertCheckboxes: () => { for (let r = row; r < row + numRows; r++) rows[r - 1][col - 1] = rows[r - 1][col - 1] === true; },
      setFontWeight: () => {}
    }),
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) })
  };
  let hasSheet = false;
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: () => (hasSheet ? sheet : null),
        insertSheet: () => { hasSheet = true; return sheet; }
      }),
      flush: () => {}
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    Utilities: { sleep: () => {}, getUuid: () => Math.random().toString(16).slice(2) + 'abcdef' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) },
    UrlFetchApp: { fetch: () => { throw new Error('no network in tests'); } },
    Logger: { log: (s) => logs.push(String(s)) },
    Date: FakeDate
  };
  const names = Object.keys(env);
  const fn = new Function(...names, src + '\nreturn { doGet, doPost, setup, testSamplePosts, testManyPosts };');
  const api = fn(...names.map((n) => env[n]));
  return { api, rows, logs, cache };
}

const page = (api, params) => JSON.parse(api.doGet({ parameter: params || {} }).text);

const PROPS = { FAN_PASSCODE: 'trifecta', JUDGE_PASSCODE: 'gavel', PASSCODE_JEN: 'j1', PASSCODE_KATHY: 'k1', PASSCODE_BLAS: 'b1', PUSH: 'off' };
const post = (api, body) => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const list = (api) => JSON.parse(api.doGet({}).text).posts;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }

test('setup creates the Posts sheet and reports nothing missing', () => {
  const { api, rows, logs } = makeEnv(PROPS);
  api.setup();
  assert.deepStrictEqual(rows[0], ['Id', 'Timestamp', 'Name', 'Role', 'Message', 'Hidden']);
  assert.ok(logs.some((l) => l.includes('All Script Properties are set')));
});

test('wrong passcode is refused and nothing is written', () => {
  const { api, rows } = makeEnv(PROPS);
  api.setup();
  const r = post(api, { passcode: 'nope', name: 'Sue', message: 'hi' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(rows.length, 1);
});

test('fan posts under the typed name; passcode ignores case and spaces', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  const r = post(api, { passcode: '  TriFecta ', name: 'Aunt  Sue', message: 'Go Blas!' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.post.name, 'Aunt Sue');
  assert.strictEqual(r.post.role, 'fan');
  assert.strictEqual(list(api)[0].msg, 'Go Blas!');
});

test('fans cannot use the judge or a competitor name', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  for (const n of ['Paul', 'kathy', 'The Judge']) {
    const r = post(api, { passcode: 'trifecta', name: n, message: 'x' });
    assert.strictEqual(r.ok, false, n);
  }
});

test('judge passcode posts as Paul with the judge role, and logs the push when PUSH is off', () => {
  const { api, logs } = makeEnv(PROPS);
  api.setup();
  const r = post(api, { passcode: 'gavel', name: 'Anyone', message: 'Court is in session.' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.post.name, r.post.role], ['Paul', 'judge']);
  assert.ok(logs.some((l) => l.startsWith('Push is off. Would have sent: The judge has spoken / Court is in session.')));
});

test('competitor passcode fixes the name', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  const r = post(api, { passcode: 'k1', name: 'Paul', message: 'Objection!' });
  assert.deepStrictEqual([r.post.name, r.post.role], ['Kathy', 'competitor']);
});

test('only the judge triggers a notification', () => {
  const { api, logs } = makeEnv(PROPS);
  api.setup();
  post(api, { passcode: 'b1', message: 'hello' });
  post(api, { passcode: 'trifecta', name: 'Sue', message: 'hello' });
  assert.ok(!logs.some((l) => l.includes('Would have sent')));
});

test('empty message and missing fan name are refused', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  assert.strictEqual(post(api, { passcode: 'trifecta', name: 'Sue', message: '   ' }).ok, false);
  assert.strictEqual(post(api, { passcode: 'trifecta', name: ' ', message: 'hi' }).ok, false);
});

test('rate limit: one post per name per 10 seconds', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  assert.strictEqual(post(api, { passcode: 'trifecta', name: 'Sue', message: 'one' }).ok, true);
  const second = post(api, { passcode: 'trifecta', name: 'sue', message: 'two' });
  assert.strictEqual(second.ok, false);
  assert.ok(/One post every 10 seconds/.test(second.error));
});

test('long messages are capped at 500 characters and control characters stripped', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  const r = post(api, { passcode: 'trifecta', name: 'Sue', message: 'a\u0007b' + 'x'.repeat(600) });
  assert.strictEqual(r.post.msg.length, 500);
  assert.ok(r.post.msg.startsWith('abx'));
});

test('a ticked Hidden box removes the post from the list, newest first otherwise', () => {
  const { api, rows } = makeEnv(PROPS);
  api.setup();
  post(api, { passcode: 'trifecta', name: 'Sue', message: 'first' });
  post(api, { passcode: 'b1', message: 'second' });
  assert.deepStrictEqual(list(api).map((p) => p.msg), ['second', 'first']);
  rows[1][5] = true; // moderator ticks Hidden on "first"
  post(api, { passcode: 'k1', message: 'third' }); // posting clears the cache
  assert.deepStrictEqual(list(api).map((p) => p.msg), ['third', 'second']);
});

test('with no passcodes configured, nobody can post', () => {
  const { api } = makeEnv({});
  api.setup();
  assert.strictEqual(post(api, { passcode: '', name: 'Sue', message: 'hi' }).ok, false);
  assert.strictEqual(post(api, { passcode: 'anything', name: 'Sue', message: 'hi' }).ok, false);
});

/* ---------- paging ---------- */

function fill(api, n, start = 0) {
  for (let i = start; i < start + n; i++) {
    const r = post(api, { passcode: 'trifecta', name: 'Fan' + i, message: 'post ' + i });
    assert.strictEqual(r.ok, true);
  }
}

test('first page is the newest 30, with hasMore when there are older posts', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  fill(api, 75);
  const p1 = page(api);
  assert.strictEqual(p1.posts.length, 30);
  assert.strictEqual(p1.posts[0].msg, 'post 74');
  assert.strictEqual(p1.posts[29].msg, 'post 45');
  assert.strictEqual(p1.hasMore, true);
});

test('walking back with the cursor visits every post exactly once', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  fill(api, 75);
  const seen = [];
  let p = page(api);
  seen.push(...p.posts);
  let guard = 0;
  while (p.hasMore && guard++ < 10) {
    const last = p.posts[p.posts.length - 1];
    p = page(api, { before: last.t, beforeId: last.id });
    seen.push(...p.posts);
  }
  assert.strictEqual(seen.length, 75);
  assert.strictEqual(new Set(seen.map((x) => x.id)).size, 75);
  assert.deepStrictEqual(seen.map((x) => x.msg), Array.from({ length: 75 }, (_, i) => 'post ' + (74 - i)));
  assert.strictEqual(p.posts.length, 15);
  assert.strictEqual(p.hasMore, false);
});

test("the judge's latest post is pinned even when it is older than the first page", () => {
  const { api, cache } = makeEnv(PROPS);
  api.setup();
  post(api, { passcode: 'gavel', message: 'old ruling' });
  cache.delete('rate:paul'); // the 10-second window passes
  post(api, { passcode: 'gavel', message: 'latest ruling' });
  fill(api, 40);
  const p1 = page(api);
  assert.ok(!p1.posts.some((x) => x.role === 'judge'));
  assert.strictEqual(p1.pinned.msg, 'latest ruling');
});

test('older pages carry no pin; a hidden judge post falls back to the previous one', () => {
  const { api, rows, cache } = makeEnv(PROPS);
  api.setup();
  post(api, { passcode: 'gavel', message: 'first ruling' });
  cache.delete('rate:paul'); // the 10-second window passes
  post(api, { passcode: 'gavel', message: 'second ruling' });
  const p1 = page(api);
  const last = p1.posts[p1.posts.length - 1];
  assert.strictEqual('pinned' in page(api, { before: last.t, beforeId: last.id }), false);
  rows.find((r) => r[4] === 'second ruling')[5] = true;
  post(api, { passcode: 'trifecta', name: 'Sue', message: 'refresh' }); // clears the cache
  assert.strictEqual(page(api).pinned.msg, 'first ruling');
});

test('posts with the same timestamp are neither skipped nor repeated', () => {
  const { api, rows } = makeEnv(PROPS);
  api.setup();
  const same = new Date('2026-10-23T15:00:00.000Z');
  ['aaa', 'bbb', 'ccc', 'ddd'].forEach((id) => rows.push([id, same, 'Sue', 'fan', 'tie ' + id, false]));
  const seen = [];
  let p = page(api, { limit: '1' });
  seen.push(...p.posts);
  while (p.hasMore) {
    const last = p.posts[p.posts.length - 1];
    p = page(api, { limit: '1', before: last.t, beforeId: last.id });
    seen.push(...p.posts);
  }
  assert.deepStrictEqual(seen.map((x) => x.id), ['ddd', 'ccc', 'bbb', 'aaa']);
});

test('page size is capped at 50, and a bad cursor is treated as the first page', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  fill(api, 60);
  assert.strictEqual(page(api, { limit: '500' }).posts.length, 50);
  const bad = page(api, { before: 'not a date', beforeId: 'x' });
  assert.strictEqual(bad.posts[0].msg, 'post 59');
  assert.ok('pinned' in bad);
});

test('a new post shows up on the next first-page request (cache cleared)', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  fill(api, 3);
  assert.strictEqual(page(api).posts[0].msg, 'post 2'); // now cached
  post(api, { passcode: 'b1', message: 'fresh' });
  assert.strictEqual(page(api).posts[0].msg, 'fresh');
});

test('testManyPosts adds 45 posts that push the sample judge post off the first page but keep it pinned', () => {
  const { api } = makeEnv(PROPS);
  api.setup();
  api.testSamplePosts();
  api.testManyPosts();
  const p1 = page(api);
  assert.strictEqual(p1.posts.length, 30);
  assert.strictEqual(p1.posts[0].msg, 'TEST: paging post 45');
  assert.strictEqual(p1.hasMore, true);
  assert.strictEqual(p1.pinned.msg, 'TEST: The court is now in session.');
  assert.ok(p1.posts.every((x) => x.role === 'fan'));
});

console.log(`\n${passed} tests passed`);
