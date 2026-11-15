'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iconAPI', {
  openDiscordServer: () => ipcRenderer.invoke('community:open-discord'),
  getBaseInfo: () => ipcRenderer.invoke('system:base'),
  getMemoryInfo: () => ipcRenderer.invoke('system:memory'),
  getCpuUsage: () => ipcRenderer.invoke('system:cpu'),
  getDiskInfo: () => ipcRenderer.invoke('system:disks'),
  getSystemDetails: () => ipcRenderer.invoke('system:details'),
  getProcesses: () => ipcRenderer.invoke('system:processes'),
  getNetworkConfiguration: () => ipcRenderer.invoke('system:network'),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:run'),
  getInstalledApplications: () => ipcRenderer.invoke('apps:installed'),
  getStartupApplications: () => ipcRenderer.invoke('apps:startup'),
  getSecurityStatus: () => ipcRenderer.invoke('security:status'),
  requestDefenderQuickScan: () => ipcRenderer.invoke('security:quick-scan'),
  chooseScanFolder: () => ipcRenderer.invoke('scan:choose-folder'),
  scanDirectory: token => ipcRenderer.invoke('scan:directory', token),
  scanHiddenElements: token => ipcRenderer.invoke('scan:hidden', token),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  openSystemTool: key => ipcRenderer.invoke('tools:open', key),
  exportReport: report => ipcRenderer.invoke('report:export', report),
  getUpdaterInfo: () => ipcRenderer.invoke('updates:info'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  onScanProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.removeListener('scan:progress', listener);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('window:maximized', listener);
    return () => ipcRenderer.removeListener('window:maximized', listener);
  }
});
