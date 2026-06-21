'use strict';

// MONITOR — a spin on macOS Activity Monitor. Left: a live top-process
// leaderboard with heat-mapped CPU bars that glide between samples. Right:
// the signature per-core "CPU History" scrolling graphs, a memory-pressure
// bar (green/amber/red, AM-style), and network + disk throughput graphs.
// Medium tier, mostly text + 2D fills.

import { rgba, clear } from './util.js';
import { signalBus as bus } from '../signalBus.js';

const HIST = 160;

let cfg;
let coreHist = [];          // per-core ring buffers
let procDisp = new Map();   // pid -> { cpu, mem, name } eased toward targets
let time = 0;

// Heat ramp: calm teal -> lime -> amber -> red as load climbs.
function heat(x) {
  x = Math.max(0, Math.min(1, x));
  const stops = [
    [0.0, [40, 200, 180]],
    [0.4, [120, 220, 90]],
    [0.7, [240, 200, 60]],
    [1.0, [255, 70, 70]]
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const t = (x - x0) / (x1 - x0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(255,70,70)';
}

export default {
  id: 'monitor',
  init({ config }) {
    cfg = config; time = 0; coreHist = []; procDisp = new Map();
  },
  update(dt) {
    time += dt;
    // Per-core history.
    const cores = bus.cores();
    if (coreHist.length !== cores.length) coreHist = cores.map(() => []);
    cores.forEach((v, i) => {
      const a = coreHist[i];
      a.push(v);
      if (a.length > HIST) a.shift();
    });

    // Ease process bars toward their latest targets; keep a stable set.
    const procs = bus.procs();
    const seen = new Set();
    const k = Math.min(1, dt * 4);
    for (const p of procs) {
      seen.add(p.pid);
      const cur = procDisp.get(p.pid) || { cpu: 0, mem: 0, name: p.name };
      cur.cpu += (p.cpu - cur.cpu) * k;
      cur.mem += (p.mem - cur.mem) * k;
      cur.name = p.name;
      cur.target = p.cpu;
      procDisp.set(p.pid, cur);
    }
    // Decay processes that dropped out of the top list, then drop them.
    for (const [pid, cur] of procDisp) {
      if (!seen.has(pid)) {
        cur.cpu += (0 - cur.cpu) * k;
        if (cur.cpu < 0.5) procDisp.delete(pid);
      }
    }
  },
  render(ctx) {
    const canvas = ctx.canvas, W = canvas.width, H = canvas.height;
    const dpr = W / window.innerWidth;
    clear(ctx, W, H, null);

    const pad = Math.round(28 * dpr);
    const colGap = Math.round(36 * dpr);
    const leftW = Math.round((W - pad * 2 - colGap) * 0.54);
    const rightX = pad + leftW + colGap;
    const rightW = W - rightX - pad;

    ctx.textBaseline = 'alphabetic';

    // ---- header ----
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `700 ${Math.round(20 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('ACTIVITY', pad, pad + 16 * dpr);
    const f = bus.frame;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = `${Math.round(12 * dpr)}px ui-monospace, Menlo, monospace`;
    const load = `${Math.round(bus.get('cpuTotal') * 100)}% CPU   ${Math.round(bus.get('ramUsed') * 100)}% MEM   ${f ? f.rates.procCount : 0} procs`;
    ctx.fillText(load, pad, pad + 34 * dpr);

    const top = pad + 56 * dpr;

    // ---- left: process leaderboard ----
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('TOP PROCESSES', pad, top);
    ctx.textAlign = 'right';
    ctx.fillText('CPU', pad + leftW, top);

    // Sorted snapshot of the eased display values.
    const rows = [...procDisp.entries()]
      .map(([pid, v]) => ({ pid, ...v }))
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 8);

    const rowH = Math.round(40 * dpr);
    const barH = Math.round(18 * dpr);
    let y = top + 18 * dpr;
    for (const p of rows) {
      const frac = Math.min(1, p.cpu / 100);
      const col = heat(frac);

      // name
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = `600 ${Math.round(13 * dpr)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(p.name, pad, y);
      // cpu value
      ctx.textAlign = 'right';
      ctx.fillStyle = col;
      ctx.fillText(p.cpu.toFixed(1) + '%', pad + leftW, y);

      // bar
      const by = y + 6 * dpr;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(pad, by, leftW, barH);
      // glow + fill
      ctx.fillStyle = rgbaFromRgb(col, 0.9);
      ctx.fillRect(pad, by, Math.max(2 * dpr, leftW * frac), barH);
      // mem ghost marker on same row (thin underline)
      const memFrac = Math.min(1, p.mem / 100);
      ctx.fillStyle = 'rgba(120,180,255,0.5)';
      ctx.fillRect(pad, by + barH + 2 * dpr, leftW * memFrac, 2 * dpr);

      y += rowH;
    }

    // ---- GPU clock spectrum (left column, below processes) ----
    // Apple Silicon aggregates the 10 GPU cores into one residency, but exposes
    // the DVFM clock-state distribution — a real per-frequency breakdown. Bars =
    // share of time at each GPU clock; cool (low clock) → hot red (maxed out).
    const states = bus.gpuStates().slice().sort((a, b) => a.mhz - b.mhz);
    const specLabelY = y + 14 * dpr;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('GPU CLOCK', pad, specLabelY);
    const gpuv = bus.get('gpu');
    const fMHz = f && f.values ? f.values.gpuFreqMHz : null;
    ctx.textAlign = 'right';
    if (states.length) {
      ctx.fillStyle = rgba(cfg.signals.gpu.color, 0.95);
      ctx.fillText(`${Math.round(gpuv * 100)}%   ${fMHz ? Math.round(fMHz) + ' MHz' : ''}`, pad + leftW, specLabelY);

      const specY = specLabelY + 10 * dpr;
      const specH = Math.min(H * 0.16, H - specY - pad * 1.8);
      const bw = leftW / states.length;
      const minMhz = states[0].mhz, maxMhz = states[states.length - 1].mhz;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(pad, specY, leftW, specH);
      states.forEach((s, i) => {
        const fpos = maxMhz > minMhz ? (s.mhz - minMhz) / (maxMhz - minMhz) : 0;
        const h = Math.max(1 * dpr, specH * Math.min(1, s.r));
        const x = pad + i * bw;
        ctx.fillStyle = heat(fpos);
        ctx.fillRect(x + 1, specY + (specH - h), Math.max(1, bw - 2), h);
      });
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('n/a', pad + leftW, specLabelY);
    }

    // ---- right column ----
    let ry = top;

    // CPU History grid (the iconic Activity Monitor view).
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('CPU HISTORY', rightX, ry);
    ry += 12 * dpr;

    const n = coreHist.length || 1;
    const gridCols = n > 6 ? 2 : 1;
    const gridRows = Math.ceil(n / gridCols);
    const cellGap = Math.round(6 * dpr);
    const gridH = Math.round(H * 0.34);
    const cellW = (rightW - cellGap * (gridCols - 1)) / gridCols;
    const cellH = (gridH - cellGap * (gridRows - 1)) / gridRows;

    for (let i = 0; i < n; i++) {
      const c = i % gridCols, r = Math.floor(i / gridCols);
      const cx = rightX + c * (cellW + cellGap);
      const cy = ry + r * (cellH + cellGap);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(cx, cy, cellW, cellH);
      const a = coreHist[i] || [];
      const last = a.length ? a[a.length - 1] : 0;
      ctx.beginPath();
      ctx.moveTo(cx, cy + cellH);
      for (let j = 0; j < a.length; j++) {
        const px = cx + (j / (HIST - 1)) * cellW;
        const py = cy + cellH - a[j] * cellH;
        ctx.lineTo(px, py);
      }
      ctx.lineTo(cx + ((a.length - 1) / (HIST - 1)) * cellW, cy + cellH);
      ctx.closePath();
      ctx.fillStyle = rgbaFromRgb(heat(last), 0.28);
      ctx.fill();
      ctx.strokeStyle = heat(last);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      for (let j = 0; j < a.length; j++) {
        const px = cx + (j / (HIST - 1)) * cellW;
        const py = cy + cellH - a[j] * cellH;
        j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ry += gridH + 22 * dpr;

    // Memory pressure bar (AM green/amber/red).
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('MEMORY PRESSURE', rightX, ry);
    ry += 10 * dpr;
    const pressure = Math.min(1, bus.get('ramUsed') * 0.85 + bus.get('swapUsed') * 0.6);
    const pcol = pressure < 0.6 ? 'rgb(90,210,120)' : pressure < 0.8 ? 'rgb(240,200,60)' : 'rgb(255,80,80)';
    const mbH = Math.round(16 * dpr);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(rightX, ry, rightW, mbH);
    ctx.fillStyle = pcol;
    ctx.fillRect(rightX, ry, rightW * pressure, mbH);
    ry += mbH + 24 * dpr;

    // Fan bar (RPM), if available.
    const fanV = f && f.values ? f.values.fan : null;
    const fanRpm = f && f.values ? f.values.fanRpm : null;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('FAN', rightX, ry);
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(cfg.signals.fan.color, 0.95);
    ctx.fillText(fanRpm != null ? Math.round(fanRpm) + ' rpm' : 'n/a', rightX + rightW, ry);
    ry += 10 * dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(rightX, ry, rightW, mbH);
    if (fanV != null) {
      ctx.fillStyle = rgba(cfg.signals.fan.color, 0.85);
      ctx.fillRect(rightX, ry, rightW * Math.max(0.01, fanV), mbH);
    }
    ry += mbH + 24 * dpr;

    // Network + disk throughput graphs.
    const graphH = Math.round(46 * dpr);
    drawGraph(ctx, rightX, ry, rightW, graphH, dpr, 'NETWORK', [
      { hist: bus.hist('netDown'), color: cfg.signals.netDown.color, label: '↓' },
      { hist: bus.hist('netUp'), color: cfg.signals.netUp.color, label: '↑' }
    ]);
    ry += graphH + 26 * dpr;
    drawGraph(ctx, rightX, ry, rightW, graphH, dpr, 'DISK', [
      { hist: bus.hist('diskRead'), color: cfg.signals.diskRead.color, label: 'R' },
      { hist: bus.hist('diskWrite'), color: cfg.signals.diskWrite.color, label: 'W' }
    ]);
  },
  teardown() { coreHist = []; procDisp = new Map(); }
};

function drawGraph(ctx, x, y, w, h, dpr, title, series) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
  ctx.fillText(title, x, y);
  const gy = y + 8 * dpr;
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(x, gy, w, h);
  for (const s of series) {
    const a = s.hist;
    if (!a || a.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    for (let j = 0; j < a.length; j++) {
      const px = x + (j / (a.length - 1)) * w;
      const py = gy + h - a[j] * h;
      j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function rgbaFromRgb(rgb, a) {
  const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : rgb;
}
