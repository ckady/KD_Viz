'use strict';

import { signalBus } from './signalBus.js';
import { createModeManager } from './modeManager.js';
import { createHud } from './hud.js';
import { createClaudeBar } from './claudeBar.js';

import pulse from './modes/pulse.js';
import constellation from './modes/constellation.js';
import dashboard from './modes/dashboard.js';
import monitor from './modes/monitor.js';
import flowfield from './modes/flowfield.js';
import odyssey from './modes/odyssey.js';
import face from './modes/face.js';
import disconnected from './modes/disconnected.js';
import alert from './modes/alert.js';

const canvas = document.getElementById('stage');
const hudEl = document.getElementById('hud');
const modeNameEl = document.getElementById('modeName');
const toastEl = document.getElementById('toast');
const claudeBarEl = document.getElementById('claudebar');

// Canvas sizing is owned by the mode manager (it swaps canvases per mode).
let managerRef = null;

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

let hudVisible = true;
function setHud(v) {
  hudVisible = v;
  hudEl.classList.toggle('hidden', !v);
  modeNameEl.classList.toggle('hidden', !v);
}

// Auto-hide cursor after inactivity.
let cursorTimer = null;
function pokeCursor() {
  document.body.classList.add('show-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove('show-cursor'), 3000);
}
window.addEventListener('mousemove', pokeCursor);

async function main() {
  const config = await window.viz.getConfig();

  const hud = createHud(hudEl, config);
  const claudeBar = createClaudeBar(claudeBarEl, config);

  const manager = createModeManager({
    config,
    canvas,
    onToast: toast,
    onModeChange: (id) => { modeNameEl.textContent = id; }
  });
  managerRef = manager;
  window.addEventListener('resize', () => managerRef && managerRef.resize());

  // Order here defines the 1..N keyboard slots.
  manager.register(pulse);
  manager.register(constellation);
  manager.register(dashboard);
  manager.register(monitor);
  manager.register(flowfield);
  manager.register(odyssey);
  manager.register(face);
  manager.register(disconnected, { autoOnly: true });
  manager.register(alert, { autoOnly: true });

  manager.activate(config.defaultMode || 'pulse');
  modeNameEl.textContent = manager.currentId();

  // Signals in.
  window.viz.onSignals((frame) => signalBus.push(frame));

  // GPU availability hint for the HUD.
  refreshGpuHint(hud);
  setInterval(() => refreshGpuHint(hud), 5000);

  // Keys.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') { setHud(!hudVisible); return; }
    if (e.key === 'c' || e.key === 'C') { claudeBar.toggle(); return; }
    if (e.key === 'b' || e.key === 'B') { claudeBar.toggleBudget(); return; }
    if (e.key === 'Escape' || e.key === 'q') { /* dev convenience */ }
    manager.handleKey(e);
  });

  // Render loop with per-mode FPS cap.
  let last = performance.now();
  let acc = 0;
  let lastBar = 0;
  function frame(now) {
    const dt = now - last;
    last = now;
    const cap = manager.currentFpsCap();
    const minFrame = 1000 / cap;
    acc += dt;
    if (acc >= minFrame) {
      acc = acc % minFrame;
      manager.ensureSize();
      manager.update(dt / 1000);
      manager.render();
      if (hudVisible) hud.render();
    }
    // Overlay text updates ~4x/sec — independent of the canvas FPS cap and HUD.
    if (now - lastBar > 250) { lastBar = now; claudeBar.render(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function refreshGpuHint(hud) {
  try {
    const s = await window.viz.getGpuStatus();
    hud.setGpuHint(s && s.available ? '' : (s && s.reason ? '· ' + s.reason : '· gpu n/a'));
  } catch (_) { /* ignore */ }
}

main();
