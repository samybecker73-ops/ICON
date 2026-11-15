'use strict';

const $ = selector => document.querySelector(selector);
const splash = $('#splash');
const appShell = $('#app');
const toast = $('#toast');
let currentSnapshot = null;
let hardwareInventory = null;
let updateInfo = null;
let latestUpdateStatus = null;
let refreshLock = false;
let inventoryLock = false;
let activeTour = 0;
let toastTimer;
const moduleCache={processes:[],applications:[],startup:[],security:null,network:[],diagnostics:null,diskScan:null,hiddenScan:null};
const scanSelection={disk:null,hidden:null};
const moduleLocks=new Set();
let removeScanProgressListener=null;

const tour = [
  {
    title: 'Bienvenue dans ICON.',
    text: 'Votre centre de contrôle PC, sans compte, sans inscription et avec des informations conservées localement.'
  },
  {
    title: 'Comprenez votre ordinateur.',
    text: 'Explorez les disques, les processus, les applications installées, le démarrage, le réseau et les informations de sécurité Windows.'
  },
  {
    title: 'ICON va évoluer avec vous.',
    text: 'Les analyses restent locales et en lecture seule. ICON ne supprime aucun fichier et ne présente pas une protection antivirus comme active sans preuve.'
  }
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function valueOr(value, fallback = 'Non communiqué') {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value);
}

function bytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 'Indisponible';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  if (n === 0) return '0 o';
  const power = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / (1024 ** power)).toLocaleString('fr-FR', { maximumFractionDigits: power > 1 ? 1 : 0 })} ${units[power]}`;
}

function duration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return 'Indisponible';
  const days = Math.floor(n / 86400);
  const hours = Math.floor((n % 86400) / 3600);
  const minutes = Math.floor((n % 3600) / 60);
  return days ? `${days} j ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function setProgress(percent, message) {
  const n = Math.max(0, Math.min(100, Number(percent) || 0));
  $('#boot-progress').style.width = `${n}%`;
  $('#boot-percent').textContent = `${Math.round(n)} %`;
  $('#scan-status').textContent = message;
}

async function readSystemSnapshot(onProgress = () => {}) {
  const base = await window.iconAPI.getBaseInfo();
  onProgress(22, 'Identification du système…');
  const cpu = await window.iconAPI.getCpuUsage();
  onProgress(48, 'Mesure de l’activité du processeur…');
  const memory = await window.iconAPI.getMemoryInfo();
  onProgress(72, 'Lecture de la mémoire vive…');
  const diskResult = await window.iconAPI.getDiskInfo();
  const disks = Array.isArray(diskResult) ? diskResult : (diskResult?.disks || []);
  onProgress(94, 'Détection des volumes de stockage…');
  onProgress(100, 'Ouverture du tableau de bord…');
  return { base, cpu, memory, disks, collectedAt: new Date().toISOString() };
}

function setMetric(valueId, captionId, barId, percent, caption) {
  const valid = Number.isFinite(Number(percent));
  const n = valid ? Math.max(0, Math.min(100, Math.round(Number(percent)))) : null;
  $(valueId).innerHTML = n === null ? '—' : `${n}<small>%</small>`;
  $(captionId).textContent = caption;
  $(barId).style.width = `${n ?? 0}%`;
}

function mainDisk(disks) {
  return disks.find(d => /^C:\\?$/i.test(String(d.name))) || disks.find(d => d.name === '/') || disks[0] || null;
}

function renderDisks(disks) {
  const node = $('#disk-list');
  if (!disks.length) {
    node.innerHTML = '<div class="empty-state">Aucun volume local détecté.</div>';
    return;
  }
  node.innerHTML = disks.map(disk => {
    const percent = Math.max(0, Math.min(100, Number(disk.usedPercent) || 0));
    return `<div class="disk-entry">
      <div class="disk-entry-top"><span class="disk-entry-name">${esc(disk.name)} · ${esc(disk.label || 'Disque local')}</span><span class="disk-entry-usage">${percent}% utilisé</span></div>
      <div class="disk-track"><span style="width:${percent}%"></span></div>
      <div class="disk-entry-meta"><span>${bytes(disk.usedBytes)} utilisés</span><span>${bytes(disk.freeBytes)} libres · ${bytes(disk.totalBytes)} au total</span></div>
    </div>`;
  }).join('');
}

function renderSnapshot(snapshot) {
  currentSnapshot = snapshot;
  const { base, cpu, memory, disks } = snapshot;
  const disk = mainDisk(disks);
  setMetric('#cpu-value', '#cpu-caption', '#cpu-bar', cpu?.usedPercent, valueOr(base.cpuModel));
  setMetric('#memory-value', '#memory-caption', '#memory-bar', memory?.usedPercent,
    `${bytes(memory?.usedBytes)} utilisés sur ${bytes(memory?.totalBytes)}`);
  if (disk) {
    setMetric('#disk-value', '#disk-caption', '#disk-bar', disk.usedPercent,
      `${bytes(disk.usedBytes)} utilisés sur ${bytes(disk.totalBytes)} · ${disk.name}`);
  } else {
    $('#disk-value').textContent = 'N/D';
    $('#disk-caption').textContent = 'Aucun volume détecté';
    $('#disk-bar').style.width = '0%';
  }

  $('#computer-name').textContent = valueOr(base.hostname, 'Cet ordinateur');
  $('#system-subtitle').textContent = `${valueOr(base.versionName)} · ${valueOr(base.arch).toUpperCase()}`;
  $('#detail-cpu').textContent = valueOr(base.cpuModel);
  $('#detail-cores').textContent = Number.isFinite(base.cpuCores) ? String(base.cpuCores) : 'Indisponible';
  $('#detail-arch').textContent = valueOr(base.arch).toUpperCase();
  $('#detail-ram').textContent = bytes(memory?.totalBytes);
  $('#detail-uptime').textContent = duration(base.uptimeSeconds);
  renderDisks(disks);
  $('#last-updated').textContent = `Données locales · ${new Date(snapshot.collectedAt).toLocaleTimeString('fr-FR')}`;
}

function normalArray(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}
function first(value) { return normalArray(value)[0] || {}; }

function dateValue(value) {
  if (!value) return 'Non communiqué';
  const source = String(value);
  const dmtf = source.match(/^(\d{4})(\d{2})(\d{2})/);
  const d = dmtf ? new Date(+dmtf[1], +dmtf[2] - 1, +dmtf[3]) : new Date(source);
  return Number.isNaN(d.getTime()) ? source : d.toLocaleDateString('fr-FR');
}
function clock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Non communiqué';
  return n >= 1000 ? `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} GHz` : `${n} MHz`;
}
function speed(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 'Non communiqué';
  const mbps = n / 1e6;
  return mbps >= 1000 ? `${(mbps / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Gbit/s` : `${mbps.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Mbit/s`;
}

function rows(items) {
  return items.map(([label, val]) => `<div class="pc-data-row"><span>${esc(label)}</span><strong>${esc(valueOr(val))}</strong></div>`).join('');
}
function card(title, subtitle, pairs, icon = '▣') {
  return `<article class="pc-hardware-card">
    <div class="pc-hardware-heading"><span class="pc-hardware-icon">${esc(icon)}</span><div><h3>${esc(title)}</h3><p>${esc(subtitle || '')}</p></div></div>
    <div class="pc-data-list">${rows(pairs)}</div>
  </article>`;
}
function showCards(selector, list, builder, empty) {
  const node = $(selector);
  node.innerHTML = list.length ? list.map(builder).join('') : `<div class="empty-state">${esc(empty || 'Aucun élément communiqué par Windows.')}</div>`;
}

function renderInventory(data) {
  hardwareInventory = data;
  const computer = first(data.computer);
  const operatingSystem = first(data.operatingSystem);
  const cpus = normalArray(data.processors);
  const graphics = normalArray(data.graphics);
  const memories = normalArray(data.memoryModules);
  const boards = normalArray(data.baseboards);
  const bios = normalArray(data.bios);
  const disks = normalArray(data.physicalDisks);
  const networks = normalArray(data.networkAdapters);
  const monitors = normalArray(data.monitors);
  const cpu = cpus[0] || {};
  const gpu = graphics[0] || {};
  const board = boards[0] || {};
  const firmware = bios[0] || {};
  const totalMemory = Number(computer.TotalPhysicalMemory) || memories.reduce((total, item) => total + (Number(item.Capacity) || 0), 0);

  $('#pc-device-name').textContent = `${valueOr(computer.Manufacturer, '')} ${valueOr(computer.Model, currentSnapshot?.base?.hostname || 'Ordinateur')}`.trim();
  $('#pc-device-subtitle').textContent = data.supported
    ? `${valueOr(operatingSystem.Caption)} · ${valueOr(operatingSystem.OSArchitecture)}`
    : valueOr(data.message, 'Inventaire approfondi indisponible.');
  $('#pc-scan-status').textContent = data.supported ? 'Inventaire effectué' : 'Inventaire limité';

  const summary = [
    ['Processeur', valueOr(cpu.Name, currentSnapshot?.base?.cpuModel), `${valueOr(cpu.NumberOfCores, '—')} cœurs · ${valueOr(cpu.NumberOfLogicalProcessors, '—')} threads`, '⌘'],
    ['Carte graphique', valueOr(gpu.Name), valueOr(gpu.DriverVersion, 'Pilote non communiqué'), '▧'],
    ['Mémoire installée', totalMemory ? bytes(totalMemory) : 'Non communiquée', `${memories.length} module(s) détecté(s)`, '▥'],
    ['Carte mère', valueOr(board.Product), valueOr(board.Manufacturer, ''), '▦'],
    ['BIOS / UEFI', valueOr(firmware.SMBIOSBIOSVersion), valueOr(firmware.Manufacturer, ''), '⌁'],
    ['Disques physiques', `${disks.length} détecté(s)`, `${normalArray(currentSnapshot?.disks).length} volume(s) logique(s)`, '▤']
  ];
  $('#pc-summary-grid').innerHTML = summary.map(([name, main, sub, icon]) =>
    `<article class="pc-summary-card"><div class="pc-summary-card-top"><span>${esc(name)}</span><b>${esc(icon)}</b></div><strong>${esc(main)}</strong><small>${esc(sub)}</small></article>`
  ).join('');

  $('#pc-os-details').innerHTML = rows([
    ['Édition', operatingSystem.Caption], ['Version', operatingSystem.Version], ['Build', operatingSystem.BuildNumber],
    ['Architecture', operatingSystem.OSArchitecture], ['Disque système', operatingSystem.SystemDrive],
    ['Dossier Windows', operatingSystem.WindowsDirectory], ['Date d’installation', dateValue(operatingSystem.InstallDate)]
  ]);
  $('#pc-computer-details').innerHTML = rows([
    ['Fabricant', computer.Manufacturer], ['Modèle', computer.Model], ['Type', computer.SystemType],
    ['Processeurs physiques', computer.NumberOfProcessors], ['Domaine / groupe', computer.Domain],
    ['Nom de l’appareil', currentSnapshot?.base?.hostname]
  ]);

  showCards('#pc-processors', cpus, item => card(valueOr(item.Name, 'Processeur'), valueOr(item.Manufacturer, ''), [
    ['Cœurs physiques', item.NumberOfCores], ['Threads logiques', item.NumberOfLogicalProcessors],
    ['Fréquence actuelle', clock(item.CurrentClockSpeed)], ['Fréquence maximale', clock(item.MaxClockSpeed)],
    ['Cache L2', item.L2CacheSize ? bytes(Number(item.L2CacheSize) * 1024) : null],
    ['Cache L3', item.L3CacheSize ? bytes(Number(item.L3CacheSize) * 1024) : null]
  ], '⌘'));

  showCards('#pc-graphics', graphics, item => card(valueOr(item.Name, 'Carte graphique'), valueOr(item.AdapterCompatibility, ''), [
    ['Version du pilote', item.DriverVersion], ['Date du pilote', dateValue(item.DriverDate)],
    ['Résolution rapportée', item.CurrentHorizontalResolution && item.CurrentVerticalResolution ? `${item.CurrentHorizontalResolution} × ${item.CurrentVerticalResolution}` : item.VideoModeDescription],
    ['Fréquence écran', item.CurrentRefreshRate ? `${item.CurrentRefreshRate} Hz` : null]
  ], '▧'));

  showCards('#pc-memory-modules', memories, (item, index) => card(valueOr(item.DeviceLocator, `Barrette ${index + 1}`), valueOr(item.Manufacturer, ''), [
    ['Capacité', bytes(Number(item.Capacity))], ['Vitesse nominale', item.Speed ? `${item.Speed} MT/s` : null],
    ['Vitesse configurée', item.ConfiguredClockSpeed ? `${item.ConfiguredClockSpeed} MT/s` : null],
    ['Référence', item.PartNumber], ['Emplacement', item.DeviceLocator]
  ], '▥'));

  $('#pc-baseboards').innerHTML = boards.length ? boards.map(item => rows([
    ['Fabricant', item.Manufacturer], ['Modèle', item.Product], ['Révision', item.Version]
  ])).join('') : '<div class="empty-state">Informations carte mère non disponibles.</div>';
  $('#pc-bios').innerHTML = bios.length ? bios.map(item => rows([
    ['Fabricant', item.Manufacturer], ['Version SMBIOS', item.SMBIOSBIOSVersion],
    ['Version', item.Version], ['Date de publication', dateValue(item.ReleaseDate)]
  ])).join('') : '<div class="empty-state">Informations BIOS non disponibles.</div>';

  showCards('#pc-physical-disks', disks, (item, index) => card(valueOr(item.Model, `Disque ${index + 1}`), valueOr(item.MediaType, ''), [
    ['Capacité', bytes(Number(item.Size))], ['Interface', item.InterfaceType],
    ['Firmware', item.FirmwareRevision], ['État communiqué', item.Status]
  ], '▤'));
  showCards('#pc-network', networks, (item, index) => card(valueOr(item.Name, `Adaptateur ${index + 1}`), valueOr(item.Manufacturer, ''), [
    ['État', item.NetEnabled === true ? 'Activé' : item.NetEnabled === false ? 'Désactivé' : null],
    ['Vitesse rapportée', speed(item.Speed)], ['Adaptateur physique', 'Oui']
  ], '⌁'));
  showCards('#pc-monitors', monitors, (item, index) => card(valueOr(item.Name, `Écran ${index + 1}`), valueOr(item.MonitorManufacturer, ''), [
    ['Largeur', item.ScreenWidth ? `${item.ScreenWidth} px` : null],
    ['Hauteur', item.ScreenHeight ? `${item.ScreenHeight} px` : null]
  ], '▣'));

  $('#pc-last-updated').textContent = `Inventaire local · ${new Date(data.collectedAt || Date.now()).toLocaleString('fr-FR')}`;
}

async function analysePc() {
  if (inventoryLock) return;
  inventoryLock = true;
  const button = $('#pc-refresh-button');
  button.disabled = true;
  button.textContent = 'Analyse en cours…';
  $('#pc-scan-status').textContent = 'Lecture des composants…';
  try {
    const data = await window.iconAPI.getSystemDetails();
    renderInventory(data);
    toastMessage(data.supported ? 'Inventaire matériel actualisé.' : 'Inventaire avancé non disponible sur ce système.');
  } catch (error) {
    console.error('ICON inventory:', error);
    $('#pc-scan-status').textContent = 'Analyse impossible';
    toastMessage('Impossible de lire l’inventaire matériel. Vérifiez les autorisations Windows.');
  } finally {
    inventoryLock = false;
    button.disabled = false;
    button.innerHTML = '<span class="button-symbol">↻</span> Analyser mon PC';
  }
}

function selectPcTab(name) {
  document.querySelectorAll('[data-pc-tab]').forEach(button => button.classList.toggle('active', button.dataset.pcTab === name));
  document.querySelectorAll('.pc-tab-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `pc-tab-${name}`));
}
function navigate(page) {
  $('#dashboard').classList.toggle('hidden', page !== 'home');
  $('#pc-page').classList.toggle('hidden', page !== 'pc');
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('.titlebar-label').textContent = page === 'pc' ? 'Inventaire matériel' : 'Centre de contrôle';
  if (page === 'pc' && !hardwareInventory && !inventoryLock) analysePc();
}

function tourRender() {
  const item = tour[activeTour];
  $('#tour-step-label').textContent = `${activeTour + 1} / ${tour.length}`;
  $('#tour-title').textContent = item.title;
  $('#tour-description').textContent = item.text;
  $('#tour-next').innerHTML = activeTour === tour.length - 1 ? 'Terminer <span>✓</span>' : 'Suivant <span>→</span>';
  $('#tour-skip').textContent = activeTour === tour.length - 1 ? 'Fermer' : 'Passer la visite';
  document.querySelectorAll('.tour-dots i').forEach((dot, index) => dot.classList.toggle('active', index === activeTour));
}
function showTour() {
  activeTour = 0;
  tourRender();
  $('#tour-overlay').classList.remove('hidden');
}
function endTour() {
  localStorage.setItem('icon-tour-completed', 'true');
  $('#tour-overlay').classList.add('hidden');
}

async function refreshData(silent = false) {
  if (refreshLock) return;
  refreshLock = true;
  const button = $('#refresh-button');
  button.disabled = true;
  button.innerHTML = '<span class="button-symbol">↻</span> Actualisation…';
  try {
    renderSnapshot(await readSystemSnapshot());
    if (!silent) toastMessage('Informations du PC actualisées.');
  } catch (error) {
    console.error('ICON refresh:', error);
    if (!silent) toastMessage('Certaines informations système sont indisponibles.');
  } finally {
    refreshLock = false;
    button.disabled = false;
    button.innerHTML = '<span class="button-symbol">↻</span> Actualiser les données';
  }
}

async function exportReport() {
  if (!currentSnapshot) {
    toastMessage('Aucune donnée système à exporter.');
    return;
  }
  try {
    const result = await window.iconAPI.exportReport({
      application: 'ICON',
      version: updateInfo?.currentVersion || '0.2.1',
      generatedAt: new Date().toISOString(),
      note: 'Rapport local : inventaire matériel et mesures système. Aucune analyse antivirus ni analyse approfondie de fichiers effectuée.',
      hardwareDetails: hardwareInventory,
      modules: moduleCache,
      ...currentSnapshot
    });
    if (!result.canceled) toastMessage('Rapport système exporté.');
  } catch (error) {
    console.error('ICON export:', error);
    toastMessage('Impossible d’exporter le rapport système.');
  }
}

function openSettings() {
  $('#settings-overlay').classList.remove('hidden');
  if (updateInfo) $('#update-current-version').textContent = updateInfo.currentVersion || '—';
}
function closeSettings() {
  $('#settings-overlay').classList.add('hidden');
}
function updaterStatus(status) {
  latestUpdateStatus = status;
  const message = $('#update-status');
  const check = $('#check-updates-button');
  const download = $('#download-update-button');
  const install = $('#install-update-button');
  const progressWrap = $('#update-progress-wrap');
  const notes = $('#update-release-notes');
  check.disabled = ['checking', 'downloading'].includes(status.state);
  download.classList.add('hidden');
  install.classList.add('hidden');
  progressWrap.classList.add('hidden');
  notes.classList.add('hidden');

  if (status.state === 'checking') {
    message.textContent = 'Recherche des nouvelles versions sur GitHub…';
  } else if (status.state === 'available') {
    message.textContent = `Une nouvelle version ${status.version || ''} est disponible.`;
    download.classList.remove('hidden');
    if (status.releaseNotes) {
      notes.textContent = String(status.releaseNotes).slice(0, 1800);
      notes.classList.remove('hidden');
    }
    toastMessage('Une mise à jour ICON est disponible.');
  } else if (status.state === 'downloading') {
    const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
    message.textContent = 'Téléchargement de la mise à jour…';
    progressWrap.classList.remove('hidden');
    $('#update-progress').style.width = `${percent}%`;
    $('#update-progress-label').textContent = `${percent.toFixed(0)} %`;
  } else if (status.state === 'downloaded') {
    message.textContent = `La version ${status.version || ''} est prête à être installée.`;
    progressWrap.classList.remove('hidden');
    $('#update-progress').style.width = '100%';
    $('#update-progress-label').textContent = '100 %';
    install.classList.remove('hidden');
    toastMessage('Mise à jour prête à être installée.');
  } else if (status.state === 'not-available') {
    message.textContent = `ICON est à jour (version ${status.version || updateInfo?.currentVersion || 'actuelle'}).`;
  } else if (status.state === 'unsupported') {
    message.textContent = status.message || 'Mises à jour disponibles dans la version installée de Windows.';
    check.disabled = true;
  } else if (status.state === 'error') {
    message.textContent = `Impossible de vérifier les mises à jour. ${status.message || 'Vérifiez votre connexion Internet.'}`;
  } else {
    message.textContent = 'Prêt à vérifier les mises à jour.';
  }
}
async function initializeUpdater() {
  try {
    updateInfo = await window.iconAPI.getUpdaterInfo();
    $('#update-current-version').textContent = updateInfo.currentVersion || '—';
    if (!updateInfo.supported) updaterStatus({
      state: 'unsupported',
      message: updateInfo.isPortable
        ? 'Vous utilisez ICON Portable. Pour mettre à jour, téléchargez la nouvelle version ICON.exe depuis les téléchargements GitHub.'
        : 'Les mises à jour automatiques seront disponibles dans la version installée d’ICON pour Windows.'
    });
    else if (latestUpdateStatus) updaterStatus(latestUpdateStatus);
  } catch (error) {
    console.warn('ICON updater:', error);
    updaterStatus({ state: 'error', message: 'Service de mise à jour indisponible.' });
  }
}
async function checkUpdates() {
  $('#check-updates-button').disabled = true;
  updaterStatus({ state: 'checking' });
  try {
    const result = await window.iconAPI.checkForUpdates();
    if (!result.ok) updaterStatus({ state: result.supported === false ? 'unsupported' : 'error', message: result.message || 'Vérification impossible.' });
  } catch (error) {
    updaterStatus({ state: 'error', message: error.message });
  } finally {
    $('#check-updates-button').disabled = false;
  }
}
async function downloadUpdate() {
  $('#download-update-button').disabled = true;
  $('#update-status').textContent = 'Préparation du téléchargement…';
  try {
    const result = await window.iconAPI.downloadUpdate();
    if (!result.ok) updaterStatus({ state: 'error', message: result.message || 'Téléchargement impossible.' });
  } catch (error) {
    updaterStatus({ state: 'error', message: error.message });
  } finally {
    $('#download-update-button').disabled = false;
  }
}
async function installUpdate() {
  $('#install-update-button').disabled = true;
  $('#update-status').textContent = 'Redémarrage et installation…';
  try {
    const result = await window.iconAPI.installUpdate();
    if (!result.ok) {
      $('#install-update-button').disabled = false;
      updaterStatus({ state: 'error', message: result.message || 'Installation impossible.' });
    }
  } catch (error) {
    $('#install-update-button').disabled = false;
    updaterStatus({ state: 'error', message: error.message });
  }
}


function shortDate(value){if(!value)return 'Non communiqué';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('fr-FR');}
function renderTable(selector,columns,data,emptyText){
 const node=$(selector);if(!node)return;if(!data.length){node.innerHTML='<div class="empty-state">'+esc(emptyText||'Aucune donnée communiquée.')+'</div>';return;}
 node.innerHTML='<table class="module-table"><thead><tr>'+columns.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+
 data.map(item=>'<tr>'+columns.map(c=>'<td>'+(c.render?c.render(item):esc(valueOr(item[c.key],'—')))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function filterItems(items,search,fields){const q=String(search||'').trim().toLocaleLowerCase('fr-FR');return q?items.filter(item=>fields.some(f=>String(item[f]??'').toLocaleLowerCase('fr-FR').includes(q))):items;}

function renderProcesses(){
 const items=moduleCache.processes;$('#process-count').textContent=items.length.toLocaleString('fr-FR');
 $('#process-memory').textContent=bytes(items.reduce((s,x)=>s+(Number(x.memoryBytes)||0),0));
 $('#process-threads').textContent=items.reduce((s,x)=>s+(Number(x.threads)||0),0).toLocaleString('fr-FR');
 renderTable('#process-table',[
  {label:'Processus',key:'name'},{label:'PID',key:'pid'},{label:'Mémoire',render:x=>esc(bytes(x.memoryBytes))},
  {label:'CPU cumulé',render:x=>esc((Number(x.cpuSeconds)||0).toLocaleString('fr-FR',{maximumFractionDigits:1})+' s')},
  {label:'Threads',key:'threads'},{label:'Handles',key:'handles'}
 ],filterItems(items,$('#process-search').value,['name','pid','path']),'Aucun processus ne correspond à la recherche.');
}
async function loadProcesses(){
 if(moduleLocks.has('processes'))return;moduleLocks.add('processes');$('#process-table').innerHTML='<div class="empty-state">Lecture des processus Windows…</div>';
 try{const r=await window.iconAPI.getProcesses();if(!r.supported){$('#process-table').innerHTML='<div class="empty-state">'+esc(r.message)+'</div>';return;}
 moduleCache.processes=(r.items||[]).sort((a,b)=>(Number(b.memoryBytes)||0)-(Number(a.memoryBytes)||0));renderProcesses();
 }catch(e){console.error('ICON processes:',e);$('#process-table').innerHTML='<div class="empty-state">Impossible de lire les processus.</div>';}finally{moduleLocks.delete('processes');}
}

function renderApplications(){
 const items=moduleCache.applications;$('#apps-count').textContent=items.length.toLocaleString('fr-FR');
 $('#apps-publishers').textContent=new Set(items.map(x=>x.publisher).filter(Boolean)).size.toLocaleString('fr-FR');
 renderTable('#apps-table',[
  {label:'Application',key:'name'},{label:'Version',key:'version'},{label:'Éditeur',key:'publisher'},
  {label:'Installée le',key:'installDate'},{label:'Taille déclarée',render:x=>esc(x.estimatedSizeKb?bytes(Number(x.estimatedSizeKb)*1024):'—')}
 ],filterItems(items,$('#apps-search').value,['name','version','publisher']),'Aucune application ne correspond à la recherche.');
}
async function loadApplications(){
 if(moduleLocks.has('applications'))return;moduleLocks.add('applications');$('#apps-table').innerHTML='<div class="empty-state">Lecture des applications installées…</div>';
 try{const r=await window.iconAPI.getInstalledApplications();if(!r.supported){$('#apps-table').innerHTML='<div class="empty-state">'+esc(r.message)+'</div>';return;}
 moduleCache.applications=(r.items||[]).sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'));renderApplications();
 }catch(e){console.error('ICON apps:',e);$('#apps-table').innerHTML='<div class="empty-state">Impossible de lire le registre.</div>';}finally{moduleLocks.delete('applications');}
}
function renderStartup(){
 const items=moduleCache.startup;$('#startup-count').textContent=items.length.toLocaleString('fr-FR');
 $('#startup-users').textContent=new Set(items.map(x=>x.user).filter(Boolean)).size.toLocaleString('fr-FR');
 renderTable('#startup-table',[
  {label:'Élément',key:'name'},{label:'Utilisateur',key:'user'},{label:'Emplacement',key:'location'},
  {label:'Commande',render:x=>'<span class="path-cell" title="'+esc(x.command||'')+'">'+esc(x.command||'Non communiqué')+'</span>'}
 ],filterItems(items,$('#startup-search').value,['name','command','location','user']),'Aucune entrée ne correspond à la recherche.');
}
async function loadStartup(){
 if(moduleLocks.has('startup'))return;moduleLocks.add('startup');$('#startup-table').innerHTML='<div class="empty-state">Lecture des entrées de démarrage…</div>';
 try{const r=await window.iconAPI.getStartupApplications();if(!r.supported){$('#startup-table').innerHTML='<div class="empty-state">'+esc(r.message)+'</div>';return;}
 moduleCache.startup=(r.items||[]).sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'));renderStartup();
 }catch(e){console.error('ICON startup:',e);$('#startup-table').innerHTML='<div class="empty-state">Impossible de lire les entrées.</div>';}finally{moduleLocks.delete('startup');}
}
function stateText(v){if(v===true)return{label:'Activé',state:'positive'};if(v===false)return{label:'Désactivé',state:'warning'};return{label:'Non communiqué',state:'neutral'};}
function renderSecurity(data){
 moduleCache.security=data;const d=data?.defender;const fw=data?.firewall||[];
 if(!data?.supported||!d){
  $('#security-state-banner').className='security-state-banner neutral';
  $('#security-state-banner').innerHTML='<strong>État non disponible</strong><span>Windows n’a pas communiqué les informations de Microsoft Defender. Vérifiez Sécurité Windows.</span>';
  $('#security-cards').innerHTML=[['Antivirus','Inconnu','Aucune donnée fiable'],['Protection temps réel','Inconnue','Aucune donnée fiable'],['Pare-feu','Inconnu','Aucune donnée fiable'],['Signatures','Inconnues','Aucune donnée fiable']]
   .map(a=>'<article class="module-stat"><span>'+esc(a[0])+'</span><strong>'+esc(a[1])+'</strong><small>'+esc(a[2])+'</small></article>').join('');
  $('#security-defender-details').innerHTML='<div class="empty-state">Aucun statut exploitable. ICON ne conclut pas que le PC est protégé.</div>';
 }else{
  const av=stateText(d.antivirusEnabled),rt=stateText(d.realTimeProtectionEnabled);
  const known=fw.length>0&&fw.every(x=>typeof x.enabled==='boolean'),fwOn=known&&fw.every(x=>x.enabled===true);
  const sig=d.signatureVersion||'Non communiquée';const all=av.state==='positive'&&rt.state==='positive'&&known&&fwOn;
  $('#security-state-banner').className='security-state-banner '+(all?'positive':'warning');
  $('#security-state-banner').innerHTML='<strong>'+(all?'Protections vérifiées comme activées':'Vérifications nécessaires')+'</strong><span>Informations retournées par Windows à '+esc(shortDate(data.collectedAt))+'.</span>';
  $('#security-cards').innerHTML=[
   ['Antivirus',av.label,'Microsoft Defender',av.state],['Protection temps réel',rt.label,'Surveillance en direct',rt.state],
   ['Pare-feu',known?(fwOn?'Activé':'Partiel / désactivé'):'Inconnu',fw.length+' profil(s)',known&&fwOn?'positive':'warning'],
   ['Signatures',sig,d.signatureUpdated?shortDate(d.signatureUpdated):'Date inconnue','neutral']
  ].map(a=>'<article class="module-stat '+a[3]+'"><span>'+esc(a[0])+'</span><strong>'+esc(a[1])+'</strong><small>'+esc(a[2])+'</small></article>').join('');
  $('#security-defender-details').innerHTML=rows([
   ['Service antivirus',stateText(d.serviceEnabled).label],['Antivirus actif',av.label],['Protection temps réel',rt.label],
   ['Protection comportementale',stateText(d.behaviorMonitorEnabled).label],['Fichiers téléchargés',stateText(d.ioavProtectionEnabled).label],
   ['Protection contre les altérations',stateText(d.tamperProtectionEnabled).label],['Version des signatures',sig],
   ['Dernière mise à jour',shortDate(d.signatureUpdated)],['Début dernière analyse rapide',shortDate(d.quickScanStarted)],['Fin dernière analyse rapide',shortDate(d.quickScanEnded)]
  ]);
 }
 $('#security-firewall-details').innerHTML=fw.length?fw.map(x=>rows([['Profil',x.name],['État',stateText(x.enabled).label],['Entrant par défaut',x.inboundAction],['Sortant par défaut',x.outboundAction]])).join(''):'<div class="empty-state">Aucun état de pare-feu communiqué.</div>';
}
async function loadSecurity(){
 if(moduleLocks.has('security'))return;moduleLocks.add('security');$('#security-state-banner').innerHTML='<strong>Lecture en cours…</strong><span>Interrogation de Defender et du pare-feu Windows.</span>';
 try{renderSecurity(await window.iconAPI.getSecurityStatus());}catch(e){console.error('ICON security:',e);renderSecurity({supported:false,defender:null,firewall:[]});}finally{moduleLocks.delete('security');}
}
async function requestQuickScan(){
 if(!window.confirm('Demander à Microsoft Defender de lancer une analyse rapide ? L’analyse sera exécutée par Windows.'))return;
 const b=$('#defender-quick-scan');b.disabled=true;b.textContent='Demande en cours…';
 try{const r=await window.iconAPI.requestDefenderQuickScan();if(r.ok){toastMessage('Demande transmise à Microsoft Defender. Consultez Sécurité Windows pour suivre l’analyse.');$('#security-state-banner').className='security-state-banner neutral';$('#security-state-banner').innerHTML='<strong>Analyse rapide demandée</strong><span>Windows Defender traite la demande en arrière-plan. Le résultat final sera communiqué par Sécurité Windows.</span>';}else toastMessage(r.message||'Impossible de lancer l’analyse.');}
 catch(e){toastMessage('Impossible de communiquer avec Microsoft Defender.');}finally{b.disabled=false;b.textContent='Demander une analyse rapide';}
}
async function chooseScanFolder(kind){
 try{const r=await window.iconAPI.chooseScanFolder();if(r.canceled)return;scanSelection[kind]=r;
 if(kind==='disk'){$('#disk-selected-folder').textContent=r.label;$('#disk-run-scan').disabled=false;}
 else{$('#hidden-selected-folder').textContent=r.label;$('#hidden-run-scan').disabled=false;}
 }catch(e){toastMessage('Impossible de sélectionner ce dossier.');}
}
function renderDiskScan(r){
 moduleCache.diskScan=r;$('#disk-files-count').textContent=Number(r.files||0).toLocaleString('fr-FR');$('#disk-folders-count').textContent=Number(r.directories||0).toLocaleString('fr-FR');
 $('#disk-total-size').textContent=bytes(r.totalBytes);$('#disk-skipped-count').textContent=Number(r.skipped||0).toLocaleString('fr-FR');
 $('#disk-scan-title').textContent=r.canceled?'Analyse interrompue':'Analyse terminée';$('#disk-progress-bar').style.width=r.canceled?'0%':'100%';
 $('#disk-progress-text').textContent=r.limitReached?'Limite de sécurité atteinte : résultats partiels.':(r.canceled?'Analyse annulée.':'Analyse terminée · '+shortDate(r.collectedAt));
 $('#disk-progress-count').textContent=Number(r.scanned||0).toLocaleString('fr-FR')+' éléments parcourus';
 renderTable('#disk-top-folders',[{label:'Dossier ou fichier',key:'name'},{label:'Fichiers',render:x=>esc(Number(x.files||0).toLocaleString('fr-FR'))},{label:'Espace',render:x=>esc(bytes(x.bytes))}],r.topFolders||[],'Aucun élément accessible.');
 renderTable('#disk-extensions',[{label:'Extension',key:'extension'},{label:'Espace total',render:x=>esc(bytes(x.bytes))}],r.topExtensions||[],'Aucun fichier trouvé.');
 renderTable('#disk-largest-files',[{label:'Fichier',key:'name'},{label:'Taille',render:x=>'<strong>'+esc(bytes(x.bytes))+'</strong>'},{label:'Modification',render:x=>esc(shortDate(x.modifiedAt))},{label:'Emplacement',render:x=>'<span class="path-cell" title="'+esc(x.path)+'">'+esc(x.path)+'</span>'}],r.largestFiles||[],'Aucun fichier trouvé.');
}
async function runDiskScan(){
 const s=scanSelection.disk;if(!s?.token||moduleLocks.has('disk'))return;moduleLocks.add('disk');$('#disk-run-scan').disabled=true;$('#disk-cancel-scan').classList.remove('hidden');
 $('#disk-scan-title').textContent='Analyse du dossier…';$('#disk-progress-bar').style.width='8%';$('#disk-progress-text').textContent='Lecture en mode lecture seule…';$('#disk-progress-count').textContent='Démarrage';
 try{const r=await window.iconAPI.scanDirectory(s.token);if(!r.ok&&!r.canceled){toastMessage(r.message||'Analyse impossible.');$('#disk-scan-title').textContent='Analyse impossible';}else renderDiskScan(r);}
 catch(e){console.error('ICON disk:',e);toastMessage('Erreur pendant l’analyse du dossier.');}
 finally{moduleLocks.delete('disk');$('#disk-run-scan').disabled=false;$('#disk-cancel-scan').classList.add('hidden');}
}
async function runHiddenScan(){
 const s=scanSelection.hidden;if(!s?.token||moduleLocks.has('hidden'))return;moduleLocks.add('hidden');$('#hidden-run-scan').disabled=true;$('#hidden-result-state').textContent='Analyse en cours…';
 $('#hidden-table').innerHTML='<div class="empty-state">Recherche des attributs Hidden. Cela peut prendre un moment…</div>';
 try{const r=await window.iconAPI.scanHiddenElements(s.token);if(!r.ok){$('#hidden-result-state').textContent='Non disponible';$('#hidden-table').innerHTML='<div class="empty-state">'+esc(r.message||'Analyse impossible.')+'</div>';return;}
 moduleCache.hiddenScan=r;$('#hidden-count').textContent=Number(r.count||0).toLocaleString('fr-FR');$('#hidden-shown').textContent=(r.items||[]).length.toLocaleString('fr-FR');$('#hidden-result-state').textContent=r.truncated?'500 premiers résultats':'Analyse terminée';
 renderTable('#hidden-table',[{label:'Nom',key:'name'},{label:'Type',key:'type'},{label:'Taille',render:x=>esc(x.type==='Fichier'?bytes(x.bytes):'—')},{label:'Attributs',key:'attributes'},{label:'Emplacement',render:x=>'<span class="path-cell" title="'+esc(x.path)+'">'+esc(x.path)+'</span>'}],r.items||[],'Aucun élément caché détecté.');
 if(r.truncated)toastMessage('Plus de 500 éléments : seuls les 500 premiers sont affichés.');
 }catch(e){console.error('ICON hidden:',e);toastMessage('Erreur pendant la recherche des éléments cachés.');}finally{moduleLocks.delete('hidden');$('#hidden-run-scan').disabled=false;}
}

function batteryStatusLabel(code) {
  const labels = {
    1: 'Autre état', 2: 'Inconnu', 3: 'Complètement chargée', 4: 'Faible',
    5: 'Critique', 6: 'En charge', 7: 'En charge · niveau élevé',
    8: 'En charge · niveau faible', 9: 'En charge · niveau critique',
    10: 'État non défini', 11: 'Partiellement chargée'
  };
  return labels[Number(code)] || 'Non communiqué';
}
function renderDiagnosticsBattery(battery, batteryCount, batteryQueryOk) {
  if (!battery) {
    $('#diagnostics-battery-charge').textContent = 'N/D';
    $('#diagnostics-battery-caption').textContent = batteryQueryOk === false ? 'Source batterie inaccessible' : (batteryCount ? 'Informations batterie indisponibles' : 'Aucune batterie détectée');
    $('#diagnostics-battery-health').textContent = 'N/D';
    $('#diagnostics-battery-details').innerHTML = '<div class="empty-state">' + (batteryQueryOk === false ? 'Windows n’a pas permis de lire les informations de batterie.' : 'Aucune batterie compatible n’a été détectée. C’est normal sur un ordinateur fixe.') + '</div>';
    return;
  }
  const charge = battery.chargePercent !== null && battery.chargePercent !== undefined && Number.isFinite(Number(battery.chargePercent)) ? Number(battery.chargePercent) : null;
  const health = battery.healthPercent !== null && battery.healthPercent !== undefined && Number.isFinite(Number(battery.healthPercent)) ? Number(battery.healthPercent) : null;
  $('#diagnostics-battery-charge').textContent = charge === null ? '—' : charge.toLocaleString('fr-FR') + ' %';
  $('#diagnostics-battery-caption').textContent = batteryStatusLabel(battery.statusCode);
  $('#diagnostics-battery-health').textContent = health === null ? '—' : health.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  $('#diagnostics-battery-details').innerHTML = rows([
    ['Modèle', battery.name],
    ['État rapporté par Windows', batteryStatusLabel(battery.statusCode)],
    ['Charge actuelle', charge === null ? null : charge + ' %'],
    ['Autonomie estimée', battery.estimatedMinutes !== null && battery.estimatedMinutes !== undefined && Number.isFinite(Number(battery.estimatedMinutes)) ? duration(Number(battery.estimatedMinutes) * 60) : null],
    ['Capacité d’origine', battery.designedCapacity !== null && battery.designedCapacity !== undefined && Number.isFinite(Number(battery.designedCapacity)) ? Number(battery.designedCapacity).toLocaleString('fr-FR') + ' mWh' : null],
    ['Capacité pleine charge', battery.fullChargeCapacity !== null && battery.fullChargeCapacity !== undefined && Number.isFinite(Number(battery.fullChargeCapacity)) ? Number(battery.fullChargeCapacity).toLocaleString('fr-FR') + ' mWh' : null],
    ['État de santé estimé', health === null ? null : health.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %']
  ]);
}
function renderDiagnosticsDevices(devices) {
  const errors = devices?.errors || [];
  const count = Number(devices?.errorCount || 0);
  $('#diagnostics-device-errors').textContent = devices?.available === false ? 'N/D' : count.toLocaleString('fr-FR');
  $('#diagnostics-device-caption').textContent = devices?.available === false ? 'Source Plug-and-Play inaccessible' : Number(devices?.totalCount || 0).toLocaleString('fr-FR') + ' périphériques détectés';
  $('#diagnostics-device-summary').textContent = devices?.available === false
    ? 'Windows n’a pas communiqué les informations Plug-and-Play.'
    : (count ? `${count.toLocaleString('fr-FR')} périphérique(s) signalé(s) par Windows. La liste est informative : ICON ne modifie aucun pilote.` : 'Aucun code d’erreur Plug-and-Play n’a été retourné par Windows lors de cette lecture.');
  renderTable('#diagnostics-device-table', [
    { label: 'Périphérique', key: 'name' },
    { label: 'Classe', key: 'class' },
    { label: 'Fabricant', key: 'manufacturer' },
    { label: 'Code', render: item => '<strong>' + esc(item.errorCode) + '</strong>' },
    { label: 'Information Windows', key: 'description' }
  ], errors, devices?.available === false ? 'Liste de périphériques indisponible.' : 'Aucun périphérique en erreur n’a été signalé.');
  if (devices?.truncated) $('#diagnostics-device-summary').textContent += ' Liste limitée aux 80 premières entrées.';
}
function renderDiagnosticsEvents(data) {
  const events = data?.items || [];
  const filtered = filterItems(events, $('#diagnostics-event-search').value, ['time', 'level', 'eventId', 'source', 'log', 'message']);
  renderTable('#diagnostics-events-table', [
    { label: 'Date', render: item => esc(shortDate(item.time)) },
    { label: 'Niveau', render: item => '<span class="diagnostics-event-level ' + (item.level === 'Critique' ? 'critical' : 'error') + '">' + esc(item.level) + '</span>' },
    { label: 'Source', key: 'source' },
    { label: 'ID', key: 'eventId' },
    { label: 'Journal', key: 'log' },
    { label: 'Détail', render: item => '<span class="diagnostics-event-message" title="' + esc(item.message) + '">' + esc(item.message) + '</span>' }
  ], filtered, 'Aucun événement critique ou erreur trouvé dans les journaux accessibles.');
}
function renderDiagnostics(data) {
  moduleCache.diagnostics = data;
  if (!data?.supported) {
    $('#diagnostics-state').className = 'security-state-banner neutral';
    $('#diagnostics-state').innerHTML = '<strong>Diagnostics indisponibles</strong><span>' + esc(data?.message || 'Windows n’a pas communiqué les informations nécessaires.') + '</span>';
    return;
  }
  const devices = data.devices || {};
  const events = data.events || {};
  const issueCount = Number(devices.errorCount || 0) + Number(events.criticalCount || 0) + Number(events.errorCount || 0);
  const partial = devices.available === false || Number(events.logsRead || 0) < 2;
  $('#diagnostics-state').className = 'security-state-banner ' + (issueCount ? 'warning' : (partial ? 'neutral' : 'positive'));
  $('#diagnostics-state').innerHTML = issueCount
    ? '<strong>Points à examiner : ' + issueCount.toLocaleString('fr-FR') + '</strong><span>Ce total rassemble les périphériques en erreur et les événements critiques/erreurs trouvés. Il ne constitue pas un score de santé.</span>'
    : (partial
      ? '<strong>Lecture partielle</strong><span>Au moins une source Windows n’a pas pu être lue. L’absence de résultat ne signifie pas qu’aucun problème n’existe.</span>'
      : '<strong>Aucun signal prioritaire trouvé</strong><span>Les journaux accessibles et les statuts Plug-and-Play n’ont pas retourné de problème dans le périmètre analysé.</span>');
  renderDiagnosticsBattery(data.battery, data.batteryCount, data.batteryQueryOk);
  renderDiagnosticsDevices(devices);
  const total = Number(events.totalCount || 0);
  $('#diagnostics-event-count').textContent = total.toLocaleString('fr-FR');
  $('#diagnostics-event-caption').textContent = Number(events.criticalCount || 0).toLocaleString('fr-FR') + ' critique(s) · ' + Number(events.errorCount || 0).toLocaleString('fr-FR') + ' erreur(s)';
  $('#diagnostics-events-summary').textContent = `${total.toLocaleString('fr-FR')} événement(s) retourné(s) dans les journaux accessibles sur les 7 derniers jours.`;
  if (Number(events.logsRead || 0) < 2) $('#diagnostics-events-summary').textContent += ' Certains journaux n’ont pas pu être lus ou ne sont pas disponibles.';
  if (events.truncated) $('#diagnostics-events-summary').textContent += ' La limite de lecture a été atteinte dans au moins un journal.';
  renderDiagnosticsEvents(events);
  $('#diagnostics-state').title = 'Dernière lecture : ' + shortDate(data.collectedAt);
}
async function loadDiagnostics() {
  if (moduleLocks.has('diagnostics')) return;
  moduleLocks.add('diagnostics');
  const button = $('#diagnostics-refresh');
  button.disabled = true;
  button.textContent = 'Diagnostic en cours…';
  $('#diagnostics-state').className = 'security-state-banner neutral';
  $('#diagnostics-state').innerHTML = '<strong>Lecture en cours…</strong><span>Interrogation de la batterie, des périphériques et des journaux Windows.</span>';
  try {
    const result = await window.iconAPI.getDiagnostics();
    renderDiagnostics(result);
    if (result?.supported) toastMessage('Diagnostic Windows terminé.');
  } catch (error) {
    console.error('ICON diagnostics:', error);
    $('#diagnostics-state').className = 'security-state-banner warning';
    $('#diagnostics-state').innerHTML = '<strong>Diagnostic impossible</strong><span>Une erreur est survenue pendant la lecture des informations Windows.</span>';
    toastMessage('Impossible de terminer le diagnostic.');
  } finally {
    moduleLocks.delete('diagnostics');
    button.disabled = false;
    button.textContent = 'Relancer le diagnostic';
  }
}

async function loadNetwork(){
 if(moduleLocks.has('network'))return;moduleLocks.add('network');$('#network-table').innerHTML='<div class="empty-state">Lecture des interfaces…</div>';
 try{const r=await window.iconAPI.getNetworkConfiguration();if(!r.supported){$('#network-table').innerHTML='<div class="empty-state">'+esc(r.message||'Non disponible.')+'</div>';return;}
 moduleCache.network=r.items||[];renderTable('#network-table',[{label:'Interface',key:'name'},{label:'Description',key:'description'},{label:'Réseau',key:'profile'},{label:'Adresse IPv4',key:'ipv4'},{label:'Passerelle',key:'gateway'},{label:'DNS',key:'dns'}],moduleCache.network,'Aucune interface IP configurée.');
 }catch(e){console.error('ICON network:',e);$('#network-table').innerHTML='<div class="empty-state">Impossible de lire le réseau.</div>';}finally{moduleLocks.delete('network');}
}
async function openTool(key){try{const r=await window.iconAPI.openSystemTool(key);toastMessage(r.ok?'Outil Windows ouvert.':r.message||'Impossible d’ouvrir cet outil.');}catch(e){toastMessage('Impossible d’ouvrir cet outil Windows.');}}
function handleScanProgress(p){
 if(!p||p.complete)return;$('#disk-scan-title').textContent='Analyse en cours…';$('#disk-progress-bar').style.width='65%';
 $('#disk-progress-text').textContent=Number(p.files||0).toLocaleString('fr-FR')+' fichiers · '+Number(p.directories||0).toLocaleString('fr-FR')+' dossiers · '+bytes(p.totalBytes);
 $('#disk-progress-count').textContent=Number(p.scanned||0).toLocaleString('fr-FR')+' éléments';
}
function navigate(page){
 document.querySelectorAll('[data-content-page]').forEach(p=>p.classList.toggle('hidden',p.dataset.contentPage!==page));
 document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 const names={home:'Centre de contrôle',pc:'Inventaire matériel',disk:'Analyse disque',processes:'Processus',security:'Sécurité',diagnostics:'Diagnostics',hidden:'Éléments cachés',apps:'Applications installées',startup:'Démarrage',network:'Réseau',tools:'Outils système'};
 $('.titlebar-label').textContent=names[page]||'Centre de contrôle';
 if(page==='pc'&&!hardwareInventory&&!inventoryLock)analysePc();if(page==='processes')loadProcesses();if(page==='security')loadSecurity();if(page==='diagnostics')loadDiagnostics();
 if(page==='apps')loadApplications();if(page==='startup')loadStartup();if(page==='network')loadNetwork();
}

function setupEvents() {
  document.querySelectorAll('[data-window]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.window;
      if (action === 'minimize') window.iconAPI.minimize();
      if (action === 'maximize') window.iconAPI.toggleMaximize();
      if (action === 'close') window.iconAPI.close();
    });
  });
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));

  document.querySelectorAll('[data-pc-tab]').forEach(button => button.addEventListener('click', () => selectPcTab(button.dataset.pcTab)));

  $('#open-pc-page').addEventListener('click', () => navigate('pc'));
  $('#pc-refresh-button').addEventListener('click', analysePc);
  $('#pc-export-button').addEventListener('click', exportReport);
  $('#refresh-button').addEventListener('click', () => refreshData());
  $('#disk-choose-folder').addEventListener('click', () => chooseScanFolder('disk'));
  $('#disk-run-scan').addEventListener('click', runDiskScan);
  $('#disk-cancel-scan').addEventListener('click', async () => { await window.iconAPI.cancelScan(); });
  $('#hidden-choose-folder').addEventListener('click', () => chooseScanFolder('hidden'));
  $('#hidden-run-scan').addEventListener('click', runHiddenScan);
  $('#process-refresh').addEventListener('click', loadProcesses);
  $('#process-search').addEventListener('input', renderProcesses);
  $('#security-refresh').addEventListener('click', loadSecurity);
  $('#diagnostics-refresh').addEventListener('click', loadDiagnostics);
  $('#diagnostics-export').addEventListener('click', exportReport);
  $('#diagnostics-event-search').addEventListener('input', () => renderDiagnosticsEvents(moduleCache.diagnostics?.events));
  $('#defender-quick-scan').addEventListener('click', requestQuickScan);
  $('#apps-refresh').addEventListener('click', loadApplications);
  $('#apps-search').addEventListener('input', renderApplications);
  $('#startup-refresh').addEventListener('click', loadStartup);
  $('#startup-search').addEventListener('input', renderStartup);
  $('#network-refresh').addEventListener('click', loadNetwork);
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => openTool(b.dataset.tool)));
  removeScanProgressListener = window.iconAPI.onScanProgress(handleScanProgress);
  $('#open-discord-server').addEventListener('click', async () => {
    try {
      const result = await window.iconAPI.openDiscordServer();
      if (!result?.ok) toastMessage(result?.message || 'Impossible d’ouvrir le serveur Discord.');
    } catch (error) {
      console.warn('ICON Discord link:', error);
      toastMessage('Impossible d’ouvrir le serveur Discord dans le navigateur.');
    }
  });
  $('#open-settings').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings-overlay').addEventListener('click', event => { if (event.target === $('#settings-overlay')) closeSettings(); });
  $('#check-updates-button').addEventListener('click', checkUpdates);
  $('#download-update-button').addEventListener('click', downloadUpdate);
  $('#install-update-button').addEventListener('click', installUpdate);
  $('#replay-tour').addEventListener('click', showTour);
  $('#tour-next').addEventListener('click', () => {
    if (activeTour < tour.length - 1) { activeTour += 1; tourRender(); }
    else endTour();
  });
  $('#tour-skip').addEventListener('click', endTour);
  $('#tour-close').addEventListener('click', endTour);
  $('#tour-overlay').addEventListener('click', event => { if (event.target === $('#tour-overlay')) endTour(); });
}

function startLiveRefresh() {
  let running = false;
  setInterval(async () => {
    if (running || !currentSnapshot || document.hidden) return;
    running = true;
    try {
      const [cpu, memory] = await Promise.all([window.iconAPI.getCpuUsage(), window.iconAPI.getMemoryInfo()]);
      currentSnapshot.cpu = cpu;
      currentSnapshot.memory = memory;
      setMetric('#cpu-value', '#cpu-caption', '#cpu-bar', cpu.usedPercent, valueOr(currentSnapshot.base.cpuModel));
      setMetric('#memory-value', '#memory-caption', '#memory-bar', memory.usedPercent,
        `${bytes(memory.usedBytes)} utilisés sur ${bytes(memory.totalBytes)}`);
    } catch (error) {
      console.warn('ICON live metrics:', error);
    } finally {
      running = false;
    }
  }, 3000);
}

function animateWave() {
  const canvas = $('#wave-canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let phase = 0;
  let raf;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    phase += 0.0065;
    context.clearRect(0, 0, width, height);
    const gap = width < 900 ? 25 : 22;
    const cols = Math.ceil(width / gap);
    const rowsCount = Math.ceil(height / gap);
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    for (let row = 0; row <= rowsCount; row += 1) {
      for (let col = 0; col <= cols; col += 1) {
        const x = col * gap;
        const y = row * gap;
        const nx = x / Math.max(width, 1);
        const ny = y / Math.max(height, 1);
        const waveA = Math.sin(nx * 8.7 + phase * 1.15 + ny * 3.1);
        const waveB = Math.cos(ny * 8.2 - phase * 0.95 + nx * 2.4);
        const waveC = Math.sin((nx + ny) * 5.4 + phase * 0.55);
        const py = y + waveA * 22 + waveB * 17 + waveC * 10;
        const dist = Math.hypot(x - centerX, (y - centerY) * 0.85) / Math.max(width, height);
        const edge = Math.min(1, Math.max(0, (dist - 0.12) * 2.9));
        const ridge = Math.max(0, (Math.sin(nx * 7.5 + ny * 3.8 + phase * 0.8) + 1) / 2);
        const alpha = Math.min(0.75, (0.07 + ridge * 0.23) * edge);
        if (alpha < 0.045) continue;
        context.beginPath();
        context.fillStyle = `rgba(226,232,240,${alpha})`;
        context.arc(x, py, 0.65 + ridge * 0.7, 0, Math.PI * 2);
        context.fill();
      }
    }
    raf = requestAnimationFrame(draw);
  }
  resize();
  window.addEventListener('resize', resize);
  draw();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}

async function boot() {
  window.iconAPI.onUpdateStatus(updaterStatus);
  initializeUpdater();
  setupEvents();
  animateWave();
  setProgress(4, 'Démarrage d’ICON…');
  try {
    const snapshot = await readSystemSnapshot((percent, text) => setProgress(percent, text));
    renderSnapshot(snapshot);
    await new Promise(resolve => setTimeout(resolve, 360));
    splash.classList.add('hidden');
    appShell.classList.remove('hidden');
    startLiveRefresh();
    if (localStorage.getItem('icon-tour-completed') !== 'true') setTimeout(showTour, 420);
  } catch (error) {
    console.error('ICON startup:', error);
    $('#boot-error').textContent = 'Certaines informations ne sont pas accessibles. Ouverture de l’accueil…';
    setProgress(100, 'Ouverture du tableau de bord…');
    await new Promise(resolve => setTimeout(resolve, 450));
    splash.classList.add('hidden');
    appShell.classList.remove('hidden');
    toastMessage('ICON est ouvert, mais certaines données système sont indisponibles.');
  }
}

boot();
