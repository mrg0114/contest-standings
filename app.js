/* Platinum +1 Club - live standings page. Plain JS, no build step. */
(function () {
  'use strict';

  var CFG = Object.assign({
    name: 'Platinum +1 Club', dataUrl: '', oneSignalAppId: '',
    swScope: '/', swPath: 'OneSignalSDKWorker.js', pollMs: 60000
  }, window.CONTEST_CONFIG || {});
  var qs = new URLSearchParams(location.search);
  var DEMO = qs.has('demo') || !CFG.dataUrl;
  var DEMO_PHASE = qs.get('demo') || 'live';
  var H = 3600000, D = 24 * H;
  var TIERS = [
    { key: 'platinum', label: 'Platinum', icon: '🏆' },
    { key: 'zinc', label: 'Zinc', icon: '🔩' },
    { key: 'wood', label: 'Wood', icon: '🪵' }
  ];
  var JOKES = [
    'The judge\'s rulings are final. Appeals are heard never.',
    'Zinc: proudly protecting steel from rust since 1742.',
    'Wood is a renewable resource. So is last place.',
    'Platinum is 30 times rarer than gold. So is a +2.',
    'Odds board for entertainment only. Please gamble irresponsibly.',
    'A +1 for the judge is not a thing. Stop asking.',
    'Reminder: the standings are tracked in UTC, like all serious sports.',
    'Negative points are just positive points for someone else.'
  ];

  var state = { p: null, stale: false, error: '', lastFetch: 0, fetching: false };
  var CACHE_KEY = 'p1c.payload';

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function signed(n) { return n > 0 ? '+' + n : String(n); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtUTC(t) { var d = new Date(t); return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + 'Z'; }
  function fmtLocal(t) {
    return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtShort(t) { return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric' }); }
  function fmtAgo(t, now) {
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }
  function fmtDur(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + pad2(m) + 'm';
    return h + 'h ' + pad2(m) + 'm ' + pad2(sec) + 's';
  }
  function fmtDay(label) {
    return new Date(label + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
    return true;
  }
  function colorVar(p, name) { return 'var(--series-' + (p.competitors.indexOf(name) % 3 + 1) + ')'; }
  function listNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* ---------- data ---------- */
  function normalize(raw, now) {
    var p = {
      name: raw.name || CFG.name,
      competitors: (raw.competitors || []).slice(),
      start: Date.parse(raw.contestStart), end: Date.parse(raw.contestEnd), seal: Date.parse(raw.sealAt),
      days: (raw.days || []).map(function (d) { return { n: d.n, label: d.label, zone: d.zone, start: Date.parse(d.start), end: Date.parse(d.end) }; }),
      entries: (raw.entries || []).map(function (e) { return { t: Date.parse(e.t), c: e.c, p: Number(e.p), r: e.r || '' }; })
        .filter(function (e) { return !isNaN(e.t) && !isNaN(e.p); })
        .sort(function (a, b) { return a.t - b.t; }),
      generatedAt: Date.parse(raw.generatedAt) || now
    };
    if (!p.competitors.length) {
      p.entries.forEach(function (e) { if (p.competitors.indexOf(e.c) < 0) p.competitors.push(e.c); });
    }
    if (isNaN(p.seal)) p.seal = p.end - D;
    return p;
  }

  function demoPayload(sample, now) {
    var start = now - 5 * D, end = now + 15 * D;
    if (DEMO_PHASE === 'sealed') end = now + 9 * H;
    if (DEMO_PHASE === 'final') end = now - 1 * H;
    if (DEMO_PHASE === 'practice') start = now + 2 * D;
    var days = [];
    for (var i = 0; i < 21; i++) {
      var s = start + i * D;
      days.push({ n: i + 1, label: new Date(s).toISOString().slice(0, 10), zone: i < 6 ? 'Chicago' : 'Auckland', start: new Date(s).toISOString(), end: new Date(Math.min(s + D, end)).toISOString() });
    }
    return {
      name: sample.name, competitors: sample.competitors,
      contestStart: new Date(start).toISOString(), contestEnd: new Date(end).toISOString(), sealAt: new Date(end - D).toISOString(),
      days: days, generatedAt: new Date(now).toISOString(),
      entries: sample.entries.map(function (e) { return { t: new Date(now + e.dh * H).toISOString(), c: e.c, p: e.p, r: e.r }; })
    };
  }

  function fetchData(manual) {
    if (state.fetching) return;
    state.fetching = true;
    var btn = $('#refreshBtn');
    btn.classList.add('spin');
    var url = DEMO ? 'sample.json' : CFG.dataUrl + (CFG.dataUrl.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (raw) {
        var now = Date.now();
        if (DEMO) raw = demoPayload(raw, now);
        state.p = normalize(raw, now);
        state.stale = false; state.error = ''; state.lastFetch = now;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ raw: raw, at: now })); } catch (e) { }
        render();
      })
      .catch(function (err) {
        state.stale = true; state.error = String(err.message || err);
        render();
      })
      .then(function () { state.fetching = false; btn.classList.remove('spin'); });
  }

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.raw) { state.p = normalize(c.raw, Date.now()); state.lastFetch = c.at; state.stale = true; }
    } catch (e) { }
  }

  /* ---------- scoring ---------- */
  // Total points, then most points earned, then fewest points lost. Equal on all three shares the rank.
  function ranking(p, until) {
    var rows = {};
    p.competitors.forEach(function (c) { rows[c] = { name: c, total: 0, earned: 0, lost: 0, n: 0 }; });
    p.entries.forEach(function (e) {
      if (until != null && e.t > until) return;
      var r = rows[e.c] || (rows[e.c] = { name: e.c, total: 0, earned: 0, lost: 0, n: 0 });
      r.total += e.p; r.n++;
      if (e.p > 0) r.earned += e.p; else r.lost += e.p;
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      return (b.total - a.total) || (b.earned - a.earned) || (b.lost - a.lost) || (p.competitors.indexOf(a.name) - p.competitors.indexOf(b.name));
    });
    list.forEach(function (r, i) {
      var prev = list[i - 1];
      r.decided = '';
      if (!prev) { r.rank = 1; return; }
      if (prev.total === r.total && prev.earned === r.earned && prev.lost === r.lost) { r.rank = prev.rank; r.decided = 'tie'; prev.decided = prev.decided || 'tie'; return; }
      r.rank = i + 1;
      if (prev.total === r.total) {
        r.decided = prev.earned !== r.earned ? 'earned' : 'lost';
        prev.decided = prev.decided || r.decided;
      }
    });
    return list;
  }
  function leadersOf(list) { return list.filter(function (r) { return r.rank === 1; }).map(function (r) { return r.name; }); }
  function net(p, name, from, to) {
    var s = 0;
    p.entries.forEach(function (e) { if (e.c === name && e.t > from && e.t <= to) s += e.p; });
    return s;
  }
  function count(p, name, from, to, sign) {
    var n = 0;
    p.entries.forEach(function (e) { if (e.c === name && e.t > from && e.t <= to && (sign > 0 ? e.p > 0 : e.p < 0)) n++; });
    return n;
  }
  function momentum(p, name, now) {
    var a = net(p, name, now - D, now), b = net(p, name, now - 2 * D, now - D);
    if (a > b) return { arrow: '▲', word: 'rising', cls: 'up' };
    if (a < b) return { arrow: '▼', word: 'falling', cls: 'down' };
    return { arrow: '▶', word: 'steady', cls: '' };
  }
  function mood(r, list) {
    var maxRank = Math.max.apply(null, list.map(function (x) { return x.rank; }));
    if (maxRank === 1) return '😐';
    if (r.rank === 1) return '😄';
    if (r.rank === maxRank) return '😢';
    return '😐';
  }
  function leadChanges(p) {
    var prev = null, out = [];
    for (var i = 0; i < p.entries.length; i++) {
      var e = p.entries[i];
      if (i + 1 < p.entries.length && p.entries[i + 1].t === e.t) continue; // same instant, judge once
      var L = leadersOf(ranking(p, e.t));
      if (prev && !sameSet(prev, L)) out.push({ t: e.t, to: L, from: prev, by: e });
      prev = L;
    }
    return out;
  }
  function phaseOf(p, now) {
    if (now >= p.end) return 'final';
    if (now >= p.seal) return 'sealed';
    if (now < p.start) return 'practice';
    return 'live';
  }
  function dayOf(p, t) {
    for (var i = 0; i < p.days.length; i++) if (t >= p.days[i].start && t < p.days[i].end) return p.days[i];
    return null;
  }
  function cumulative(p, name, from, to) {
    var pts = [{ t: from, v: net(p, name, -Infinity, from) }], v = pts[0].v;
    p.entries.forEach(function (e) { if (e.c === name && e.t > from && e.t <= to) { v += e.p; pts.push({ t: e.t, v: v }); } });
    pts.push({ t: to, v: v });
    return pts;
  }

  /* ---------- render ---------- */
  function render() {
    var p = state.p, now = Date.now();
    document.title = (p && p.name) || CFG.name;
    $('#title').textContent = (p && p.name) || CFG.name;
    if (!p) {
      $('#status').innerHTML = state.error ? '<span class="stale">Can\'t reach the scoreboard (' + esc(state.error) + ')</span>' : 'Loading…';
      return;
    }
    var phase = phaseOf(p, now), ranks = ranking(p), day = dayOf(p, now);
    var status = '';
    if (phase === 'practice') status = 'Practice mode · scoring starts ' + fmtLocal(p.start);
    else if (phase === 'final') status = 'Final · scoring ended ' + fmtLocal(p.end);
    else if (day) status = 'Day ' + day.n + ' of ' + p.days.length + ' · ' + fmtDay(day.label) + ' (' + day.zone + ')';
    else status = 'Live';
    status += ' · updated ' + fmtAgo(state.lastFetch || p.generatedAt, now);
    if (state.stale) status += ' <span class="stale">· offline, showing last known</span>';
    $('#status').innerHTML = status;

    var banner = $('#banner');
    if (phase === 'practice') {
      banner.hidden = false;
      banner.textContent = 'Practice mode. Nothing counts yet. Scoring starts ' + fmtLocal(p.start) + ' (' + fmtUTC(p.start) + ').';
    } else if (DEMO) {
      banner.hidden = false;
      banner.textContent = 'Demo data. The real scoreboard connects once the judge\'s form is wired up.';
    } else banner.hidden = true;

    var sealed = phase === 'sealed';
    ['ticker', 'track', 'standings', 'chart', 'awards', 'odds', 'rulings'].forEach(function (id) { $('#' + id).hidden = sealed; });
    $('#sealed').hidden = !sealed;
    $('#final').hidden = phase !== 'final';

    if (sealed) { renderSealed(p, now); return; }
    if (phase === 'final') renderFinal(p, ranks);
    renderTicker(p, ranks, now, phase);
    renderTrack(p, ranks);
    renderStandings(p, ranks, now);
    renderChart(p, ranks, now);
    renderAwards(p, ranks, now, phase);
    renderOdds(p, ranks, now, phase);
    renderRulings(p, now);
    $('#footNote').textContent = 'Ranking: total points, then most points earned, then fewest points lost. 4h and 24h are rolling windows. Momentum compares the last 24 hours with the 24 before.';
  }

  function renderSealed(p, now) {
    $('#sealed').innerHTML =
      '<div class="lock">🔒</div>' +
      '<h2>The standings are sealed</h2>' +
      '<div class="count" id="sealCount">' + fmtDur(p.end - now) + '</div>' +
      '<p>No peeking until takeoff from Auckland. The judge is still ruling, so behave.</p>' +
      '<p class="muted">Sealed since ' + fmtLocal(p.seal) + '. Reveal at ' + fmtLocal(p.end) + ' (' + fmtUTC(p.end) + ').</p>';
  }

  function renderFinal(p, ranks) {
    var byRank = [ranks[1], ranks[0], ranks[2]].filter(Boolean);
    var html = '<h2>Final results</h2><div class="podium">';
    byRank.forEach(function (r) {
      var tier = TIERS[r.rank - 1] || { label: '#' + r.rank, icon: '' };
      html += '<div class="step p' + r.rank + '"><div class="name">' + esc(r.name) + '</div>' +
        '<div class="block"><div class="big">' + tier.icon + '</div><div>' + tier.label + '</div><div class="pts">' + r.total + '</div></div></div>';
    });
    html += '</div><p class="muted">Congratulations to the platinum. Condolences to the wood.</p>';
    var el = $('#final');
    if (el.innerHTML !== html) { el.innerHTML = html; confetti(); }
  }

  function headlines(p, ranks, now, phase) {
    var h = [];
    var leaders = leadersOf(ranks);
    if (leaders.length === 1) {
      var gap = ranks[0].total - (ranks[1] ? ranks[1].total : 0);
      h.push('👑 ' + leaders[0] + ' holds the platinum' + (ranks[1] ? (gap ? ' by ' + gap : ' on the tie-breaker') : ''));
    } else if (leaders.length) h.push('👑 ' + listNames(leaders) + ' share the platinum');
    var last = p.entries[p.entries.length - 1];
    if (last) h.push('🧑‍⚖️ Latest ruling: ' + last.c + ' ' + signed(last.p) + (last.r ? ' for "' + last.r + '"' : '') + ' (' + fmtAgo(last.t, now) + ')');
    var hot = ranks.map(function (r) { return { name: r.name, v: net(p, r.name, now - D, now) }; }).sort(function (a, b) { return b.v - a.v; })[0];
    if (hot && hot.v >= 3) h.push('🔥 ' + hot.name + ' is ' + signed(hot.v) + ' in the last 24 hours');
    var today = dayOf(p, now);
    if (today) {
      var lc = leadChanges(p).filter(function (c) { return c.t >= today.start; }).length;
      if (lc) h.push('🔁 ' + lc + ' lead change' + (lc > 1 ? 's' : '') + ' today');
    }
    ranks.forEach(function (r) {
      var mine = p.entries.filter(function (e) { return e.c === r.name; });
      var lastT = mine.length ? mine[mine.length - 1].t : null;
      if (phase === 'live' && lastT && now - lastT > 36 * H) h.push('👻 ' + r.name + ' hasn\'t been ruled on in ' + Math.floor((now - lastT) / D) + ' days');
    });
    if (phase === 'live') h.push('⏳ Standings seal in ' + fmtDur(p.seal - now));
    if (phase === 'practice') h.push('🧪 Practice mode: the judge is warming up');
    h.push('💬 ' + JOKES[Math.floor(now / H) % JOKES.length]);
    return h;
  }

  function renderTicker(p, ranks, now, phase) {
    var items = headlines(p, ranks, now, phase).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('');
    $('#ticker').innerHTML = '<div class="ticker-track">' + items + items + '</div>';
  }

  function renderTrack(p, ranks) {
    var totals = ranks.map(function (r) { return r.total; });
    var max = Math.max.apply(null, totals), min = Math.min.apply(null, totals), range = max - min;
    var html = '<h2>The race</h2><div class="lanes"><div class="finish" aria-hidden="true"></div>';
    p.competitors.forEach(function (name) {
      var r = ranks.filter(function (x) { return x.name === name; })[0];
      var pos = range ? 10 + 74 * (r.total - min) / range : 46;
      html += '<div class="lane" style="--c:' + colorVar(p, name) + '">' +
        '<div class="lane-name">' + esc(name) + '</div>' +
        '<div class="horse" style="left:' + pos.toFixed(1) + '%"><span class="crown">' + (r.rank === 1 ? '👑' : '') + '</span>' +
        '<span class="art" aria-hidden="true"></span><span class="score">' + r.total + '</span></div></div>';
    });
    $('#track').innerHTML = html + '</div>';
  }

  function sparkline(p, name, now) {
    var pts = cumulative(p, name, now - 7 * D, now);
    var vs = pts.map(function (q) { return q.v; });
    var lo = Math.min.apply(null, vs.concat([0])), hi = Math.max.apply(null, vs.concat([0]));
    var W = 120, Hh = 34, pad = 3;
    var x = function (t) { return pad + (W - 2 * pad) * (t - (now - 7 * D)) / (7 * D); };
    var y = function (v) { return hi === lo ? Hh / 2 : pad + (Hh - 2 * pad) * (1 - (v - lo) / (hi - lo)); };
    var d = '';
    pts.forEach(function (q, i) { d += (i ? 'L' : 'M') + x(q.t).toFixed(1) + ' ' + y(q.v).toFixed(1) + ' '; });
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--grid)" stroke-width="1"/>' +
      '<path d="' + d + '" fill="none" stroke="' + colorVar(p, name) + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  function renderStandings(p, ranks, now) {
    var leaderTotal = ranks[0] ? ranks[0].total : 0;
    var html = '<h2>Standings</h2><div class="grid">';
    ranks.forEach(function (r) {
      var tier = TIERS[r.rank - 1];
      var n4 = net(p, r.name, now - 4 * H, now), n24 = net(p, r.name, now - D, now), mo = momentum(p, r.name, now);
      var gap = r.rank === 1 ? (leadersOf(ranks).length > 1 ? 'tied for the lead' : (ranks[1] ? 'leads by ' + (r.total - ranks[1].total || 'the tie-breaker') : ''))
        : leaderTotal === r.total ? 'level on points, behind on the tie-breaker' : (leaderTotal - r.total) + ' behind';
      var note = '';
      if (r.decided === 'earned') note = 'Tie on points broken by points earned (' + r.earned + ').';
      else if (r.decided === 'lost') note = 'Tie broken by fewest points lost (' + Math.abs(r.lost) + ').';
      else if (r.decided === 'tie') note = 'Dead heat on all three tie-breakers.';
      html += '<article class="card standing tier-' + (tier ? tier.key : 'none') + '" style="--c:' + colorVar(p, r.name) + '">' +
        '<span class="tier-badge">' + (tier ? tier.icon + ' ' + tier.label : '#' + r.rank) + '</span>' +
        '<div class="who"><span class="swatch"></span><h3>' + esc(r.name) + '</h3><span class="mood" title="mood">' + mood(r, ranks) + '</span></div>' +
        '<div class="total">' + r.total + '</div>' +
        '<div class="gap">' + esc(gap) + '</div>' +
        '<div class="deltas"><div>4h <b class="' + (n4 > 0 ? 'up' : n4 < 0 ? 'down' : '') + '">' + signed(n4) + '</b></div>' +
        '<div>24h <b class="' + (n24 > 0 ? 'up' : n24 < 0 ? 'down' : '') + '">' + signed(n24) + '</b></div>' +
        '<div>momentum <b class="' + mo.cls + '">' + mo.arrow + ' ' + mo.word + '</b></div>' +
        '<div>earned <b>' + r.earned + '</b> · lost <b>' + Math.abs(r.lost) + '</b></div></div>' +
        sparkline(p, r.name, now) +
        (note ? '<div class="tie-note">' + esc(note) + '</div>' : '') +
        '</article>';
    });
    $('#standings').innerHTML = html + '</div>';
  }

  function renderChart(p, ranks, now) {
    var el = $('#chart');
    if (!p.entries.length) { el.innerHTML = '<h2>Points over time</h2><div class="panel chart-empty">No rulings yet.</div>'; return; }
    var from = Math.min(p.start, p.entries[0].t), to = now;
    if (to - from < 6 * H) from = to - 6 * H;
    var W = Math.max(300, el.clientWidth - 30), Hh = 240, m = { t: 12, r: 70, b: 26, l: 30 };
    var series = p.competitors.map(function (name) { return { name: name, pts: cumulative(p, name, from, to) }; });
    var all = [0];
    series.forEach(function (s) { s.pts.forEach(function (q) { all.push(q.v); }); });
    var lo = Math.min.apply(null, all) - 1, hi = Math.max.apply(null, all) + 1;
    var x = function (t) { return m.l + (W - m.l - m.r) * (t - from) / (to - from); };
    var y = function (v) { return m.t + (Hh - m.t - m.b) * (1 - (v - lo) / (hi - lo)); };
    var changes = leadChanges(p).filter(function (c) { return c.t >= from; });

    var svg = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" width="' + W + '" height="' + Hh + '" role="img" aria-label="Cumulative points per competitor">';
    var step = Math.max(1, Math.ceil((hi - lo) / 6));
    for (var v = Math.ceil(lo); v <= hi; v += step) {
      svg += '<line class="gridline" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="tick" x="' + (m.l - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    if (lo < 0 && hi > 0) svg += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var t = from + (to - from) * i / ticks;
      svg += '<text class="tick" x="' + x(t).toFixed(1) + '" y="' + (Hh - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === ticks ? 'end' : 'middle') + '">' + esc(fmtShort(t)) + '</text>';
    }
    var labels = [];
    series.forEach(function (s) {
      var d = '';
      s.pts.forEach(function (q, i) {
        var px = x(q.t).toFixed(1), py = y(q.v).toFixed(1);
        d += i === 0 ? 'M' + px + ' ' + py : 'H' + px + ' V' + py; // step line: the score moves at the ruling
      });
      svg += '<path class="line" d="' + d + '" stroke="' + colorVar(p, s.name) + '"/>';
      var last = s.pts[s.pts.length - 1];
      labels.push({ name: s.name, v: last.v, y: y(last.v) });
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
    labels.forEach(function (lb) {
      svg += '<text class="endlabel" x="' + (W - m.r + 8) + '" y="' + (lb.y + 4).toFixed(1) + '">' + esc(lb.name.replace(/^Test-/, '')) + ' ' + lb.v + '</text>';
    });
    changes.forEach(function (c) {
      c.to.forEach(function (name) {
        var v = net(p, name, -Infinity, c.t);
        svg += '<circle class="marker" cx="' + x(c.t).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="5" fill="' + colorVar(p, name) + '"><title>' + esc(listNames(c.to) + ' took the lead, ' + fmtLocal(c.t)) + '</title></circle>';
      });
    });
    svg += '<line id="xhair" class="crosshair" x1="0" x2="0" y1="' + m.t + '" y2="' + (Hh - m.b) + '" visibility="hidden"/>' +
      '<rect id="hit" x="' + m.l + '" y="0" width="' + (W - m.l - m.r) + '" height="' + Hh + '" fill="transparent"/></svg>';
    var legend = '<div class="legend">' + p.competitors.map(function (n) { return '<span style="--c:' + colorVar(p, n) + '">' + esc(n) + '</span>'; }).join('') + '</div>';
    el.innerHTML = '<h2>Points over time</h2><div class="panel">' + legend + svg + '<div class="tip" id="tip" hidden></div></div>' +
      '<p class="muted" style="font-size:.74rem;margin:6px 0 0">Dots mark lead changes' + (changes.length ? ' (' + changes.length + ' so far)' : '') + '.</p>';

    var hit = $('#hit', el), tip = $('#tip', el), xh = $('#xhair', el), svgEl = $('svg', el);
    function show(ev) {
      var rect = svgEl.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * W / rect.width;
      var t = from + (px - m.l) / (W - m.l - m.r) * (to - from);
      t = Math.max(from, Math.min(to, t));
      xh.setAttribute('x1', x(t).toFixed(1)); xh.setAttribute('x2', x(t).toFixed(1)); xh.setAttribute('visibility', 'visible');
      var rows = ranking(p, t).map(function (r) { return '<div class="row"><span style="--c:' + colorVar(p, r.name) + '">' + esc(r.name) + '</span><b>' + r.total + '</b></div>'; }).join('');
      tip.innerHTML = '<div class="muted">' + esc(fmtLocal(t)) + '</div>' + rows;
      tip.hidden = false;
      var left = (ev.clientX - rect.left) + 12;
      if (left + 140 > rect.width) left = (ev.clientX - rect.left) - 150;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '36px';
    }
    function hide() { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
  }

  function renderAwards(p, ranks, now, phase) {
    var list = [];
    function best(metric, pick, filter) {
      var rows = ranks.map(function (r) { return { name: r.name, v: metric(r.name) }; }).filter(filter);
      if (!rows.length) return null;
      rows.sort(function (a, b) { return pick === 'max' ? b.v - a.v : a.v - b.v; });
      var top = rows.filter(function (r) { return r.v === rows[0].v; });
      return { names: top.map(function (r) { return r.name; }), v: rows[0].v };
    }
    var ago24 = ranking(p, now - D);
    function rankAt(list, name) { var r = list.filter(function (x) { return x.name === name; })[0]; return r ? r.rank : ranks.length; }

    TIERS.forEach(function (tier, i) {
      var holders = ranks.filter(function (r) { return r.rank === i + 1; }).map(function (r) { return r.name; });
      list.push({ icon: tier.icon, name: tier.label + ' medal', holders: holders, detail: holders.length ? (ranks.filter(function (r) { return r.rank === i + 1; })[0].total + ' points') : 'nobody in this spot' });
    });
    var hot = best(function (n) { return net(p, n, now - D, now); }, 'max', function (r) { return r.v > 0; });
    list.push({ icon: '🔥', name: 'Hot streak', holders: hot ? hot.names : [], detail: hot ? signed(hot.v) + ' in the last 24h' : 'nobody is hot' });
    var cold = best(function (n) { return net(p, n, now - D, now); }, 'min', function (r) { return r.v < 0; });
    list.push({ icon: '🥶', name: 'Cold snap', holders: cold ? cold.names : [], detail: cold ? signed(cold.v) + ' in the last 24h' : 'nobody is sliding' });
    var comeback = best(function (n) { return rankAt(ago24, n) - rankAt(ranks, n); }, 'max', function (r) { return r.v > 0; });
    list.push({ icon: '🚀', name: 'Comeback kid', holders: comeback ? comeback.names : [], detail: comeback ? 'up ' + comeback.v + ' place' + (comeback.v > 1 ? 's' : '') + ' since yesterday' : 'no movers' });
    var pet = best(function (n) { return count(p, n, now - D, now, 1); }, 'max', function (r) { return r.v > 0; });
    list.push({ icon: '🏅', name: 'Teacher\'s pet', holders: pet ? pet.names : [], detail: pet ? pet.v + ' positive ruling' + (pet.v > 1 ? 's' : '') + ' in 24h' : 'no good deeds lately' });
    var villain = best(function (n) { return count(p, n, now - D, now, -1); }, 'max', function (r) { return r.v > 0; });
    list.push({ icon: '😈', name: 'Villain', holders: villain ? villain.names : [], detail: villain ? villain.v + ' negative ruling' + (villain.v > 1 ? 's' : '') + ' in 24h' : 'everyone behaved' });
    var busiest = best(function (n) { return ranks.filter(function (r) { return r.name === n; })[0].n; }, 'max', function (r) { return r.v > 0; });
    list.push({ icon: '📣', name: 'Judge\'s attention', holders: busiest ? busiest.names : [], detail: busiest ? busiest.v + ' rulings overall' : 'no rulings yet' });

    var html = '<h2>Awards</h2><div class="grid">';
    list.forEach(function (a) {
      html += '<div class="award' + (a.holders.length ? '' : ' vacant') + '"><div class="icon">' + a.icon + '</div><div class="name">' + esc(a.name) + '</div>' +
        '<div class="holder">' + (a.holders.length ? esc(listNames(a.holders)) : 'vacant') + '</div><div class="detail">' + esc(a.detail) + '</div></div>';
    });
    $('#awards').innerHTML = html + '</div>';
  }

  function renderOdds(p, ranks, now, phase) {
    var scores = ranks.map(function (r) { return { name: r.name, s: r.total + 0.5 * net(p, r.name, now - D, now) }; });
    var sum = 0;
    scores.forEach(function (q) { q.w = Math.exp(q.s / 3); sum += q.w; });
    var html = '<h2>Odds board</h2><div class="panel"><table><thead><tr><th>Horse</th><th></th><th class="num">Odds</th><th class="num">Chance</th></tr></thead><tbody>';
    scores.forEach(function (q) {
      var pr = q.w / sum, odds = pr > 0 ? (1 - pr) / pr : 99;
      html += '<tr style="--c:' + colorVar(p, q.name) + '"><td>' + esc(q.name) + '</td><td><div class="bar"><i style="width:' + (pr * 100).toFixed(0) + '%"></i></div></td>' +
        '<td class="num">' + (odds < 1 ? '1 to ' + (1 / odds).toFixed(1) : odds.toFixed(1) + ' to 1') + '</td><td class="num">' + (pr * 100).toFixed(0) + '%</td></tr>';
    });
    html += '</tbody></table><p class="fine">Odds from current points and the last 24 hours of form. For entertainment only. The house always wins, and the house is the judge.</p></div>';
    $('#odds').innerHTML = html;
  }

  function renderRulings(p, now) {
    var items = p.entries.slice().reverse().slice(0, 40);
    var html = '<h2>The judge\'s rulings</h2><div class="panel">';
    if (!items.length) html += '<div class="chart-empty">No rulings yet. The judge is thinking.</div>';
    items.forEach(function (e) {
      var day = dayOf(p, e.t);
      html += '<div class="ruling" style="--c:' + colorVar(p, e.c) + '"><div class="pts' + (e.p < 0 ? ' neg' : '') + '">' + signed(e.p) + '</div>' +
        '<div class="text"><span class="name">' + esc(e.c) + '</span>' + (e.r ? ' <span class="reason">' + esc(e.r) + '</span>' : '') + '</div>' +
        '<div class="when">' + esc(fmtAgo(e.t, now)) + '<small>' + esc(fmtLocal(e.t)) + (day ? ' · day ' + day.n : '') + '</small></div></div>';
    });
    if (p.entries.length > items.length) html += '<p class="muted" style="font-size:.78rem;margin:8px 0 0">Showing the last ' + items.length + ' of ' + p.entries.length + ' rulings.</p>';
    $('#rulings').innerHTML = html + '</div>';
  }

  function renderSponsor() {
    var sp = CFG.sponsor;
    var el = $('#sponsor');
    if (!sp || !sp.name) { el.hidden = true; return; }
    var mark = sp.logo
      ? '<img class="sponsor-logo" src="' + esc(sp.logo) + '" alt="' + esc(sp.name) + '">'
      : '<span class="sponsor-name">' + esc(sp.name) + '</span>';
    el.innerHTML = '<a class="sponsor-card" href="' + esc(sp.url) + '" target="_blank" rel="noopener sponsored">' +
      '<span class="sponsor-art" aria-hidden="true"></span>' +
      '<span class="sponsor-text"><span class="sponsor-kicker">Sponsored by</span>' + mark + '</span>' +
      (sp.label ? '<span class="sponsor-url">' + esc(sp.label) + ' ›</span>' : '') + '</a>';
    el.hidden = false;
  }

  function confetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var box = document.createElement('div');
    box.className = 'confetti';
    var colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', '#e0e0e0', '#b8742f'];
    for (var i = 0; i < 90; i++) {
      var s = document.createElement('i');
      s.style.left = (Math.random() * 100) + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDuration = (3 + Math.random() * 3) + 's';
      s.style.animationDelay = (Math.random() * 2) + 's';
      s.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 8000);
  }

  /* ---------- push notifications ---------- */
  function setupPush() {
    var btn = $('#notifyBtn');
    if (!CFG.oneSignalAppId) return;
    btn.hidden = false;
    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    var ready = false, failed = '', startedAt = Date.now();
    window.__pushDebug = { stage: 'loading sdk' };
    function fail(msg) {
      failed = msg;
      window.__pushDebug.stage = 'failed';
      window.__pushDebug.error = msg;
      console.warn('Push setup failed:', msg);
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(function (OneSignal) {
      window.__pushDebug.stage = 'init';
      var init;
      try {
        init = OneSignal.init({
          appId: CFG.oneSignalAppId,
          serviceWorkerParam: { scope: CFG.swScope },
          serviceWorkerPath: CFG.swPath,
          notifyButton: { enable: false }
        });
      } catch (err) {
        fail(String(err && err.message || err));
        return;
      }
      return Promise.resolve(init).then(function () {
        ready = true;
        window.__pushDebug.stage = 'ready';
        window.__pushDebug.supported = OneSignal.Notifications.isPushSupported();
        refresh(OneSignal);
        OneSignal.User.PushSubscription.addEventListener('change', function () { refresh(OneSignal); });
      }).catch(function (err) { fail(String(err && err.message || err)); });
    });
    var s = document.createElement('script');
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    s.defer = true;
    s.onerror = function () { fail('the notification service (cdn.onesignal.com) was blocked. A privacy or ad-blocking extension, or a DNS filter, is the usual cause. Allow onesignal.com for this site and reload. If you are offline, try again once connected.'); };
    document.head.appendChild(s);

    function refresh(OneSignal) {
      var on = OneSignal.Notifications.permission && OneSignal.User.PushSubscription.optedIn;
      btn.innerHTML = '🔔<span class="label">' + (on ? ' Notifications on' : ' Notifications') + '</span>';
      btn.setAttribute('aria-label', on ? 'Notifications on' : 'Turn on notifications');
      btn.classList.toggle('on', !!on);
    }
    btn.addEventListener('click', function () {
      if (isIOS && !standalone) { $('#installHelp').showModal(); return; }
      if (failed) { alert('Notifications are not available: ' + failed); return; }
      if (!ready) {
        var secs = Math.round((Date.now() - startedAt) / 1000);
        if (secs < 8) { alert('One moment, the notification service is still loading.'); return; }
        var ios = (navigator.userAgent.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.');
        var pushApi = typeof PushSubscriptionOptions !== 'undefined';
        var why = window.__pushDebug.stage === 'loading sdk' && !pushApi
          ? 'This browser does not offer web push here. On iPhone it works only from the Home Screen icon, on iOS 16.4 or later.'
          : 'The notification service has not started after ' + secs + ' seconds.';
        alert(why + '\n\nDetails: stage ' + window.__pushDebug.stage + ', push API ' + (pushApi ? 'yes' : 'no') +
          ', home screen ' + (standalone ? 'yes' : 'no') + (ios ? ', iOS ' + ios : '') + '. Send Matt a screenshot of this message.');
        return;
      }
      window.OneSignalDeferred.push(function (OneSignal) {
        if (OneSignal.Notifications.permission && OneSignal.User.PushSubscription.optedIn) {
          return OneSignal.User.PushSubscription.optOut().then(function () { refresh(OneSignal); });
        }
        return OneSignal.Notifications.requestPermission().then(function () {
          if (!OneSignal.User.PushSubscription.optedIn) return OneSignal.User.PushSubscription.optIn();
        }).then(function () { refresh(OneSignal); });
      });
    });
  }

  /* ---------- boot ---------- */
  function tick() {
    var p = state.p;
    if (!p) return;
    var now = Date.now();
    var c = $('#sealCount');
    if (c) c.textContent = fmtDur(p.end - now);
    if (now - state.lastFetch > CFG.pollMs && document.visibilityState === 'visible') fetchData();
    else if (Math.floor(now / 1000) % 30 === 0) render();
  }

  $('#refreshBtn').addEventListener('click', function () { fetchData(true); });
  $('#installLink').addEventListener('click', function () { $('#installHelp').showModal(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') fetchData(); });
  window.addEventListener('resize', function () { if (state.p) render(); });

  renderSponsor();
  loadCache();
  if (state.p) render();
  fetchData();
  setInterval(tick, 1000);
  setupPush();
})();
