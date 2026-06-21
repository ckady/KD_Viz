'use strict';

const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

// Watches Claude Code session transcripts (~/.claude/projects/<proj>/<uuid>.jsonl)
// and derives, machine-wide: cumulative tokens + $ cost (today / all-time / active
// session), live throughput (fresh tokens/min), and the active session's context-
// window fill %. Transcripts are append-only, so we tail each file from a byte
// offset rather than re-reading it.
//
// Pricing comes from config.claude.pricing ($/MTok). Cache read = 0.1x input;
// cache write = 1.25x input (5-min TTL) or 2x (1-hour TTL) — Claude Code uses the
// 1-hour cache, and the transcript exposes the split, so we price each correctly.

function startClaudeUsage(config, onSample) {
  const cfg = config.claude || {};
  const pricing = cfg.pricing || {};
  const pollMs = cfg.pollMs || 2000;
  const windowSec = cfg.throughputWindowSec || 60;
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');

  let stopped = false;
  let timer = null;

  // Per-file tail state + cumulative (all-time) totals for that file.
  const files = new Map(); // path -> { offset, leftover, mtimeMs, last, cost, tokens }

  // Machine-wide running totals.
  let allCost = 0;
  let allTokens = 0;
  let todayCost = 0;
  let todayTokens = 0;
  let today = new Date().toDateString();

  // Throughput ring: fresh-token events with timestamps.
  const events = []; // { t, fresh }

  // Cost timeline for rolling 5h / 7d budget windows.
  const costTimeline = []; // { t, cost }

  function rateFor(model) {
    const m = (model || '').toLowerCase();
    if (m.includes('opus')) return pricing.opus || pricing.default;
    if (m.includes('sonnet')) return pricing.sonnet || pricing.default;
    if (m.includes('haiku')) return pricing.haiku || pricing.default;
    return pricing.default || { ctx: 1000000, in: 5, out: 25 };
  }

  // Parse one transcript line; accumulate its usage. `initial` entries (from the
  // startup backfill) skip the throughput ring (their timestamps are old anyway).
  function ingestLine(line, fileState) {
    if (line.indexOf('"usage"') === -1) return;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { return; }
    const msg = obj.message;
    if (!msg || !msg.usage) return;
    const u = msg.usage;
    const model = msg.model || obj.model;
    const r = rateFor(model);

    const input = u.input_tokens || 0;
    const output = u.output_tokens || 0;
    const cacheCreate = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;

    // Cache-write cost: split 1h (2x) vs 5m (1.25x) when the breakdown is present.
    const cc = u.cache_creation || {};
    const c1h = cc.ephemeral_1h_input_tokens || 0;
    const c5m = cc.ephemeral_5m_input_tokens || 0;
    let cacheCreateCost;
    if (c1h || c5m) cacheCreateCost = (c1h * r.in * 2 + c5m * r.in * 1.25) / 1e6;
    else cacheCreateCost = (cacheCreate * r.in * 1.25) / 1e6;

    const cost = (input * r.in + output * r.out + cacheRead * r.in * 0.1) / 1e6 + cacheCreateCost;
    const fresh = input + output + cacheCreate; // excludes re-read cache
    const contextTokens = input + cacheRead + cacheCreate + output;

    const t = Date.parse(obj.timestamp) || Date.now();

    // Totals.
    allCost += cost; allTokens += fresh;
    fileState.cost += cost; fileState.tokens += fresh;
    fileState.last = { contextTokens, model, window: r.ctx, t };

    if (new Date(t).toDateString() === today) { todayCost += cost; todayTokens += fresh; }
    events.push({ t, fresh });
    costTimeline.push({ t, cost });
  }

  async function readNew(p, state) {
    let fh;
    try { fh = await fsp.open(p, 'r'); } catch (_) { return; }
    try {
      const st = await fh.stat();
      state.mtimeMs = st.mtimeMs;
      if (st.size <= state.offset) return;
      const len = st.size - state.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, state.offset);
      state.offset = st.size;
      const text = state.leftover + buf.toString('utf8');
      const lines = text.split('\n');
      state.leftover = lines.pop(); // trailing partial line (no newline yet)
      for (const line of lines) if (line) ingestLine(line, state);
    } catch (_) { /* ignore transient read errors */ } finally {
      await fh.close().catch(() => {});
    }
  }

  async function listTranscripts() {
    const out = [];
    let projDirs;
    try { projDirs = await fsp.readdir(projectsDir, { withFileTypes: true }); }
    catch (_) { return out; }
    for (const d of projDirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(projectsDir, d.name);
      let entries;
      try { entries = await fsp.readdir(dir); } catch (_) { continue; }
      for (const f of entries) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
    }
    return out;
  }

  async function tick() {
    if (stopped) return;
    try {
      // Reset "today" totals across a midnight boundary.
      const day = new Date().toDateString();
      if (day !== today) { today = day; todayCost = 0; todayTokens = 0; }

      const paths = await listTranscripts();
      for (const p of paths) {
        let state = files.get(p);
        if (!state) {
          state = { offset: 0, leftover: '', mtimeMs: 0, last: null, cost: 0, tokens: 0 };
          files.set(p, state);
        }
        await readNew(p, state);
      }

      // Active session = most recently modified transcript.
      let active = null, activeState = null;
      for (const [, s] of files) {
        if (s.last && (!activeState || s.mtimeMs > activeState.mtimeMs)) { activeState = s; active = s.last; }
      }

      // Throughput over the trailing window.
      const now = Date.now();
      const cutoff = now - windowSec * 1000;
      while (events.length && events[0].t < cutoff) events.shift();
      const freshInWindow = events.reduce((a, e) => a + e.fresh, 0);

      // Rolling 5h and 7d budget windows.
      const h5 = now - 5 * 3600 * 1000;
      const d7 = now - 7 * 24 * 3600 * 1000;
      while (costTimeline.length && costTimeline[0].t < d7) costTimeline.shift();
      const fiveHourCost = costTimeline.filter(e => e.t >= h5).reduce((s, e) => s + e.cost, 0);
      const weekCost     = costTimeline.reduce((s, e) => s + e.cost, 0);

      onSample({
        available: true,
        updatedAt: Date.now(),
        context: active
          ? { pct: Math.max(0, Math.min(1, active.contextTokens / active.window)),
              tokens: active.contextTokens, window: active.window, model: active.model }
          : null,
        session: activeState ? { cost: activeState.cost, tokens: activeState.tokens } : null,
        today: { cost: todayCost, tokens: todayTokens },
        allTime: { cost: allCost, tokens: allTokens },
        throughputPerMin: (freshInWindow / windowSec) * 60,
        fiveHour: { cost: fiveHourCost },
        week: { cost: weekCost }
      });
    } catch (err) {
      onSample({ available: false, reason: err.message });
    } finally {
      if (!stopped) timer = setTimeout(tick, pollMs);
    }
  }

  tick();

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { startClaudeUsage };
