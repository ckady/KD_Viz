'use strict';

const { spawn } = require('child_process');

/**
 * Streams `sudo powermetrics` and parses GPU / thermal / power out of its
 * plist output. Requires a passwordless sudoers entry (see scripts/setup-sudoers.sh).
 *
 * Designed to degrade gracefully: if sudo prompts for a password or the binary
 * isn't permitted, we report { available: false, reason } and never block.
 *
 * Calls `onSample(sample)` whenever a fresh reading is parsed.
 * Returns a stop function.
 */
function startPowermetrics(config, onSample) {
  const intervalMs = (config.powermetrics && config.powermetrics.intervalMs) || 1000;
  const samplers = (config.powermetrics && config.powermetrics.samplers) ||
    ['gpu_power', 'thermal', 'cpu_power'];

  let stopped = false;
  let child = null;
  let buffer = '';

  function reportUnavailable(reason) {
    onSample({ available: false, reason });
  }

  function start() {
    if (stopped) return;

    const args = [
      '-n', 'powermetrics',
      '--samplers', samplers.join(','),
      '-i', String(intervalMs),
      '--format', 'plist'
    ];
    // `sudo -n` => non-interactive: fail fast instead of hanging on a prompt.
    child = spawn('sudo', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.on('error', (err) => {
      reportUnavailable('spawn failed: ' + err.message);
    });

    child.stderr.on('data', (d) => {
      const s = d.toString();
      if (/a password is required|sudo:/.test(s)) {
        reportUnavailable('sudoers not configured (run npm run setup-gpu)');
      }
    });

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // powermetrics emits one <plist>...</plist> document per interval,
      // separated by a NUL byte in plist mode.
      let idx;
      while ((idx = buffer.indexOf('</plist>')) !== -1) {
        const doc = buffer.slice(0, idx + '</plist>'.length);
        buffer = buffer.slice(idx + '</plist>'.length).replace(/^\0/, '');
        const sample = parsePlist(doc);
        if (sample) onSample(sample);
      }
      if (buffer.length > 2_000_000) buffer = ''; // safety valve
    });

    child.on('close', (code) => {
      child = null;
      if (stopped) return;
      // Non-zero on permission failure; retry slowly so we don't spin.
      if (code !== 0) reportUnavailable('powermetrics exited code ' + code);
      setTimeout(start, 5000);
    });
  }

  start();

  return function stop() {
    stopped = true;
    if (child) {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
  };
}

/**
 * Minimal, dependency-free plist scraper. We only need a handful of numeric
 * fields, so we pull them by key rather than building a full plist tree.
 */
function parsePlist(doc) {
  const out = { available: true, t: Date.now() };

  // GPU. Scope to the `gpu` dict (the cpu_power sampler also emits cluster
  // `idle_ratio`, which appears first — reading the first match misreports CPU
  // idle as GPU). active = 1 - idle_ratio. Also pull the DVFM clock-state
  // distribution: Apple Silicon aggregates all GPU cores into one residency, so
  // per-core isn't available, but per-frequency-state residency is — a real
  // multi-channel GPU breakdown we visualize as a clock spectrum.
  const g = parseGpu(doc);
  if (g) {
    // Frequency-weighted utilization spans 0..100 far more linearly than raw
    // active residency (which pins high for any activity). `util` ≈ how much of
    // the GPU's clock-capacity is in use; falls back to residency if no states.
    if (g.util != null) out.gpu = g.util;
    else if (g.active != null) out.gpu = g.active;
    if (g.active != null) out.gpuResidency = g.active;
    if (g.freqMHz != null) out.gpuFreqMHz = g.freqMHz;
    if (g.states.length) out.gpuStates = g.states;
  }

  // Thermal pressure: powermetrics emits a string level under the thermal sampler.
  const tp = keyString(doc, 'thermal_pressure') || keyString(doc, 'pressure');
  if (tp) out.thermalLevel = tp; // e.g. Nominal / Fair / Serious / Critical

  // Die temperature (smc sampler on Apple Silicon). Try several key spellings.
  const temp =
    keyReal(doc, 'GPU die temperature') ??
    keyReal(doc, 'CPU die temperature') ??
    keyReal(doc, 'package_temp') ??
    keyReal(doc, 'die_temp');
  if (temp != null) out.tempC = temp;

  // Fan RPM if present.
  const fan = keyReal(doc, 'Fan') ?? keyReal(doc, 'fan_speed') ?? keyReal(doc, 'rpm');
  if (fan != null) out.fanRpm = fan;

  return out;
}

// Parse the GPU sub-dict: active residency (0..1), current frequency (MHz), and
// the DVFM clock-state distribution (per-frequency used_ratio).
function parseGpu(doc) {
  const m = doc.match(/<key>gpu<\/key>\s*<dict>/i);
  // The dvfm_states array can be a few KB; slice generously to capture it.
  const scope = m ? doc.slice(m.index, m.index + 9000) : doc;

  let active = null;
  const idle = keyReal(scope, 'idle_ratio');
  if (idle != null) active = clamp01(idle > 1 ? 1 - idle / 100 : 1 - idle);
  else {
    const a = keyReal(scope, 'active_ratio');
    if (a != null) active = clamp01(a > 1 ? a / 100 : a);
  }

  // freq_hz is reported in MHz on Apple Silicon despite the name.
  const freqMHz = keyReal(scope, 'freq_hz');

  // dvfm_states: array of { freq (MHz int), used_ns, used_ratio (0..1) }.
  // The used_ratios sum to the active residency, so a freq-weighted sum gives a
  // capacity utilization: Σ(used_ratio_i · freq_i) / maxFreq → 0 idle, ~1 maxed.
  const states = [];
  const re = /<key>freq<\/key>\s*<integer>(\d+)<\/integer>[\s\S]*?<key>used_ratio<\/key>\s*<real>([0-9.eE+-]+)<\/real>/g;
  let mm;
  while ((mm = re.exec(scope)) !== null) {
    states.push({ mhz: parseInt(mm[1], 10), r: Math.max(0, parseFloat(mm[2])) });
    if (states.length >= 16) break;
  }

  let util = active;
  if (states.length) {
    const maxFreq = Math.max(...states.map((s) => s.mhz));
    if (maxFreq > 0) {
      util = clamp01(states.reduce((acc, s) => acc + s.r * (s.mhz / maxFreq), 0));
    }
  }

  return { active, util, freqMHz, states };
}

function keyReal(doc, key) {
  const re = new RegExp(
    '<key>' + escapeRe(key) + '</key>\\s*<real>([^<]+)</real>', 'i'
  );
  const m = doc.match(re);
  if (m) return parseFloat(m[1]);
  const reInt = new RegExp(
    '<key>' + escapeRe(key) + '</key>\\s*<integer>([^<]+)</integer>', 'i'
  );
  const mi = doc.match(reInt);
  return mi ? parseFloat(mi[1]) : null;
}

function keyString(doc, key) {
  const re = new RegExp(
    '<key>' + escapeRe(key) + '</key>\\s*<string>([^<]*)</string>', 'i'
  );
  const m = doc.match(re);
  return m ? m[1] : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

module.exports = { startPowermetrics };
