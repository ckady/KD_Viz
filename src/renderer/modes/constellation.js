'use strict';

// CONSTELLATION — medium. Each signal is a node on a force-ish ring; edges link
// related signals (cpu->ram->gpu, net pair, disk pair). Traffic signals emit
// particles that travel along edges, so you literally see data moving.

import { SIGNAL_KEYS, colorFor, rgba, ease, clear } from './util.js';
import { signalBus as bus } from '../signalBus.js';

const EDGES = [
  ['cpuTotal', 'ramUsed'], ['ramUsed', 'gpu'], ['cpuTotal', 'gpu'],
  ['ramUsed', 'swapUsed'], ['netDown', 'netUp'], ['diskRead', 'diskWrite'],
  ['cpuTotal', 'diskRead'], ['gpu', 'temp'], ['cpuTotal', 'procCount']
];

let cfg, nodes, particles, time = 0;

function layout(W, H) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.34;
  const n = SIGNAL_KEYS.length;
  const map = {};
  SIGNAL_KEYS.forEach((key, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    map[key] = { key, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
  });
  return map;
}

export default {
  id: 'constellation',
  init({ canvas, config }) {
    cfg = config; time = 0; particles = [];
    nodes = layout(canvas.width, canvas.height);
  },
  update(dt) {
    time += dt;
    const W = this._w, H = this._h;
    if (!nodes) return;
    // Emit particles from traffic signals proportional to their value.
    const emitFrom = (key, edge) => {
      const v = bus.get(key);
      if (Math.random() < v * 0.9) {
        const a = nodes[edge[0]], b = nodes[edge[1]];
        if (a && b) particles.push({ a, b, t: 0, speed: 0.4 + v, color: colorFor(cfg, key) });
      }
    };
    emitFrom('netDown', ['netDown', 'netUp']);
    emitFrom('netUp', ['netUp', 'netDown']);
    emitFrom('diskRead', ['diskRead', 'diskWrite']);
    emitFrom('diskWrite', ['diskWrite', 'diskRead']);
    emitFrom('cpuTotal', ['cpuTotal', 'ramUsed']);
    for (const p of particles) p.t += dt * p.speed;
    particles = particles.filter((p) => p.t < 1);
    if (particles.length > 600) particles.splice(0, particles.length - 600);
    void W; void H;
  },
  render(ctx) {
    const canvas = ctx.canvas, W = canvas.width, H = canvas.height;
    this._w = W; this._h = H;
    if (!nodes) nodes = layout(W, H);
    clear(ctx, W, H, 0.22);

    // Edges.
    ctx.lineWidth = 1;
    for (const [k1, k2] of EDGES) {
      const a = nodes[k1], b = nodes[k2];
      if (!a || !b) continue;
      const strength = (ease(bus.get(k1)) + ease(bus.get(k2))) / 2;
      ctx.strokeStyle = rgba('#7088aa', 0.06 + strength * 0.35);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Particles.
    for (const p of particles) {
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      ctx.fillStyle = rgba(p.color, 0.9 * (1 - p.t));
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nodes.
    for (const key of SIGNAL_KEYS) {
      const node = nodes[key];
      const v = ease(bus.get(key));
      const color = colorFor(cfg, key);
      const r = Math.min(W, H) * 0.012 * (0.8 + v * 3);
      const g = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 2.4);
      g.addColorStop(0, rgba(color, 0.9));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(color, 0.95);
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (bus.anomaly(key)) {
        ctx.strokeStyle = rgba('#ffffff', 0.4 + 0.4 * Math.sin(time * 8));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },
  teardown() { particles = []; }
};
