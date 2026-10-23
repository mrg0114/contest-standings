/**
 * Platinum +1 Club - the Paddock message board.
 *
 * Lives inside its own spreadsheet, "Platinum +1 Club Paddock" (Extensions > Apps Script), apart from
 * the scoring spreadsheet and script, so nothing here can touch the standings.
 *
 *   doGet  - returns one page of visible posts as JSON, newest first, for the page:
 *              ?limit=30                       the newest 30, plus the judge's latest post to pin
 *              ?before=<ISO time>&beforeId=<id> the 30 posts older than that one, for "Show older posts"
 *   doPost - adds a post. The passcode decides who is posting:
 *              JUDGE_PASSCODE               -> Paul, with the judge's badge (and a push notification)
 *              PASSCODE_JEN / _KATHY / _BLAS -> that competitor, with a competitor badge
 *              FAN_PASSCODE                 -> anyone, under the name they type
 *
 * Moderation: tick "Hidden" on a row in the Posts sheet and the post drops off the page.
 *
 * Script Properties (Project Settings > Script Properties), never in this file:
 *   FAN_PASSCODE, JUDGE_PASSCODE, PASSCODE_JEN, PASSCODE_KATHY, PASSCODE_BLAS
 *   PUSH                                     'on' sends a notification for the judge's posts; anything else only logs
 *   ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY  needed only when PUSH is 'on'
 */

var PADDOCK = {
  SHEET: 'Posts',
  JUDGE_NAME: 'Paul',
  COMPETITORS: ['Jen', 'Kathy', 'Blas'],
  RESERVED_NAMES: ['paul', 'jen', 'kathy', 'blas', 'judge', 'the judge'],
  MAX_MESSAGE: 500,
  MAX_NAME: 30,
  PAGE_SIZE: 30,           // posts per page
  MAX_PAGE: 50,            // largest page a caller can ask for
  RATE_SECONDS: 10,        // one post per name per 10 seconds
  CACHE_SECONDS: 10,
  PAGE_URL: 'https://mrg0114.github.io/contest-standings/#paddock'
};

var HEADER = ['Id', 'Timestamp', 'Name', 'Role', 'Message', 'Hidden'];

/* ---------- Web app ---------- */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var limit = Math.min(PADDOCK.MAX_PAGE, Math.max(1, parseInt(params.limit, 10) || PADDOCK.PAGE_SIZE));
  var before = cursor_(params.before, params.beforeId);
  // Only the newest page is cached: it is what every open page polls for.
  var cacheable = !before && limit === PADDOCK.PAGE_SIZE;
  var cache = CacheService.getScriptCache();
  var body = cacheable ? cache.get('page0') : null;
  if (!body) {
    body = JSON.stringify(page_(before, limit));
    if (cacheable) cache.put('page0', body, PADDOCK.CACHE_SECONDS);
  }
  return json_(body);
}

/** One page of posts, newest first. The first page (no cursor) also carries the judge's latest post. */
function page_(before, limit) {
  var all = visiblePosts_();
  var start = 0;
  if (before) while (start < all.length && !olderThan_(all[start], before)) start++;
  var out = {
    generatedAt: new Date().toISOString(),
    posts: all.slice(start, start + limit),
    hasMore: start + limit < all.length
  };
  if (!before) {
    out.pinned = null;
    for (var i = 0; i < all.length; i++) if (all[i].role === 'judge') { out.pinned = all[i]; break; }
  }
  return out;
}

/** A paging cursor from the query string, or null if it is missing or unreadable. */
function cursor_(before, beforeId) {
  if (!before) return null;
  var ms = Date.parse(before);
  if (isNaN(ms)) return null;
  return { t: new Date(ms).toISOString(), id: String(beforeId || '') };
}

/** Is post p older than cursor c? Ties on time fall back to the id, so no post is skipped or repeated. */
function olderThan_(p, c) {
  return p.t < c.t || (p.t === c.t && p.id < c.id);
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return reply_({ ok: false, error: 'Bad request.' }); }

  var who = identify_(String(req.passcode || ''));
  if (!who) {
    Utilities.sleep(1500); // slows down guessing
    return reply_({ ok: false, error: 'That passcode isn\'t right.' });
  }

  var message = clean_(req.message, PADDOCK.MAX_MESSAGE);
  if (!message) return reply_({ ok: false, error: 'Write something first.' });

  var name = who.name;
  if (who.role === 'fan') {
    name = clean_(req.name, PADDOCK.MAX_NAME).replace(/\s+/g, ' ');
    if (!name) return reply_({ ok: false, error: 'Add your name.' });
    if (PADDOCK.RESERVED_NAMES.indexOf(name.toLowerCase()) >= 0) {
      return reply_({ ok: false, error: 'That name belongs to the judge or a competitor.' });
    }
  }

  var cache = CacheService.getScriptCache();
  var rateKey = 'rate:' + name.toLowerCase();
  if (cache.get(rateKey)) {
    return reply_({ ok: false, error: 'Easy, tiger. One post every ' + PADDOCK.RATE_SECONDS + ' seconds.' });
  }

  var post = { id: Utilities.getUuid().slice(0, 8), t: new Date().toISOString(), name: name, role: who.role, msg: message };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_();
    sh.appendRow([post.id, new Date(post.t), post.name, post.role, post.msg, false]);
    sh.getRange(sh.getLastRow(), 6).insertCheckboxes();
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  cache.put(rateKey, '1', PADDOCK.RATE_SECONDS);
  cache.remove('page0');

  if (who.role === 'judge') notifyJudgePost_(post);
  return reply_({ ok: true, post: post });
}

/* ---------- Helpers ---------- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PADDOCK.SHEET);
  if (!sh) {
    sh = ss.insertSheet(PADDOCK.SHEET);
    sh.appendRow(HEADER);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Every visible post, newest first (ties broken by id). A ticked Hidden box removes a post. */
function visiblePosts_() {
  var values = sheet_().getDataRange().getValues();
  var posts = [];
  for (var r = 1; r < values.length; r++) {
    var v = values[r];
    if (v[5] === true || String(v[5]).toLowerCase() === 'true') continue;
    if (!v[4]) continue;
    var t = v[1] instanceof Date ? v[1] : new Date(v[1]);
    if (isNaN(t.getTime())) continue;
    posts.push({ id: String(v[0]), t: t.toISOString(), name: String(v[2]), role: String(v[3]), msg: String(v[4]) });
  }
  posts.sort(function (a, b) {
    if (a.t !== b.t) return a.t < b.t ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return posts;
}

/** Who a passcode belongs to. Passcodes ignore case and surrounding spaces. */
function identify_(code) {
  if (!code.trim()) return null;
  var props = PropertiesService.getScriptProperties();
  if (same_(code, props.getProperty('JUDGE_PASSCODE'))) return { role: 'judge', name: PADDOCK.JUDGE_NAME };
  for (var i = 0; i < PADDOCK.COMPETITORS.length; i++) {
    var c = PADDOCK.COMPETITORS[i];
    if (same_(code, props.getProperty('PASSCODE_' + c.toUpperCase()))) return { role: 'competitor', name: c };
  }
  if (same_(code, props.getProperty('FAN_PASSCODE'))) return { role: 'fan', name: '' };
  return null;
}

function same_(a, b) {
  return !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Plain text only: control characters stripped, at most two blank lines in a row, trimmed, capped. */
function clean_(s, max) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function notifyJudgePost_(post) {
  var props = PropertiesService.getScriptProperties();
  var title = 'The judge has spoken';
  var body = post.msg.length > 140 ? post.msg.slice(0, 137) + '...' : post.msg;
  if (props.getProperty('PUSH') !== 'on') {
    Logger.log('Push is off. Would have sent: ' + title + ' / ' + body);
    return;
  }
  var key = props.getProperty('ONESIGNAL_REST_API_KEY'), appId = props.getProperty('ONESIGNAL_APP_ID');
  if (!key || !appId) { Logger.log('Push is on but the OneSignal properties are missing.'); return; }
  var res = UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Key ' + key },
    payload: JSON.stringify({
      app_id: appId,
      target_channel: 'push',
      included_segments: ['Subscribed Users'],
      headings: { en: title },
      contents: { en: body },
      url: PADDOCK.PAGE_URL
    }),
    muteHttpExceptions: true
  });
  Logger.log('OneSignal ' + res.getResponseCode() + ': ' + res.getContentText());
}

function reply_(obj) { return json_(JSON.stringify(obj)); }

function json_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

/* ---------- One-time setup and tests (run from the editor) ---------- */

/** Creates the Posts sheet with its header and reports which Script Properties are still missing. */
function setup() {
  var sh = sheet_();
  if (sh.getLastRow() === 0) { sh.appendRow(HEADER); sh.setFrozenRows(1); }
  sh.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
  var props = PropertiesService.getScriptProperties();
  var needed = ['FAN_PASSCODE', 'JUDGE_PASSCODE', 'PASSCODE_JEN', 'PASSCODE_KATHY', 'PASSCODE_BLAS', 'PUSH'];
  var missing = needed.filter(function (k) { return !props.getProperty(k); });
  Logger.log(missing.length ? 'Missing Script Properties: ' + missing.join(', ') : 'All Script Properties are set.');
}

/** Adds three clearly labeled sample posts, one per badge, without passcodes. For the test site only. */
function testSamplePosts() {
  var sh = sheet_();
  var now = Date.now();
  [['Paul', 'judge', 'TEST: The court is now in session.'],
   ['Kathy', 'competitor', 'TEST: I would like to file an appeal.'],
   ['Aunt Sue', 'fan', 'TEST: Go Blas!']].forEach(function (p, i) {
    sh.appendRow([Utilities.getUuid().slice(0, 8), new Date(now + i * 1000), p[0], p[1], p[2], false]);
    sh.getRange(sh.getLastRow(), 6).insertCheckboxes();
  });
  CacheService.getScriptCache().remove('page0');
  Logger.log('Added 3 test posts.');
}

/** Adds 45 numbered sample posts, the newest last, so the page has more than one page to show. For the test site only. */
function testManyPosts() {
  var sh = sheet_();
  var now = Date.now();
  var rows = [];
  for (var i = 1; i <= 45; i++) {
    rows.push([Utilities.getUuid().slice(0, 8), new Date(now + i * 1000), 'Fan ' + i, 'fan', 'TEST: paging post ' + i, false]);
  }
  var range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length);
  range.setValues(rows);
  sh.getRange(range.getRow(), 6, rows.length, 1).insertCheckboxes();
  CacheService.getScriptCache().remove('page0');
  Logger.log('Added ' + rows.length + ' test posts.');
}

/** Logs the first page the site would receive. */
function testList() {
  Logger.log(JSON.stringify(page_(null, PADDOCK.PAGE_SIZE), null, 2));
}
