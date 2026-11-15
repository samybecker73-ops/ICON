'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const crypto = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DISCORD_INVITE_URL = 'https://discord.gg/fKgFP82Jm';
let mainWindow;
let updateDownloaded = false;
let updateCheckInProgress = false;
let activeScanController = null;
const scanTokens = new Map();

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

function isPortableMode() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

function updaterSupported() {
  return app.isPackaged && process.platform === 'win32' && !isPortableMode();
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


function sendScanProgress(event, progress) {
  try { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('scan:progress', progress); } catch (_) {}
}
async function runPowerShellJson(script, timeout = 30000, maxBuffer = 8 * 1024 * 1024) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { timeout, windowsHide:true, maxBuffer });
  const raw=String(stdout||'').trim(); return raw ? JSON.parse(raw) : null;
}
function normalizePowerShellArray(value) { return Array.isArray(value)?value:(value&&typeof value==='object'?[value]:[]); }

async function getProcessList() {
  if(process.platform!=='win32') return {supported:false,items:[],message:'La liste détaillée des processus est actuellement disponible sous Windows.'};
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$items=@(Get-Process | ForEach-Object {
  $cpu=0; try { if($null -ne $_.CPU){$cpu=[double]$_.CPU} } catch {}
  $threads=0; try {$threads=$_.Threads.Count} catch {}
  $handles=0; try {$handles=$_.HandleCount} catch {}
  [pscustomobject]@{name=$_.ProcessName;pid=[int]$_.Id;cpuSeconds=$cpu;memoryBytes=[int64]$_.WorkingSet64;privateBytes=[int64]$_.PrivateMemorySize64;threads=[int]$threads;handles=[int]$handles;path=[string]$_.Path}
})
ConvertTo-Json -InputObject $items -Depth 4 -Compress
`;
  return {supported:true,items:normalizePowerShellArray(await runPowerShellJson(script,30000,12*1024*1024)),collectedAt:new Date().toISOString()};
}

async function getInstalledApplications() {
  if(process.platform!=='win32') return {supported:false,items:[],message:'La lecture du registre des applications est disponible sous Windows.'};
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$locations=@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
$items=@(foreach($location in $locations){
  Get-ItemProperty -Path $location -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -and -not $_.SystemComponent} | ForEach-Object {
    [pscustomobject]@{name=[string]$_.DisplayName;version=[string]$_.DisplayVersion;publisher=[string]$_.Publisher;installDate=[string]$_.InstallDate;installLocation=[string]$_.InstallLocation;estimatedSizeKb=[int64]$_.EstimatedSize}
  }
})
$items=@($items | Sort-Object name,version -Unique)
ConvertTo-Json -InputObject $items -Depth 4 -Compress
`;
  return {supported:true,items:normalizePowerShellArray(await runPowerShellJson(script,45000,12*1024*1024)),collectedAt:new Date().toISOString()};
}

async function getStartupApplications() {
  if(process.platform!=='win32') return {supported:false,items:[],message:'La lecture du démarrage est disponible sous Windows.'};
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$items=@(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{name=[string]$_.Name;command=[string]$_.Command;location=[string]$_.Location;user=[string]$_.User}
})
ConvertTo-Json -InputObject $items -Depth 4 -Compress
`;
  return {supported:true,items:normalizePowerShellArray(await runPowerShellJson(script,30000,8*1024*1024)),collectedAt:new Date().toISOString()};
}

async function getWindowsSecurityStatus() {
  if(process.platform!=='win32') return {supported:false,defender:null,firewall:[],message:'La vérification Defender est disponible sous Windows.'};
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$defender=$null
try {
  $d=Get-MpComputerStatus -ErrorAction Stop
  if($d){
    $sig=$null;$quickStart=$null;$quickEnd=$null
    if($d.AntivirusSignatureLastUpdated){$sig=$d.AntivirusSignatureLastUpdated.ToString('o')}
    if($d.QuickScanStartTime){$quickStart=$d.QuickScanStartTime.ToString('o')}
    if($d.QuickScanEndTime){$quickEnd=$d.QuickScanEndTime.ToString('o')}
    $defender=[ordered]@{serviceEnabled=[bool]$d.AMServiceEnabled;antivirusEnabled=[bool]$d.AntivirusEnabled;antispywareEnabled=[bool]$d.AntispywareEnabled;realTimeProtectionEnabled=[bool]$d.RealTimeProtectionEnabled;ioavProtectionEnabled=[bool]$d.IoavProtectionEnabled;behaviorMonitorEnabled=[bool]$d.BehaviorMonitorEnabled;onAccessProtectionEnabled=[bool]$d.OnAccessProtectionEnabled;tamperProtectionEnabled=[bool]$d.IsTamperProtected;signatureVersion=[string]$d.AntivirusSignatureVersion;signatureUpdated=$sig;quickScanStarted=$quickStart;quickScanEnded=$quickEnd}
  }
} catch {}
$firewall=@()
try {$firewall=@(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object {[pscustomobject]@{name=[string]$_.Name;enabled=[bool]$_.Enabled;inboundAction=[string]$_.DefaultInboundAction;outboundAction=[string]$_.DefaultOutboundAction}})} catch {}
$threatCount=0;try{$threatCount=@(Get-MpThreatDetection -ErrorAction Stop).Count}catch{}
[ordered]@{supported=($null -ne $defender);defender=$defender;firewall=$firewall;detectionEventCount=$threatCount;collectedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 -Compress
`;
  return await runPowerShellJson(script,30000,4*1024*1024) || {supported:false,defender:null,firewall:[],message:'Aucune information de sécurité communiquée par Windows.'};
}
async function requestDefenderQuickScan() {
  if(process.platform!=='win32') return {ok:false,message:'Action disponible sous Windows avec Microsoft Defender.'};
  try {
    const {stdout}=await execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',"Start-MpScan -ScanType QuickScan -ErrorAction Stop; 'SCAN_REQUESTED'"],{timeout:45000,windowsHide:true,maxBuffer:1024*1024});
    if(!String(stdout).includes('SCAN_REQUESTED')) throw new Error('Windows n’a pas confirmé la demande.');
    return {ok:true,requestedAt:new Date().toISOString()};
  } catch(error){return {ok:false,message:String(error?.message||'Impossible de demander l’analyse Defender.').slice(0,400)};}
}

async function getNetworkConfiguration() {
  if(process.platform!=='win32') return {supported:false,items:[],message:'Les détails réseau avancés sont disponibles sous Windows.'};
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$items=@(Get-NetIPConfiguration -ErrorAction SilentlyContinue | ForEach-Object {
 [pscustomobject]@{name=[string]$_.InterfaceAlias;description=[string]$_.InterfaceDescription;profile=[string]$_.NetProfile.Name;ipv4=(@($_.IPv4Address|ForEach-Object{$_.IPAddress}) -join ', ');gateway=(@($_.IPv4DefaultGateway|ForEach-Object{$_.NextHop}) -join ', ');dns=(@($_.DnsServer.ServerAddresses) -join ', ')}
})
ConvertTo-Json -InputObject $items -Depth 4 -Compress
`;
  return {supported:true,items:normalizePowerShellArray(await runPowerShellJson(script,25000,4*1024*1024)),collectedAt:new Date().toISOString()};
}

async function chooseScanFolder() {
  const result=await dialog.showOpenDialog(mainWindow,{title:'Choisir un dossier à analyser',properties:['openDirectory']});
  if(result.canceled||!result.filePaths?.[0]) return {canceled:true};
  const root=await fs.realpath(result.filePaths[0]); const token=crypto.randomUUID();
  scanTokens.set(token,root); while(scanTokens.size>12) scanTokens.delete(scanTokens.keys().next().value);
  return {canceled:false,token,label:root};
}

async function scanDirectory(event,token) {
  const root=scanTokens.get(token);
  if(!root) return {ok:false,message:'Sélection de dossier expirée. Choisissez de nouveau un dossier.'};
  if(activeScanController) return {ok:false,message:'Une analyse de dossier est déjà en cours.'};
  const controller=new AbortController();activeScanController=controller;
  const report={ok:true,root,files:0,directories:0,totalBytes:0,hiddenNameCount:0,skipped:0,scanned:0,limitReached:false,topFolders:[],largestFiles:[],topExtensions:[],collectedAt:null};
  const topEntries=new Map(),extensions=new Map(),largest=[],stack=[{directory:root,depth:0,topKey:null}];
  const maxEntries=200000,maxDepth=24;let lastProgress=0;
  try {
    while(stack.length){
      if(controller.signal.aborted){report.ok=false;report.canceled=true;break;}
      const current=stack.pop();let entries;
      try{entries=await fs.readdir(current.directory,{withFileTypes:true});}catch(_){report.skipped++;continue;}
      for(const entry of entries){
        if(controller.signal.aborted){report.ok=false;report.canceled=true;break;}
        report.scanned++;if(report.scanned>maxEntries){report.limitReached=true;break;}
        const fullPath=path.join(current.directory,entry.name);
        if(entry.name.startsWith('.')) report.hiddenNameCount++;
        if(entry.isSymbolicLink()){report.skipped++;continue;}
        let stat;try{stat=await fs.lstat(fullPath);}catch(_){report.skipped++;continue;}
        if(stat.isSymbolicLink()){report.skipped++;continue;}
        const topKey=current.depth===0?entry.name:current.topKey;
        if(stat.isDirectory()){
          report.directories++;
          if(topKey){if(!topEntries.has(topKey))topEntries.set(topKey,{name:topKey,bytes:0,files:0,directories:0,type:'Dossier'});if(current.depth>0)topEntries.get(topKey).directories++;}
          if(current.depth<maxDepth)stack.push({directory:fullPath,depth:current.depth+1,topKey});else report.skipped++;
        }else if(stat.isFile()){
          const size=Number(stat.size)||0;report.files++;report.totalBytes+=size;
          const rootName=topKey||'(Fichiers à la racine)';
          if(!topEntries.has(rootName))topEntries.set(rootName,{name:rootName,bytes:0,files:0,directories:0,type:current.depth===0?'Fichier':'Dossier'});
          const aggregate=topEntries.get(rootName);aggregate.bytes+=size;aggregate.files++;
          const ext=path.extname(entry.name).toLowerCase()||'(sans extension)';extensions.set(ext,(extensions.get(ext)||0)+size);
          largest.push({name:entry.name,path:fullPath,bytes:size,modifiedAt:stat.mtime?stat.mtime.toISOString():null});
          if(largest.length>40){largest.sort((a,b)=>b.bytes-a.bytes);largest.length=20;}
        }else report.skipped++;
        if(report.scanned-lastProgress>=350){
          lastProgress=report.scanned;sendScanProgress(event,{scanned:report.scanned,files:report.files,directories:report.directories,totalBytes:report.totalBytes,current:fullPath});
          await new Promise(resolve=>setImmediate(resolve));
        }
      }
      if(report.limitReached||report.canceled)break;
    }
    largest.sort((a,b)=>b.bytes-a.bytes);
    report.topFolders=[...topEntries.values()].sort((a,b)=>b.bytes-a.bytes).slice(0,30);
    report.largestFiles=largest.slice(0,20);
    report.topExtensions=[...extensions.entries()].map(([extension,bytes])=>({extension,bytes})).sort((a,b)=>b.bytes-a.bytes).slice(0,15);
    report.collectedAt=new Date().toISOString();
    sendScanProgress(event,{complete:true,scanned:report.scanned,files:report.files,directories:report.directories,totalBytes:report.totalBytes});
    return report;
  }catch(error){if(controller.signal.aborted)return {ok:false,canceled:true,root};return {ok:false,message:String(error?.message||'Analyse impossible').slice(0,400)};}
  finally{activeScanController=null;}
}

async function scanHiddenElements(token) {
  const root=scanTokens.get(token);
  if(!root)return {ok:false,message:'Sélection de dossier expirée. Choisissez de nouveau un dossier.'};
  if(process.platform!=='win32')return {ok:false,supported:false,message:'La détection des attributs cachés Windows nécessite Windows.'};
  const encodedRoot=Buffer.from(root,'utf8').toString('base64');
  const script=String.raw`
$ErrorActionPreference='SilentlyContinue'
$root=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ENCODED_ROOT'))
$count=0;$items=[System.Collections.Generic.List[object]]::new()
Get-ChildItem -LiteralPath $root -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
 $hidden=(($_.Attributes -band [System.IO.FileAttributes]::Hidden)-ne 0)-or $_.Name.StartsWith('.')
 $reparse=(($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint)-ne 0)
 if($hidden -and -not $reparse){$count++;if($items.Count -lt 500){
  $itemType=if($_.PSIsContainer){'Dossier'}else{'Fichier'};$itemBytes=if($_.PSIsContainer){0}else{[int64]$_.Length};$modified=$null
  if($_.LastWriteTime){$modified=$_.LastWriteTime.ToString('o')}
  $items.Add([pscustomobject]@{name=[string]$_.Name;path=[string]$_.FullName;type=$itemType;bytes=$itemBytes;attributes=[string]$_.Attributes;modifiedAt=$modified})
 }}
}
[ordered]@{ok=$true;root=$root;count=$count;items=@($items.ToArray());truncated=($count -gt $items.Count);collectedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 -Compress
`.replace('ENCODED_ROOT',encodedRoot);
  try{return await runPowerShellJson(script,180000,16*1024*1024)||{ok:false,message:'Aucun résultat retourné par Windows.'};}
  catch(error){return {ok:false,message:String(error?.message||'Analyse des éléments cachés impossible.').slice(0,400)};}
}


async function getDiagnostics() {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      message: 'Les diagnostics batterie, périphériques et événements sont disponibles sous Windows.',
      collectedAt: new Date().toISOString(),
      battery: null,
      batteryCount: 0,
      devices: { totalCount: 0, errorCount: 0, errors: [], truncated: false },
      events: { windowDays: 7, criticalCount: 0, errorCount: 0, totalCount: 0, items: [], logsRead: 0, truncated: false }
    };
  }

  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$collectedAt = [DateTime]::UtcNow.ToString('o')
$since = (Get-Date).AddDays(-7)

$batteries = @()
$batteryQueryOk = $false
try { $batteries = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop); $batteryQueryOk = $true } catch {}
$battery = $null
if ($batteries.Count -gt 0) {
  $item = $batteries[0]
  $designed = $null
  $full = $null
  try {
    $staticData = @(Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData -ErrorAction Stop)
    if ($staticData.Count -gt 0 -and [int64]$staticData[0].DesignedCapacity -gt 0) {
      $designed = [int64]$staticData[0].DesignedCapacity
    }
  } catch {}
  try {
    $fullData = @(Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction Stop)
    if ($fullData.Count -gt 0 -and [int64]$fullData[0].FullChargedCapacity -gt 0) {
      $full = [int64]$fullData[0].FullChargedCapacity
    }
  } catch {}
  $health = $null
  if ($designed -gt 0 -and $full -gt 0) {
    $health = [Math]::Round(($full / $designed) * 100, 1)
  }
  $charge = $null
  if ($null -ne $item.EstimatedChargeRemaining) {
    $charge = [Math]::Max(0, [Math]::Min(100, [int]$item.EstimatedChargeRemaining))
  }
  $runtime = $null
  if ($null -ne $item.EstimatedRunTime -and [int64]$item.EstimatedRunTime -gt 0 -and [int64]$item.EstimatedRunTime -lt 71582788) {
    $runtime = [int64]$item.EstimatedRunTime
  }
  $battery = [ordered]@{
    name = [string]$item.Name
    chargePercent = $charge
    statusCode = if ($null -ne $item.BatteryStatus) { [int]$item.BatteryStatus } else { $null }
    estimatedMinutes = $runtime
    designedCapacity = $designed
    fullChargeCapacity = $full
    healthPercent = $health
    chemistryCode = if ($null -ne $item.Chemistry) { [int]$item.Chemistry } else { $null }
  }
}

$allDevices = @()
$devicesQueryOk = $false
try { $allDevices = @(Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction Stop); $devicesQueryOk = $true } catch {}
$problemDescriptions = @{
  1 = 'Configuration incorrecte'
  10 = 'Le périphérique ne peut pas démarrer'
  12 = 'Ressources insuffisantes'
  14 = 'Redémarrage nécessaire'
  22 = 'Périphérique désactivé'
  28 = 'Pilote non installé'
  31 = 'Windows ne peut pas charger le pilote'
  37 = 'Pilote impossible à initialiser'
  39 = 'Pilote manquant ou endommagé'
  43 = 'Windows a arrêté le périphérique'
  45 = 'Périphérique non connecté'
  48 = 'Pilote bloqué'
  52 = 'Signature du pilote non vérifiée'
}
$problemDevices = @($allDevices | Where-Object {
  $null -ne $_.ConfigManagerErrorCode -and [int]$_.ConfigManagerErrorCode -ne 0
})
$deviceRows = @($problemDevices | Select-Object -First 80 | ForEach-Object {
  $code = [int]$_.ConfigManagerErrorCode
  $description = $problemDescriptions[$code]
  if ([string]::IsNullOrWhiteSpace($description)) { $description = 'Code de problème Windows' }
  [pscustomobject]@{
    name = [string]$_.Name
    class = [string]$_.PNPClass
    manufacturer = [string]$_.Manufacturer
    status = [string]$_.Status
    errorCode = $code
    description = $description
  }
})

$eventRows = [System.Collections.Generic.List[object]]::new()
$criticalCount = 0
$errorCount = 0
$logsRead = 0
$eventsTruncated = $false
foreach ($logName in @('System', 'Application')) {
  try {
    $logItems = @(Get-WinEvent -FilterHashtable @{ LogName = $logName; StartTime = $since; Level = 1,2 } -MaxEvents 150 -ErrorAction Stop)
    $logsRead++
    foreach ($entry in $logItems) {
      if ([int]$entry.Level -eq 1) { $criticalCount++ } else { $errorCount++ }
      if ($eventRows.Count -lt 300) {
        $message = [string]$entry.Message
        $message = $message -replace '\s+', ' '
        if ($message.Length -gt 360) { $message = $message.Substring(0, 360) + '…' }
        $eventRows.Add([pscustomobject]@{
          time = if ($entry.TimeCreated) { $entry.TimeCreated.ToUniversalTime().ToString('o') } else { $null }
          level = if ([int]$entry.Level -eq 1) { 'Critique' } else { 'Erreur' }
          eventId = [int]$entry.Id
          source = [string]$entry.ProviderName
          log = [string]$entry.LogName
          message = $message
        })
      }
    }
    if ($logItems.Count -ge 150) { $eventsTruncated = $true }
  } catch {}
}
$latestEvents = @($eventRows | Sort-Object time -Descending | Select-Object -First 100)

[ordered]@{
  supported = $true
  collectedAt = $collectedAt
  battery = $battery
  batteryCount = $batteries.Count
  batteryQueryOk = $batteryQueryOk
  devices = [ordered]@{
    available = $devicesQueryOk
    totalCount = $allDevices.Count
    errorCount = $problemDevices.Count
    errors = $deviceRows
    truncated = ($problemDevices.Count -gt $deviceRows.Count)
  }
  events = [ordered]@{
    windowDays = 7
    criticalCount = $criticalCount
    errorCount = $errorCount
    totalCount = ($criticalCount + $errorCount)
    items = $latestEvents
    logsRead = $logsRead
    truncated = $eventsTruncated
    maxPerLog = 150
  }
} | ConvertTo-Json -Depth 7 -Compress
`;

  try {
    return await runPowerShellJson(script, 60000, 12 * 1024 * 1024) || {
      supported: false,
      message: 'Windows n’a retourné aucune donnée de diagnostic.',
      collectedAt: new Date().toISOString(),
      battery: null,
      batteryCount: 0,
      devices: { totalCount: 0, errorCount: 0, errors: [], truncated: false },
      events: { windowDays: 7, criticalCount: 0, errorCount: 0, totalCount: 0, items: [], logsRead: 0, truncated: false }
    };
  } catch (error) {
    return {
      supported: false,
      message: String(error?.message || 'Lecture des diagnostics impossible.').slice(0, 400),
      collectedAt: new Date().toISOString(),
      battery: null,
      batteryCount: 0,
      devices: { totalCount: 0, errorCount: 0, errors: [], truncated: false },
      events: { windowDays: 7, criticalCount: 0, errorCount: 0, totalCount: 0, items: [], logsRead: 0, truncated: false }
    };
  }
}

async function openSystemTool(toolKey) {
 const settings={windowsUpdate:'ms-settings:windowsupdate',storage:'ms-settings:storagesense',startup:'ms-settings:startupapps',security:'ms-settings:windowsdefender',apps:'ms-settings:appsfeatures',display:'ms-settings:display',network:'ms-settings:network-status'};
 if(settings[toolKey]){try{await shell.openExternal(settings[toolKey]);return {ok:true};}catch(error){return {ok:false,message:String(error?.message||'Impossible d’ouvrir ce réglage.')};}}
 const commands={taskManager:['taskmgr.exe',[]],deviceManager:['mmc.exe',['devmgmt.msc']],diskCleanup:['cleanmgr.exe',[]],resourceMonitor:['resmon.exe',[]],systemInformation:['msinfo32.exe',[]]};
 const command=commands[toolKey];if(!command||process.platform!=='win32')return {ok:false,message:'Outil indisponible sur cette plateforme.'};
 const child=execFile(command[0],command[1],{windowsHide:false});child.on('error',()=>{});return {ok:true};
}


ipcMain.handle('system:base', () => getBaseInfo());
ipcMain.handle('system:memory', () => getMemoryInfo());
ipcMain.handle('system:cpu', () => getCpuUsage());
ipcMain.handle('system:disks', () => getDiskInfo());
ipcMain.handle('system:details', () => getSystemDetails());
ipcMain.handle('system:processes', () => getProcessList());
ipcMain.handle('system:network', () => getNetworkConfiguration());
ipcMain.handle('diagnostics:run', () => getDiagnostics());
ipcMain.handle('apps:installed', () => getInstalledApplications());
ipcMain.handle('apps:startup', () => getStartupApplications());
ipcMain.handle('security:status', () => getWindowsSecurityStatus());
ipcMain.handle('security:quick-scan', () => requestDefenderQuickScan());
ipcMain.handle('scan:choose-folder', () => chooseScanFolder());
ipcMain.handle('scan:directory', (event, token) => scanDirectory(event, token));
ipcMain.handle('scan:hidden', (_event, token) => scanHiddenElements(token));
ipcMain.handle('scan:cancel', () => { if(!activeScanController)return {ok:false,message:'Aucune analyse en cours.'};activeScanController.abort();return {ok:true}; });
ipcMain.handle('tools:open', (_event, toolKey) => openSystemTool(toolKey));

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
  isPortable: isPortableMode(),
  distribution: isPortableMode() ? 'portable' : (app.isPackaged ? 'installed' : 'development'),
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

ipcMain.handle('community:open-discord', async () => {
  try {
    await shell.openExternal(DISCORD_INVITE_URL);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: String(error?.message || 'Ouverture du serveur Discord impossible.').slice(0, 300)
    };
  }
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

app.on('before-quit', () => { app.isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
