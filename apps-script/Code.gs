/**
 * Platinum +1 Club - data endpoint and push notifications.
 *
 * Lives inside the "Contest points (Responses)" spreadsheet (Extensions > Apps Script).
 *
 * Three jobs:
 *   1. doGet()         - deployed as a web app, returns the entries as JSON for the standings page.
 *   2. onFormSubmit()  - trigger on form submit: a push when the platinum changes hands.
 *   3. scheduledPush() - trigger every 5 minutes: the 7 PM local daily summary, the seal notice,
 *                        and the final results. Run setupTriggers() once to install both triggers.
 *
 * Secrets live in Script Properties (Project Settings > Script Properties), never in this file:
 *   ONESIGNAL_APP_ID        - the OneSignal app id (also public, in the page's config.js)
 *   ONESIGNAL_REST_API_KEY  - the OneSignal REST API key (secret)
 */

var CONFIG = {
  NAME: 'Platinum +1 Club',
  // Scoring runs from 5 PM Chicago on Oct 22 (CDT) to the AKL-DFW takeoff on Nov 13 (1:20 PM NZDT).
  CONTEST_START: '2026-10-22T22:00:00Z',
  CONTEST_END: '2026-11-13T00:20:00Z',
  BLACKOUT_HOURS: 24,
  PAGE_URL: 'https://mrg0114.github.io/contest-standings/',
  CACHE_SECONDS: 15,
  // Frozen at go-live, so an edit to the Form's choices can't rename or drop anyone mid-contest.
  // Empty means "read the names from the Form" (how it ran during testing).
  COMPETITORS: ['Jen', 'Kathy', 'Blas'],
  COMPETITOR_QUESTION: 'Competitor',
  // Chicago days (midnight CDT = 05:00Z) until departure, Auckland days (midnight NZDT = 11:00Z) after landing.
  CHICAGO_DAYS: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'],
  AUCKLAND_FIRST: '2026-10-30',
  AUCKLAND_LAST: '2026-11-13'
};

/* ---------- Web app ---------- */

function doGet(e) {
  var cache = CacheService.getScriptCache();
  var nocache = e && e.parameter && e.parameter.nocache;
  var body = nocache ? null : cache.get('payload');
  if (!body) {
    body = JSON.stringify(buildPayload());
    cache.put('payload', body, CONFIG.CACHE_SECONDS);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/** Everything the page needs. Timestamps are ISO 8601 in UTC. */
function buildPayload() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = responseSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0].map(String) : [];
  var iT = header.indexOf('Timestamp');
  var iC = header.indexOf('Competitor');
  var iP = header.indexOf('Points');
  var iR = header.indexOf('Reason');
  var competitors = competitors_(ss);
  var entries = [];
  var start = new Date(CONFIG.CONTEST_START);
  var started = new Date() >= start;

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var t = row[iT];
    var c = String(row[iC] || '').trim();
    var p = Number(row[iP]);
    if (!(t instanceof Date) || isNaN(t.getTime()) || !c || isNaN(p)) continue;
    if (competitors.length && competitors.indexOf(c) < 0) continue; // old names, test rows
    if (started && t < start) continue; // practice entries stop counting once scoring starts
    entries.push({ t: t.toISOString(), c: c, p: p, r: iR >= 0 ? String(row[iR] || '').trim() : '' });
  }
  entries.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });

  return {
    name: CONFIG.NAME,
    generatedAt: new Date().toISOString(),
    contestStart: CONFIG.CONTEST_START,
    contestEnd: CONFIG.CONTEST_END,
    sealAt: sealAt_(),
    days: days_(),
    competitors: competitors,
    entries: entries
  };
}

function sealAt_() {
  return new Date(new Date(CONFIG.CONTEST_END).getTime() - CONFIG.BLACKOUT_HOURS * 3600000).toISOString();
}

/** The scoring days: label is the local date, start/end are UTC. */
function days_() {
  var days = [{ label: CONFIG.CONTEST_START.slice(0, 10), zone: 'Chicago', start: CONFIG.CONTEST_START }];
  CONFIG.CHICAGO_DAYS.forEach(function (d) { days.push({ label: d, zone: 'Chicago', start: d + 'T05:00:00Z' }); });
  var d = new Date(CONFIG.AUCKLAND_FIRST + 'T00:00:00Z');
  var last = new Date(CONFIG.AUCKLAND_LAST + 'T00:00:00Z');
  while (d <= last) {
    var prev = new Date(d.getTime() - 86400000).toISOString().slice(0, 10);
    days.push({ label: d.toISOString().slice(0, 10), zone: 'Auckland', start: prev + 'T11:00:00Z' });
    d = new Date(d.getTime() + 86400000);
  }
  for (var i = 0; i < days.length; i++) {
    days[i].n = i + 1;
    days[i].end = i + 1 < days.length ? days[i + 1].start : CONFIG.CONTEST_END;
  }
  return days;
}

function responseSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().indexOf('Form Responses') === 0) return sheets[i];
  }
  return sheets[0];
}

/** The frozen competitor list, or else the names in the order the form lists them, or else the names seen in the sheet. */
function competitors_(ss) {
  if (CONFIG.COMPETITORS && CONFIG.COMPETITORS.length) return CONFIG.COMPETITORS.slice();
  try {
    var url = ss.getFormUrl();
    if (url) {
      var items = FormApp.openByUrl(url).getItems();
      for (var i = 0; i < items.length; i++) {
        if (items[i].getTitle() === CONFIG.COMPETITOR_QUESTION) {
          return items[i].asMultipleChoiceItem().getChoices().map(function (ch) { return ch.getValue(); });
        }
      }
    }
  } catch (err) {
    Logger.log('competitors_: ' + err);
  }
  var seen = [];
  var values = responseSheet_(ss).getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var c = String(values[r][1] || '').trim();
    if (c && seen.indexOf(c) < 0) seen.push(c);
  }
  return seen;
}

/* ---------- Ranking (same rules as the page) ---------- */

/** Total points, then most points earned, then fewest points lost. Equal on all three shares the rank. */
function ranking_(competitors, entries, untilIso) {
  var rows = {};
  competitors.forEach(function (c) { rows[c] = { name: c, total: 0, earned: 0, lost: 0 }; });
  entries.forEach(function (e) {
    if (untilIso && e.t > untilIso) return;
    var row = rows[e.c] || (rows[e.c] = { name: e.c, total: 0, earned: 0, lost: 0 });
    row.total += e.p;
    if (e.p > 0) row.earned += e.p; else row.lost += e.p;
  });
  var list = Object.keys(rows).map(function (k) { return rows[k]; });
  list.sort(function (a, b) {
    return (b.total - a.total) || (b.earned - a.earned) || (b.lost - a.lost) || competitors.indexOf(a.name) - competitors.indexOf(b.name);
  });
  for (var i = 0; i < list.length; i++) {
    var prev = list[i - 1];
    list[i].rank = prev && prev.total === list[i].total && prev.earned === list[i].earned && prev.lost === list[i].lost ? prev.rank : i + 1;
  }
  return list;
}

function leaders_(rankList) {
  return rankList.filter(function (r) { return r.rank === 1; }).map(function (r) { return r.name; });
}

function sameSet_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
  return true;
}

function signed_(n) { return n > 0 ? '+' + n : String(n); }

function tierLine_(rankList) {
  var tiers = ['Platinum', 'Zinc', 'Wood'];
  return rankList.map(function (r) { return (tiers[r.rank - 1] || '#' + r.rank) + ' ' + r.name + ' ' + r.total; }).join(' / ');
}

/* ---------- Push: lead changes ---------- */

/** Installable trigger: From spreadsheet > On form submit (installed by setupTriggers). */
function onFormSubmit(e) {
  CacheService.getScriptCache().remove('payload');
  var creds = creds_();
  if (!creds) return;

  var payload = buildPayload();
  var entries = payload.entries;
  if (!entries.length) return;
  var now = new Date();
  if (now >= new Date(payload.sealAt) || now < new Date(payload.contestStart)) return; // sealed, or practice

  var before = leaders_(ranking_(payload.competitors, entries.slice(0, -1)));
  var after = leaders_(ranking_(payload.competitors, entries));
  if (sameSet_(before, after)) return;

  var last = entries[entries.length - 1];
  var why = signed_(last.p) + (last.r ? ', "' + last.r + '"' : '');
  if (after.length > 1) {
    sendPush_(creds, 'Platinum shared', after.join(' and ') + ' are tied for the platinum (' + why + ').');
  } else {
    var top = ranking_(payload.competitors, entries)[0];
    sendPush_(creds, after[0] + ' takes the platinum', after[0] + ' leads at ' + top.total + ' (' + why + ').');
  }
}

/* ---------- Push: scheduled ---------- */

/** Every 5 minutes (installed by setupTriggers). Sends each scheduled message once. */
function scheduledPush() {
  var creds = creds_();
  if (!creds) return;
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var events = pushSchedule_();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var at = new Date(ev.at);
    if (at > now) continue;
    if (now.getTime() - at.getTime() > 6 * 3600000) continue; // too old to bother
    if (props.getProperty('sent:' + ev.key)) continue;
    var msg = scheduledMessage_(ev);
    if (msg) sendPush_(creds, msg.title, msg.body);
    props.setProperty('sent:' + ev.key, now.toISOString());
  }
}

/** 7 PM local every day (00:00Z in Chicago, 06:00Z in Auckland), the seal, and the final. */
function pushSchedule_() {
  var list = [];
  var days = days_();
  days.forEach(function (d) {
    if (d.zone === 'Chicago') {
      var next = new Date(new Date(d.label + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
      list.push({ key: 'daily-' + d.label, at: next + 'T00:00:00Z', type: 'daily', day: d });
    } else {
      list.push({ key: 'daily-' + d.label, at: d.label + 'T06:00:00Z', type: 'daily', day: d });
    }
  });
  var endIso = CONFIG.CONTEST_END;
  list = list.filter(function (ev) { return ev.at < endIso; });
  list.push({ key: 'seal', at: sealAt_(), type: 'seal' });
  list.push({ key: 'final', at: endIso, type: 'final' });
  return list;
}

function scheduledMessage_(ev) {
  var payload = buildPayload();
  var ranks = ranking_(payload.competitors, payload.entries);
  if (ev.type === 'seal') {
    return { title: 'Standings sealed', body: 'No more peeking. The final results come at takeoff from Auckland.' };
  }
  if (ev.type === 'final') {
    return { title: 'Final results', body: tierLine_(ranks) + '. Congratulations to the platinum.' };
  }
  var sealed = new Date() >= new Date(payload.sealAt);
  var title = 'Day ' + ev.day.n + ' of ' + payload.days.length;
  if (sealed) return { title: title, body: 'Standings are sealed until takeoff.' };
  var today = payload.entries.filter(function (e) { return e.t >= ev.day.start && e.t < ev.day.end; });
  var net = {};
  today.forEach(function (e) { net[e.c] = (net[e.c] || 0) + e.p; });
  var todayLine = payload.competitors.map(function (c) { return c + ' ' + signed_(net[c] || 0); }).join(', ');
  return { title: title, body: tierLine_(ranks) + '. Today: ' + todayLine + '.' };
}

/* ---------- OneSignal ---------- */

function creds_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ONESIGNAL_REST_API_KEY');
  var appId = props.getProperty('ONESIGNAL_APP_ID');
  return key && appId ? { key: key, appId: appId } : null;
}

function sendPush_(creds, title, body) {
  var res = UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Key ' + creds.key },
    payload: JSON.stringify({
      app_id: creds.appId,
      target_channel: 'push',
      included_segments: ['Subscribed Users'],
      headings: { en: title },
      contents: { en: body },
      url: CONFIG.PAGE_URL
    }),
    muteHttpExceptions: true
  });
  Logger.log('OneSignal ' + res.getResponseCode() + ': ' + res.getContentText());
}

/* ---------- One-time setup and tests (run from the editor) ---------- */

/** Installs the two triggers. Safe to run again; it replaces its own earlier triggers. */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'onFormSubmit' || fn === 'scheduledPush') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onFormSubmit().create();
  ScriptApp.newTrigger('scheduledPush').timeBased().everyMinutes(5).create();
  Logger.log('Triggers installed.');
}

/** Sends one test notification to everyone subscribed. */
function testPush() {
  var creds = creds_();
  if (!creds) { Logger.log('Set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY in Script Properties first.'); return; }
  sendPush_(creds, 'Test from the judge\'s desk', 'If you can read this, notifications work.');
}

/** Logs the JSON the page will get. */
function testPayload() {
  Logger.log(JSON.stringify(buildPayload(), null, 2));
}

/** Logs the push schedule, for checking the times. */
function testSchedule() {
  pushSchedule_().forEach(function (ev) { Logger.log(ev.at + '  ' + ev.key); });
}
