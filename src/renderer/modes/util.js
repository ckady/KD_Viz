'use strict';

// Canonical signal ordering used by modes that lay signals out spatially.
export const SIGNAL_KEYS = [
  'cpuTotal', 'ramUsed', 'swapUsed', 'gpu',
  'netDown', 'netUp', 'diskRead', 'diskWrite',
  'temp', 'procCount'
];

export function colorFor(config, key) {
  const s = config.signals[key];
  return (s && s.color) || '#ffffff';
}
export function labelFor(config, key) {
  const s = config.signals[key];
  return (s && s.label) || key;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Soft easing for value -> radius/alpha responses.
export function ease(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

export function clear(ctx, w, h, fade) {
  if (fade == null) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);
  } else {
    // Trail effect: paint translucent background instead of clearing.
    ctx.fillStyle = `rgba(5,6,10,${fade})`;
    ctx.fillRect(0, 0, w, h);
  }
}
