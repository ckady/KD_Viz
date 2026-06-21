'use strict';

const THERMAL_LEVELS = { Nominal: 0, Fair: 0.4, Serious: 0.75, Critical: 1, Sleeping: 0 };

/**
 * Turns raw collector + powermetrics samples into a normalized, smoothed signal
 * frame in 0..1, with rolling baselines and anomaly/status flags for the
 * renderer's auto-switch logic.
 */
function createSignalProcessor(config) {
  const norm = config.normalization;
  const emaAlpha = (config.smoothing && config.smoothing.ema) || 0.35;
  const baselineCfg = config.baseline || { windowSamples: 120, anomalyK: 2.5, minSamples: 20 };

  const ema = {};            // smoothed value per signal key
  const baselines = {};      // { key: { samples:[], mean, std } }

  // Track sustained conditions for auto-switch debouncing.
  let netDownStreak = 0;
  let thermalStreak = 0;
  let thermalCooldown = 0;

  function smooth(key, value) {
    if (value == null || Number.isNaN(value)) return ema[key] ?? 0;
    const prev = ema[key];
    ema[key] = prev == null ? value : prev + emaAlpha * (value - prev);
    return ema[key];
  }

  function updateBaseline(key, value) {
    let b = baselines[key];
    if (!b) b = baselines[key] = { samples: [] };
    b.samples.push(value);
    if (b.samples.length > baselineCfg.windowSamples) b.samples.shift();
    const n = b.samples.length;
    const mean = b.samples.reduce((a, x) => a + x, 0) / n;
    const variance = b.samples.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
    b.mean = mean;
    b.std = Math.sqrt(variance);
    b.ready = n >= baselineCfg.minSamples;
    return b;
  }

  function isAnomalous(key, value) {
    const b = baselines[key];
    if (!b || !b.ready) return false;
    return value > b.mean + baselineCfg.anomalyK * b.std;
  }

  function process(raw, pm) {
    const n = (x, max) => clamp01(x / max);

    // --- normalize raw inputs to 0..1 ---
    const values = {
      cpuTotal: smooth('cpuTotal', raw.cpuTotal),
      ramUsed: smooth('ramUsed', raw.ramUsed),
      swapUsed: smooth('swapUsed', raw.swapUsed),
      netUp: smooth('netUp', n(raw.netUpBytesSec, norm.netBytesPerSecMax)),
      netDown: smooth('netDown', n(raw.netDownBytesSec, norm.netBytesPerSecMax)),
      diskRead: smooth('diskRead', n(raw.diskReadOpsSec, norm.diskOpsPerSecMax)),
      diskWrite: smooth('diskWrite', n(raw.diskWriteOpsSec, norm.diskOpsPerSecMax)),
      procCount: clamp01((raw.procCount || 0) / 1500)
    };

    const cores = (raw.cpuCores || []).map((c, i) => smooth('core' + i, c));

    // --- GPU (powermetrics; needs the sudoers entry) ---
    const gpuAvailable = pm && pm.available === true;
    if (gpuAvailable && pm.gpu != null) values.gpu = smooth('gpu', clamp01(pm.gpu));
    if (gpuAvailable && pm.gpuFreqMHz != null) values.gpuFreqMHz = pm.gpuFreqMHz;
    const gpuStates = (gpuAvailable && pm.gpuStates) ? pm.gpuStates : [];

    // --- temp / thermal / fan: independent of GPU availability. Die temp comes
    // from the Apple Silicon helper; thermal level + fan from powermetrics. ---
    if (pm) {
      if (pm.tempC != null) {
        const tNorm = clamp01((pm.tempC - norm.tempBaseC) / (norm.tempMaxC - norm.tempBaseC));
        values.temp = smooth('temp', tNorm);
        values.tempC = pm.tempC;
      }
      if (pm.thermalLevel != null) {
        values.thermal = THERMAL_LEVELS[pm.thermalLevel] ?? 0;
        values.thermalLevel = pm.thermalLevel;
      }
      if (pm.fanRpm != null) {
        values.fanRpm = pm.fanRpm;
        const lo = pm.fanMin || 0;
        const hi = pm.fanMax || (lo + 1);
        values.fan = smooth('fan', clamp01(hi > lo ? (pm.fanRpm - lo) / (hi - lo) : 0));
      }
    }

    // --- raw byte rates passed through for the dashboard/HUD text ---
    const rates = {
      netUpBytesSec: raw.netUpBytesSec,
      netDownBytesSec: raw.netDownBytesSec,
      diskReadOpsSec: raw.diskReadOpsSec,
      diskWriteOpsSec: raw.diskWriteOpsSec,
      procCount: raw.procCount
    };

    const topProcs = raw.topProcs || [];

    // --- baselines + anomaly flags on the meaningful signals ---
    const anomalies = {};
    for (const key of ['cpuTotal', 'ramUsed', 'netDown', 'netUp', 'diskRead', 'diskWrite']) {
      updateBaseline(key, values[key]);
      anomalies[key] = isAnomalous(key, values[key]);
    }
    if (values.temp != null) {
      updateBaseline('temp', values.temp);
      anomalies.temp = isAnomalous('temp', values.temp);
    }

    // --- status flags for auto-switch ---
    const ac = config.autoSwitch || {};

    // Network: down when no interface up AND no traffic, sustained.
    const noTraffic = raw.netUpBytesSec < 1 && raw.netDownBytesSec < 1;
    const netDownNow = !raw.netIfaceUp && noTraffic;
    netDownStreak = netDownNow ? netDownStreak + 1 : 0;
    const networkLost = ac.network ? netDownStreak >= ac.network.sustainSamples : false;

    // Thermal alert only on genuine concern: hard temp limit OR macOS thermal
    // pressure Serious+. (The statistical temp anomaly was too trigger-happy —
    // any sustained load tripped it; that's still reflected in the visuals, just
    // not the full ALERT switch.)
    const hardTemp = ac.thermal && values.tempC != null && values.tempC >= ac.thermal.hardTempC;
    const seriousLevel = (values.thermal ?? 0) >= 0.75;
    const thermalNow = hardTemp || seriousLevel;
    if (thermalNow) {
      thermalStreak += 1;
      thermalCooldown = ac.thermal ? ac.thermal.cooldownSamples : 0;
    } else {
      thermalStreak = 0;
      if (thermalCooldown > 0) thermalCooldown -= 1;
    }
    const thermalAlert = ac.thermal
      ? thermalStreak >= ac.thermal.sustainSamples || thermalCooldown > 0
      : false;

    return {
      t: raw.t,
      values,
      cores,
      rates,
      topProcs,
      gpuStates,
      anomalies,
      gpuAvailable,
      status: {
        networkLost,
        thermalAlert,
        thermalLevel: values.thermalLevel || (gpuAvailable ? 'Nominal' : 'n/a')
      },
      baselines: snapshotBaselines()
    };
  }

  function snapshotBaselines() {
    const out = {};
    for (const k of Object.keys(baselines)) {
      out[k] = { mean: baselines[k].mean, std: baselines[k].std, ready: baselines[k].ready };
    }
    return out;
  }

  return { process };
}

function clamp01(x) {
  if (x == null || Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

module.exports = { createSignalProcessor };
