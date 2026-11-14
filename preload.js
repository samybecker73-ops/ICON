'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iconAPI', {
  getBaseInfo: () => ipcRenderer.invoke('system:base'),
  getMemoryInfo: () => ipcRenderer.invoke('system:memory'),
  getCpuUsage: () => ipcRenderer.invoke('system:cpu'),
  getDiskInfo: () => ipcRenderer.invoke('system:disks'),
  getSystemDetails: () => ipcRenderer.invoke('system:details'),
  exportReport: report => ipcRenderer.invoke('report:export', report),
  getUpdaterInfo: () => ipcRenderer.invoke('updates:info'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: callback => ipcRenderer.on('updates:status', (_event, status) => callback(status)),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: callback => ipcRenderer.on('window:maximized', (_event, value) => callback(value))
});
