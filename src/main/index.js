'use strict';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const { createWindow } = require('./window');
const { startCollector } = require('./metrics/collector');
const { createSignalProcessor } = require('./metrics/signals');
const { startPowermetrics } = require('./metrics/powermetrics');
const { startAppleTemp } = require('./metrics/appleTemp');
const { startClaudeUsage } = require('./metrics/claudeUsage');

const isDev = process.argv.includes('--dev');

function loadConfig() {
  const configPath = path.join(__dirname, '..', '..', 'config', 'default.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

// Single-instance lock: a dedicated kiosk app should never run twice.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let stopCollector = null;
let stopPowermetrics = null;
let stopAppleTemp = null;
let stopClaudeUsage = null;

app.whenReady().then(() => {
  const config = loadConfig();
  const processor = createSignalProcessor(config);

  mainWindow = createWindow({ isDev, config });

  // Latest powermetrics sample (GPU/thermal); merged into each frame.
  let pmSample = { available: false };
  // Latest Apple Silicon die-temperature sample (separate source from powermetrics).
  let tempSample = { available: false };
  // Latest Claude token-usage sample; attached to each frame.
  let claudeSample = { available: false };

  // Push a fully-processed signal frame to the renderer each tick.
  const emitFrame = (raw) => {
    // Merge die temp + fan from the helper into the powermetrics sample.
    const pm = tempSample.available
      ? Object.assign({}, pmSample, {
          tempC: tempSample.tempC,
          fanRpm: tempSample.fanRpm,
          fanMax: tempSample.fanMax,
          fanMin: tempSample.fanMin
        })
      : pmSample;
    const frame = processor.process(raw, pm);
    frame.claude = claudeSample;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('signals', frame);
    }
  };

  stopCollector = startCollector(config, emitFrame);

  if (config.powermetrics && config.powermetrics.enabled) {
    stopPowermetrics = startPowermetrics(config, (sample) => {
      pmSample = sample;
    });
  }

  if (config.appleTemp && config.appleTemp.enabled) {
    stopAppleTemp = startAppleTemp(config, (sample) => {
      tempSample = sample;
    });
  }

  if (config.claude && config.claude.enabled) {
    stopClaudeUsage = startClaudeUsage(config, (sample) => {
      claudeSample = sample;
    });
  }

  // Renderer asks for config (palettes, mode tiers, thresholds) on load.
  ipcMain.handle('get-config', () => config);

  // Renderer reports GPU/thermal availability hints for the HUD.
  ipcMain.handle('gpu-status', () => ({
    available: pmSample.available === true,
    reason: pmSample.reason || null
  }));
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (stopCollector) stopCollector();
  if (stopPowermetrics) stopPowermetrics();
  if (stopAppleTemp) stopAppleTemp();
  if (stopClaudeUsage) stopClaudeUsage();
});
