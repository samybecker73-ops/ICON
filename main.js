'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
let mainWindow;
let updateDownloaded = false;
let updateCheckInProgress = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    frame: false,
    backgroundColor: '#08090b',
    title: 'ICON',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localUrl = mainWindow.webContents.getURL();
    if (url !== localUrl) event.preventDefault();
  });
}

function sendUpdateStatus(state, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('updates:status', {
    state,
    currentVersion: app.getVersion(),
    ...details
  });
}

function updaterSupported() {
  return app.isPackaged && process.platform === 'win32';
}

function configureAutoUpdater() {
  if (!updaterSupported()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    updateCheckInProgress = true;
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', info => {
    updateCheckInProgress = false;
    sendUpdateStatus('available', {
      version: info.version,
      releaseDate: info.releaseDate || null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    });
  });

  autoUpdater.on('update-not-available', info => {
    updateCheckInProgress = false;
    sendUpdateStatus('not-available', {
      version: info?.version || app.getVersion()
    });
  });

  autoUpdater.on('download-progress', progress => {
    sendUpdateStatus('downloading', {
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
      bytesPerSecond: Number(progress.bytesPerSecond) || 0
    });
  });

  autoUpdater.on('update-downloaded', info => {
    updateDownloaded = true;
    sendUpdateStatus('downloaded', {
      version: info.version,
      releaseDate: info.releaseDate || null
    });
  });

  autoUpdater.on('error', error => {
    updateCheckInProgress = false;
    sendUpdateStatus('error', {
      message: String(error?.message || 'Erreur inconnue').slice(0, 500)
    });
  });

  setTimeout(() => {
    if (!app.isQuitting) {
      autoUpdater.checkForUpdates().catch(error => {
        updateCheckInProgress = false;
        sendUpdateStatus('error', {
          message: String(error?.message || 'Vérification impossible').slice(0, 500)
        });
      });
    }
  }, 8000);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getBaseInfo() {
  const cpuList = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    platformName: platformLabel(os.platform()),
    release: os.release(),
    versionName: os.platform() === 'win32' && typeof os.version === 'function'
      ? os.version()
      : (os.platform() === 'darwin' ? `macOS ${os.release()}` : `${os.type()} ${os.release()}`),
    arch: os.arch(),
    type: os.type(),
    cpuModel: cpuList[0]?.model || 'Modèle non communiqué',
    cpuCores: cpuList.length,
    uptimeSeconds: os.uptime(),
    appVersion: app.getVersion()
  };
}

function platformLabel(platform) {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function getMemoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalBytes: total,
    freeBytes: free,
    usedBytes: Math.max(0, total - free),
    usedPercent: total > 0 ? Math.round(((total - free) / total) * 100) : 0
  };
}

function cpuTotals() {
  return os.cpus().map(cpu => {
    const times = cpu.times;
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return { total, idle: times.idle };
  });
}

async function getCpuUsage() {
  const before = cpuTotals();
  await delay(140);
  const after = cpuTotals();
  const readings = [];
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    const totalDelta = after[i].total - before[i].total;
    const idleDelta = after[i].idle - before[i].idle;
    if (totalDelta > 0) readings.push(1 - idleDelta / totalDelta);
  }
  const usage = readings.length
    ? readings.reduce((sum, value) => sum + value, 0) / readings.length
    : 0;
  return { usedPercent: Math.max(0, Math.min(100, Math.round(usage * 100))) };
}

async function getWindowsDisks() {
  const command = [
    '$items = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace;',
    "if ($null -eq $items) { '[]' } else { $items | ConvertTo-Json -Compress }"
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command
  ], { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });

  const parsed = JSON.parse(stdout.trim() || '[]');
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.filter(item => item && item.DeviceID && Number(item.Size) > 0).map(item => {
    const totalBytes = Number(item.Size);
    const freeBytes = Number(item.FreeSpace);
    return {
      name: String(item.DeviceID),
      label: String(item.VolumeName || 'Disque local'),
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
    };
  });
}

async function getUnixDisks() {
  const { stdout } = await execFileAsync('df', ['-Pk'], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  const lines = stdout.trim().split(/\r?\n/).slice(1);
  const disks = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    const freeKb = Number(parts[3]);
    const mount = parts.slice(5).join(' ');
    if (!Number.isFinite(totalKb) || totalKb <= 0 || !mount.startsWith('/')) continue;
    if (/^(tmpfs|devtmpfs|shm|map|proc|sysfs|devfs)$/i.test(parts[0])) continue;
    const totalBytes = totalKb * 1024;
    const usedBytes = usedKb * 1024;
    const freeBytes = freeKb * 1024;
    disks.push({
      name: mount,
      label: mount === '/' ? 'Disque système' : mount,
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: Math.round((usedBytes / totalBytes) * 100)
    });
  }
  return disks;
}

async function getDiskInfo() {
  try {
    return process.platform === 'win32' ? await getWindowsDisks() : await getUnixDisks();
  } catch (error) {
    return { unavailable: true, reason: error.message, disks: [] };
  }
}

async function getWindowsHardwareDetails() {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
function Read-Cim([string]$ClassName, [string[]]$Properties, [string]$Filter = '') {
  try {
    if ([string]::IsNullOrWhiteSpace($Filter)) {
      return @(Get-CimInstance -ClassName $ClassName -ErrorAction Stop | Select-Object -Property $Properties)
    }
    return @(Get-CimInstance -ClassName $ClassName -Filter $Filter -ErrorAction Stop | Select-Object -Property $Properties)
  } catch { return @() }
}
$result = [ordered]@{
  computer = Read-Cim 'Win32_ComputerSystem' @('Manufacturer','Model','SystemType','TotalPhysicalMemory','NumberOfProcessors','Domain')
  operatingSystem = Read-Cim 'Win32_OperatingSystem' @('Caption','Version','BuildNumber','OSArchitecture','InstallDate','LastBootUpTime','SystemDrive','WindowsDirectory')
  processors = Read-Cim 'Win32_Processor' @('Name','Manufacturer','NumberOfCores','NumberOfLogicalProcessors','MaxClockSpeed','CurrentClockSpeed','L2CacheSize','L3CacheSize')
  baseboards = Read-Cim 'Win32_BaseBoard' @('Manufacturer','Product','Version')
  bios = Read-Cim 'Win32_BIOS' @('Manufacturer','SMBIOSBIOSVersion','ReleaseDate','Version')
  graphics = Read-Cim 'Win32_VideoController' @('Name','AdapterCompatibility','DriverVersion','DriverDate','VideoModeDescription','CurrentHorizontalResolution','CurrentVerticalResolution','CurrentRefreshRate')
  memoryModules = Read-Cim 'Win32_PhysicalMemory' @('Manufacturer','PartNumber','Capacity','Speed','ConfiguredClockSpeed','DeviceLocator','FormFactor')
  physicalDisks = Read-Cim 'Win32_DiskDrive' @('Model','MediaType','Size','InterfaceType','FirmwareRevision','Status')
  networkAdapters = Read-Cim 'Win32_NetworkAdapter' @('Name','Manufacturer','NetEnabled','Speed','PhysicalAdapter') 'PhysicalAdapter = TRUE'
  monitors = Read-Cim 'Win32_DesktopMonitor' @('Name','ScreenWidth','ScreenHeight','MonitorManufacturer')
}
$result | ConvertTo-Json -Depth 6 -Compress
`;

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

  const parsed = JSON.parse(stdout.trim());
  const normalizeArray = value => Array.isArray(value) ? value : (value ? [value] : []);
  for (const key of Object.keys(parsed)) parsed[key] = normalizeArray(parsed[key]);
  return {
    platform: 'win32',
    supported: true,
    collectedAt: new Date().toISOString(),
    ...parsed
  };
}

async function getSystemDetails() {
  if (process.platform === 'win32') {
    return getWindowsHardwareDetails();
  }
  return {
    platform: process.platform,
    supported: false,
    collectedAt: new Date().toISOString(),
    message: 'L’inventaire matériel approfondi sera ajouté à cette plateforme dans une prochaine étape.',
    computer: [],
    operatingSystem: [],
    processors: [],
    baseboards: [],
    bios: [],
    graphics: [],
    memoryModules: [],
    physicalDisks: [],
    networkAdapters: [],
    monitors: []
  };
}

ipcMain.handle('system:base', () => getBaseInfo());
ipcMain.handle('system:memory', () => getMemoryInfo());
ipcMain.handle('system:cpu', () => getCpuUsage());
ipcMain.handle('system:disks', () => getDiskInfo());
ipcMain.handle('system:details', () => getSystemDetails());

ipcMain.handle('report:export', async (_event, report) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le rapport système',
    defaultPath: `ICON-rapport-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Rapport JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('updates:info', () => ({
  currentVersion: app.getVersion(),
  supported: updaterSupported(),
  platform: process.platform,
  packaged: app.isPackaged
}));

ipcMain.handle('updates:check', async () => {
  if (!updaterSupported()) {
    return {
      ok: false,
      supported: false,
      message: 'La vérification des mises à jour est disponible dans la version installée de Windows.'
    };
  }
  if (updateCheckInProgress) return { ok: true, alreadyChecking: true };
  try {
    updateCheckInProgress = true;
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    updateCheckInProgress = false;
    sendUpdateStatus('error', { message: String(error?.message || 'Vérification impossible').slice(0, 500) });
    return { ok: false, message: String(error?.message || 'Vérification impossible').slice(0, 500) };
  }
});

ipcMain.handle('updates:download', async () => {
  if (!updaterSupported()) return { ok: false, message: 'Plateforme non prise en charge.' };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    sendUpdateStatus('error', { message: String(error?.message || 'Téléchargement impossible').slice(0, 500) });
    return { ok: false, message: String(error?.message || 'Téléchargement impossible').slice(0, 500) };
  }
});

ipcMain.handle('updates:install', () => {
  if (!updaterSupported() || !updateDownloaded) {
    return { ok: false, message: 'Aucune mise à jour prête à installer.' };
  }
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

app.whenReady().then(() => {
  app.setAppUserModelId('fr.icon.desktop');
  createWindow();
  configureAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
