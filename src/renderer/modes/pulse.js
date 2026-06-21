'use strict';

// PULSE — light/calm. Breathing concentric rings, one per signal, arranged on
// a circle. Radius & glow track each signal; per-core CPU forms an inner halo.
// Canvas2D, low cost — the safe default to leave on under heavy load.

import { SIGNAL_KEYS, colorFor, rgba, ease, clear } from './util.js';
import { signalBus as bus } from '../signalBus.js';

let cfg, W, H, time = 0;

export default {
  id: 'pulse',
  init({ canvas, config }) {
    cfg = config; W = canvas.width; H = canvas.height; time = 0;
  },
  update(dt) { time += dt; },
  render(ctx) {
    const canvas = ctx.canvas; W = canvas.width; H = canvas.height;
    clear(ctx, W, H, 0.18); // gentle trails

    const cx = W / 2, cy = H / 2;
    const ringR = Math.min(W, H) * 0.30;
    const n = SIGNAL_KEYS.length;

    // Per-core inner halo.
    const cores = bus.cores();
    if (cores.length) {
      const cr = Math.min(W, H) * 0.12;
      for (let i = 0; i < cores.length; i++) {
        const a = (i / cores.length) * Math.PI * 2 - Math.PI / 2;
        const load = ease(cores[i]);
        const r = cr * (0.4 + load * 0.9);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * cr * 1.2, cy + Math.sin(a) * cr * 1.2, 2 + load * 6, 0, Math.PI * 2);
        ctx.fillStyle = rgba('#ff8c69', 0.25 + load * 0.6);
        ctx.fill();
        void r;
      }
    }

    for (let i = 0; i < n; i++) {
      const key = SIGNAL_KEYS[i];
      const val = bus.get(key);
      const color = colorFor(cfg, key);
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(ang) * ringR;
      const py = cy + Math.sin(ang) * ringR;

      const breathe = 0.5 + 0.5 * Math.sin(time * 1.1 + i);
      const base = Math.min(W, H) * 0.045;
      const r = base * (0.6 + ease(val) * 2.4) * (0.85 + breathe * 0.15);
      const anom = bus.anomaly(key);

      // Outer glow ring.
      ctx.lineWidth = 2 + ease(val) * 6;
      ctx.strokeStyle = rgba(color, 0.25 + ease(val) * 0.6);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();

      // Core disc.
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, rgba(color, 0.55 + ease(val) * 0.4));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();

      if (anom) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba('#ffffff', 0.5 + 0.5 * Math.sin(time * 8));
        ctx.beginPath();
        ctx.arc(px, py, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
  teardown() {}
};
