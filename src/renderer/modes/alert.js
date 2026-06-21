'use strict';

// ALERT — auto state on thermal/anomaly. High-contrast red pulse with the
// hottest signals foregrounded so a glance tells you what's wrong.

import { rgba, clear, colorFor, labelFor } from './util.js';
import { fmtTemp } from '../hud.js';
import { signalBus as bus } from '../signalBus.js';

let cfg, time = 0;

export default {
  id: 'alert',
  init({ config }) { cfg = config; time = 0; },
  update(dt) { time += dt; },
  render(ctx) {
    const canvas = ctx.canvas, W = canvas.width, H = canvas.height;
    clear(ctx, W, H, null);

    const beat = 0.5 + 0.5 * Math.sin(time * 5);
    // Red vignette pulse.
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(20,4,6,1)');
    g.addColorStop(1, `rgba(${Math.round(120 + beat * 100)},0,20,1)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const f = bus.frame;
    const level = f && f.status ? f.status.thermalLevel : '—';
    const tempC = (f && f.values && fmtTemp(f.values.tempC, cfg.tempUnit)) || '';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba('#ffffff', 0.85 + beat * 0.15);
    ctx.font = `800 ${Math.round(Math.min(W, H) * 0.06)}px ui-monospace, Menlo, monospace`;
    ctx.fillText('THERMAL ALERT', cx, cy - Math.min(W, H) * 0.12);
    ctx.font = `600 ${Math.round(Math.min(W, H) * 0.035)}px ui-monospace, Menlo, monospace`;
    ctx.fillText(`${level}  ${tempC}`, cx, cy - Math.min(W, H) * 0.04);

    // Foreground the hottest signals as bars.
    const keys = ['cpuTotal', 'gpu', 'temp', 'ramUsed'];
    const bw = Math.min(W, H) * 0.5;
    let y = cy + Math.min(W, H) * 0.05;
    const bh = Math.min(W, H) * 0.035;
    for (const key of keys) {
      const v = bus.get(key);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(cx - bw / 2, y, bw, bh);
      ctx.fillStyle = rgba(colorFor(cfg, key), 0.9);
      ctx.fillRect(cx - bw / 2, y, bw * v, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'left';
      ctx.font = `600 ${Math.round(bh * 0.6)}px ui-monospace, Menlo, monospace`;
      ctx.fillText(`${labelFor(cfg, key)} ${Math.round(v * 100)}%`, cx - bw / 2, y + bh + bh * 0.5);
      ctx.textAlign = 'center';
      y += bh * 2.4;
    }
  },
  teardown() {}
};
