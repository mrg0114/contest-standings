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
  const sheet = {
    appendRow: (r) => rows.push(r.slice()),
    getLastRow: () => rows.length,
    setFrozenRows: () => {},
    getRange: (row, col) => ({
      insertCheckboxes: () => { rows[row - 1][col - 1] = rows[row - 1][col - 1] === true; },
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
    Logger: { log: (s) => logs.push(String(s)) }
  };
  const names = Object.keys(env);
  const fn = new Function(...names, src + '\nreturn { doGet, doPost, setup, testSamplePosts };');
  const api = fn(...names.map((n) => env[n]));
  return { api, rows, logs, cache };
}

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

console.log(`\n${passed} tests passed`);
