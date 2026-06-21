'use strict';

// DISCONNECTED — auto state on network loss. Desaturated slow scanlines with a
// drifting "signal lost" glyph; calm but unmistakably degraded.

import { rgba, clear } from './util.js';
import { signalBus as bus } from '../signalBus.js';

let time = 0;

export default {
  id: 'disconnected',
  init() { time = 0; },
  update(dt) { time += dt; },
  render(ctx) {
    const canvas = ctx.canvas, W = canvas.width, H = canvas.height;
    clear(ctx, W, H, null);
    ctx.fillStyle = '#0a0b0e';
    ctx.fillRect(0, 0, W, H);

    // Scanlines.
    ctx.fillStyle = 'rgba(120,130,150,0.04)';
    for (let y = (time * 30) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 1);

    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.12;
    const pulse = 0.4 + 0.3 * Math.sin(time * 2);

    // Broken-link ring.
    ctx.lineWidth = 4;
    ctx.strokeStyle = rgba('#8893a6', pulse);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.4, Math.PI * 2 - 0.4);
    ctx.stroke();

    ctx.fillStyle = rgba('#aab4c6', 0.7);
    ctx.font = `600 ${Math.round(Math.min(W, H) * 0.03)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NETWORK LOST', cx, cy + r * 1.8);

    // Show the rest of the machine still ticking faintly (cpu bar).
    const cpu = bus.get('cpuTotal');
    ctx.fillStyle = rgba('#ff5d73', 0.5);
    ctx.fillRect(cx - r, cy - r * 1.8, 2 * r * cpu, 4);
  },
  teardown() {}
};
