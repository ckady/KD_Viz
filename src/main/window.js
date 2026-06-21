'use strict';

const { app, BrowserWindow, powerSaveBlocker, screen } = require('electron');
const path = require('path');

function createWindow({ isDev, config }) {
  // Launch on whichever display the user is currently on (cursor location),
  // not always the primary — important with dual monitors.
  const active = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = isDev ? active.workArea : active.bounds;
  const winW = isDev ? Math.min(1280, area.width) : area.width;
  const winH = isDev ? Math.min(800, area.height) : area.height;
  const x = Math.round(area.x + (area.width - winW) / 2);
  const y = Math.round(area.y + (area.height - winH) / 2);

  // Fill the screen WITHOUT macOS kiosk/native-fullscreen. Kiosk hard-captures
  // the display (breaks Cmd-Tab, Mission Control, moving between Spaces); native
  // fullscreen puts the window in its own Space (awkward to move across desktops).
  // "Simple fullscreen" just covers the screen as a normal window, so all the
  // usual window management keeps working.
  const immersive = config.startFullscreen && !isDev;

  const win = new BrowserWindow({
    x,
    y,
    width: winW,
    height: winH,
    backgroundColor: '#05060a',
    frame: isDev,
    movable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Global keys handled in main so they work regardless of renderer state:
  // Esc quits; 'm' moves the window to the next display.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape') {
      event.preventDefault();
      app.quit();
    } else if ((input.key === 'm' || input.key === 'M') && !input.meta) {
      event.preventDefault();
      moveToNextDisplay(win);
    }
  });

  win.once('ready-to-show', () => {
    if (immersive) win.setSimpleFullScreen(true);
    win.show();
    if (!isDev) win.focus();
  });

  // Keep the display awake — this is meant to be left on as the default view.
  const blockerId = powerSaveBlocker.start('prevent-display-sleep');
  win.on('closed', () => {
    if (powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
  });

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  return win;
}

// Move the window to the next display, preserving simple-fullscreen state.
// Simple fullscreen pins the window to its current screen, so we drop out of it,
// reposition onto the next display, then re-enter.
function moveToNextDisplay(win) {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return;

  const b = win.getBounds();
  const center = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  const cur = screen.getDisplayNearestPoint(center);
  const idx = displays.findIndex((d) => d.id === cur.id);
  const next = displays[(idx + 1) % displays.length];

  const bounds = {
    x: next.bounds.x,
    y: next.bounds.y,
    width: next.bounds.width,
    height: next.bounds.height
  };

  // Synchronous toggle: drop simple-fullscreen, reposition onto the next
  // display, re-enter. (A delayed re-enter leaves the screen blank mid-toggle.)
  const wasFs = win.isSimpleFullScreen();
  if (wasFs) win.setSimpleFullScreen(false);
  win.setBounds(bounds);
  if (wasFs) win.setSimpleFullScreen(true);
  win.setBounds(bounds);
}

module.exports = { createWindow };
