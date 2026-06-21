'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Streams Apple Silicon die temperature from the bundled `bin/thermo` helper
// (compiled from src/native/thermo.swift). powermetrics doesn't expose die temps
// on Apple Silicon, so this fills that gap. Degrades gracefully if the helper is
// missing (e.g. Swift toolchain absent at build time).
//
// Calls onSample({ available, tempC, tempAvg }) on each reading. Returns a stop fn.
function startAppleTemp(config, onSample) {
  const cfg = config.appleTemp || {};
  const intervalMs = cfg.intervalMs || 1000;
  // bin/ sits at the project root, mirrored in dev and in the packaged app:
  // <root>/src/main/metrics/appleTemp.js -> <root>/bin/thermo
  const bin = path.join(__dirname, '..', '..', '..', 'bin', 'thermo');

  let stopped = false;
  let child = null;
  let buffer = '';

  function start() {
    if (stopped) return;
    child = spawn(bin, [String(intervalMs)], { stdio: ['ignore', 'pipe', 'pipe'] });

    child.on('error', () => {
      onSample({ available: false, reason: 'thermo helper unavailable' });
    });

    child.stdout.on('data', (d) => {
      buffer += d.toString();
      let i;
      while ((i = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          if (typeof j.tempC === 'number' || typeof j.fanRpm === 'number') {
            onSample({
              available: true,
              tempC: j.tempC, tempAvg: j.tempAvg,
              fanRpm: j.fanRpm, fanMax: j.fanMax, fanMin: j.fanMin
            });
          }
        } catch (_) { /* ignore partial/garbled line */ }
      }
    });

    child.on('close', () => {
      child = null;
      if (!stopped) setTimeout(start, 5000); // helper died — retry slowly
    });
  }

  start();

  return function stop() {
    stopped = true;
    if (child) { try { child.kill('SIGTERM'); } catch (_) { /* ignore */ } }
  };
}

module.exports = { startAppleTemp };
