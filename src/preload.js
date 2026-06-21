'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viz', {
  onSignals: (cb) => {
    const handler = (_e, frame) => cb(frame);
    ipcRenderer.on('signals', handler);
    return () => ipcRenderer.removeListener('signals', handler);
  },
  getConfig: () => ipcRenderer.invoke('get-config'),
  getGpuStatus: () => ipcRenderer.invoke('gpu-status')
});
