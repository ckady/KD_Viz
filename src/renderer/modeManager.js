'use strict';

import { signalBus } from './signalBus.js';

/**
 * Owns the active mode, keyboard switching, and status-reactive auto-switching.
 *
 * Modes are registered as factory objects implementing:
 *   { id, init(ctx), update(dt, bus), render(ctx), teardown() }
 * Tier/fpsCap come from config.modes[id].
 */
export function createModeManager({ config, canvas, onToast, onModeChange }) {
  const registry = new Map();
  const order = [];           // user-cyclable modes (excludes auto-only states)
  let current = null;
  let currentId = null;
  let activeCanvas = canvas;  // swapped per-mode (2d vs webgl contexts can't share a canvas)
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  // A canvas's context type is fixed once acquired, so each mode switch gets a
  // fresh element of the same id/placement.
  function freshCanvas() {
    const parent = activeCanvas.parentNode;
    const next = document.createElement('canvas');
    next.id = activeCanvas.id;
    parent.replaceChild(next, activeCanvas);
    activeCanvas = next;
    sizeCanvas();
    return next;
  }

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    activeCanvas.width = Math.floor(window.innerWidth * dpr);
    activeCanvas.height = Math.floor(window.innerHeight * dpr);
    activeCanvas.style.width = window.innerWidth + 'px';
    activeCanvas.style.height = window.innerHeight + 'px';
  }

  // Auto-switch state
  let userOverrideUntil = 0;  // timestamp: ignore auto-switch while user is steering
  let autoActive = null;      // which auto state we forced ('disconnected'|'alert'|null)
  let restoreTo = null;       // mode to return to when auto state clears

  function register(mode, { autoOnly = false } = {}) {
    registry.set(mode.id, mode);
    if (!autoOnly) order.push(mode.id);
  }

  function tierOf(id) {
    return (config.modes[id] && config.modes[id].tier) || 'medium';
  }
  function fpsCapOf(id) {
    return (config.modes[id] && config.modes[id].fpsCap) || 60;
  }

  function activate(id, { fromAuto = false } = {}) {
    if (!registry.has(id) || id === currentId) return;
    if (current && current.teardown) current.teardown();
    current = registry.get(id);
    currentId = id;
    const el = freshCanvas();
    const ctx = el.getContext(current.gl ? 'webgl2' : '2d', { alpha: false });
    current._ctx = ctx;
    if (current.init) current.init({ ctx, canvas: el, config });
    if (onModeChange) onModeChange(id, fpsCapOf(id), tierOf(id), fromAuto);
  }

  function userSelect(id) {
    userOverrideUntil = performance.now() + (config.autoSwitch.userOverrideMs ?? 30000);
    autoActive = null;
    activate(id);
    if (onToast) onToast(id.toUpperCase());
  }

  function cycle(dir) {
    const idx = order.indexOf(autoActive ? restoreTo : currentId);
    const next = order[(idx + dir + order.length) % order.length];
    userSelect(next);
  }

  function evaluateAuto() {
    if (!config.autoSwitch.enabled) return;
    if (performance.now() < userOverrideUntil) return;

    const st = signalBus.status();
    const wantAuto = st.networkLost
      ? config.autoSwitch.network.mode
      : st.thermalAlert
        ? config.autoSwitch.thermal.mode
        : null;

    if (wantAuto && wantAuto !== currentId) {
      if (!autoActive) restoreTo = currentId; // remember normal mode
      autoActive = wantAuto;
      activate(wantAuto, { fromAuto: true });
      if (onToast) {
        onToast(st.networkLost ? 'NETWORK LOST' : 'THERMAL ALERT');
      }
    } else if (!wantAuto && autoActive) {
      // condition cleared — restore previous mode
      const back = restoreTo || config.defaultMode;
      autoActive = null;
      restoreTo = null;
      activate(back, { fromAuto: true });
      if (onToast) onToast('RECOVERED');
    }
  }

  function update(dt) {
    evaluateAuto();
    if (current && current.update) current.update(dt, signalBus);
  }

  function render() {
    if (current && current.render) current.render(current._ctx);
  }

  function handleKey(e) {
    const n = parseInt(e.key, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= order.length) {
      userSelect(order[n - 1]);
    } else if (e.key === 'ArrowRight') {
      cycle(1);
    } else if (e.key === 'ArrowLeft') {
      cycle(-1);
    }
  }

  function resize() {
    sizeCanvas();
    if (current && current.resize) current.resize(activeCanvas, current._ctx);
  }

  // Self-heal: if the canvas no longer matches the window (e.g. moved to a
  // display with a different DPR, where 'resize' may not fire), re-sync. Cheap
  // enough to call every frame; only does work when something actually changed.
  function ensureSize() {
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * d);
    const h = Math.floor(window.innerHeight * d);
    if (activeCanvas.width !== w || activeCanvas.height !== h) {
      sizeCanvas();
      if (current && current.resize) current.resize(activeCanvas, current._ctx);
    }
  }

  return {
    register,
    activate,
    userSelect,
    update,
    render,
    handleKey,
    resize,
    ensureSize,
    currentFpsCap: () => fpsCapOf(currentId),
    currentId: () => currentId,
    order: () => order.slice()
  };
}
