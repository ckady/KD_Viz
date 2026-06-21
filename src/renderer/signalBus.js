'use strict';

/**
 * Holds the latest signal frame plus short history ring buffers so modes can
 * draw trails / sparklines without each re-implementing buffering.
 */
const HISTORY = 180; // ~3 min at 1 Hz

const tracked = [
  'cpuTotal', 'ramUsed', 'swapUsed', 'gpu',
  'netUp', 'netDown', 'diskRead', 'diskWrite', 'temp', 'procCount'
];

export const signalBus = {
  frame: null,
  history: Object.fromEntries(tracked.map((k) => [k, []])),

  push(frame) {
    this.frame = frame;
    for (const k of tracked) {
      const v = frame.values[k];
      const arr = this.history[k];
      arr.push(v == null ? 0 : v);
      if (arr.length > HISTORY) arr.shift();
    }
  },

  get(key) {
    if (!this.frame) return 0;
    const v = this.frame.values[key];
    return v == null ? 0 : v;
  },

  hist(key) {
    return this.history[key] || [];
  },

  cores() {
    return this.frame ? this.frame.cores : [];
  },

  procs() {
    return this.frame && this.frame.topProcs ? this.frame.topProcs : [];
  },

  gpuStates() {
    return this.frame && this.frame.gpuStates ? this.frame.gpuStates : [];
  },

  status() {
    return this.frame ? this.frame.status : { networkLost: false, thermalAlert: false };
  },

  claude() {
    return this.frame && this.frame.claude ? this.frame.claude : { available: false };
  },

  anomaly(key) {
    return this.frame && this.frame.anomalies ? !!this.frame.anomalies[key] : false;
  }
};
