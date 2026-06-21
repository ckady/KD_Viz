'use strict';

import { signalBus } from './signalBus.js';

function fmtBytes(b) {
  if (b == null) return '--';
  if (b < 1024) return b.toFixed(0) + ' B/s';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' K/s';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' M/s';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' G/s';
}
function fmtOps(n) {
  if (n == null) return '--';
  if (n < 1000) return Math.round(n) + ' io/s';
  return (n / 1000).toFixed(1) + 'k io/s';
}
function pct(x) { return (Math.round((x || 0) * 100)).toString().padStart(3, ' ') + '%'; }

export function fmtTemp(tempC, unit) {
  if (tempC == null) return null;
  return unit === 'C'
    ? Math.round(tempC) + '°C'
    : Math.round(tempC * 9 / 5 + 32) + '°F';
}

export function createHud(el, config) {
  let gpuHint = '';
  const unit = (config && config.tempUnit) || 'F';
  return {
    setGpuHint(text) { gpuHint = text || ''; },
    render() {
      const f = signalBus.frame;
      if (!f) { el.textContent = 'waiting for signals…'; return; }
      const v = f.values;
      const r = f.rates;
      const t = fmtTemp(v.tempC, unit) || (v.tempC == null && f.values.temp == null ? 'n/a' : '--');
      const gpu = v.gpu != null ? pct(v.gpu) : (f.gpuAvailable ? '  0%' : ' n/a');
      const fan = v.fanRpm != null ? Math.round(v.fanRpm) + ' rpm' : '--';
      const lines = [
        `CPU ${pct(v.cpuTotal)}   RAM ${pct(v.ramUsed)}   GPU ${gpu}   TEMP ${t}  ${f.status.thermalLevel}   FAN ${fan}`,
        `NET ↓ ${fmtBytes(r.netDownBytesSec)}  ↑ ${fmtBytes(r.netUpBytesSec)}    DISK R ${fmtOps(r.diskReadOpsSec)}  W ${fmtOps(r.diskWriteOpsSec)}`,
        `PROCS ${r.procCount}   ${f.status.networkLost ? '⚠ NETWORK LOST  ' : ''}${f.status.thermalAlert ? '⚠ THERMAL  ' : ''}${gpuHint}`
      ];
      el.textContent = lines.join('\n');
    }
  };
}
