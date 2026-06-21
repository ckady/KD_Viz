'use strict';

// DASHBOARD — medium/dense. Every signal as a labeled bar with a sparkline
// trail, plus a per-core CPU strip. The at-a-glance status mode.

import { SIGNAL_KEYS, colorFor, labelFor, rgba, clear } from './util.js';
import { signalBus as bus } from '../signalBus.js';

let cfg;

export default {
  id: 'dashboard',
  init({ config }) { cfg = config; },
  update() {},
  render(ctx) {
    const canvas = ctx.canvas, W = canvas.width, H = canvas.height;
    clear(ctx, W, H, null);

    const pad = Math.round(Math.min(W, H) * 0.05);
    const cols = 2;
    const rows = Math.ceil(SIGNAL_KEYS.length / cols);
    const gridW = W - pad * 2;
    const cellW = gridW / cols;
    const usableH = H - pad * 2.6;
    const cellH = usableH / rows;
    const dpr = W / window.innerWidth;
    ctx.textBaseline = 'middle';

    SIGNAL_KEYS.forEach((key, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = pad + c * cellW;
      const y = pad + r * cellH;
      const bw = cellW - pad * 0.6;
      const barH = Math.max(10, cellH * 0.30);
      const color = colorFor(cfg, key);
      const v = bus.get(key);

      // Label + value.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `600 ${Math.round(13 * dpr)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(labelFor(cfg, key), x, y + barH * 0.5);
      ctx.fillStyle = rgba(color, 0.95);
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(v * 100) + '%', x + bw, y + barH * 0.5);

      // Bar track + fill.
      const by = y + barH + 4 * dpr;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, x, by, bw, barH, barH / 2);
      ctx.fill();
      ctx.fillStyle = rgba(color, 0.85);
      roundRect(ctx, x, by, Math.max(barH, bw * v), barH, barH / 2);
      ctx.fill();
      if (bus.anomaly(key)) {
        ctx.strokeStyle = rgba('#ffffff', 0.8);
        ctx.lineWidth = 2;
        roundRect(ctx, x, by, bw, barH, barH / 2);
        ctx.stroke();
      }

      // Sparkline.
      const hist = bus.hist(key);
      const sy = by + barH + 6 * dpr;
      const sh = cellH - (barH * 2) - 22 * dpr;
      if (sh > 6 && hist.length > 1) {
        ctx.strokeStyle = rgba(color, 0.55);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let j = 0; j < hist.length; j++) {
          const px = x + (j / (hist.length - 1)) * bw;
          const py = sy + sh - hist[j] * sh;
          j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    });

    // Per-core CPU strip along the bottom.
    const cores = bus.cores();
    if (cores.length) {
      const stripY = H - pad * 1.4;
      const stripH = pad * 0.7;
      const cw = gridW / cores.length;
      for (let i = 0; i < cores.length; i++) {
        const ch = cores[i] * stripH;
        ctx.fillStyle = rgba('#ff8c69', 0.3 + cores[i] * 0.7);
        ctx.fillRect(pad + i * cw + 1, stripY + (stripH - ch), cw - 2, ch);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('CPU CORES', pad, stripY - 8 * dpr);
    }
  },
  teardown() {}
};

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
