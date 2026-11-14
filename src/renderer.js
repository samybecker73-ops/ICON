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

const tour = [
  {
    title: 'Bienvenue dans ICON.',
    text: 'Votre centre de contrôle PC, sans compte, sans inscription et avec des informations conservées localement.'
  },
  {
    title: 'Comprenez votre ordinateur.',
    text: 'L’accueil affiche les ressources principales. Mon PC détaille les composants, le système, les disques et les périphériques.'
  },
  {
    title: 'ICON va évoluer avec vous.',
    text: 'L’analyse des fichiers, les processus, la sécurité et les éléments cachés seront ajoutés progressivement.'
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
      version: '0.2.1',
      generatedAt: new Date().toISOString(),
      note: 'Rapport local : inventaire matériel et mesures système. Aucune analyse antivirus ni analyse approfondie de fichiers effectuée.',
      hardwareDetails: hardwareInventory,
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
      message: 'Les mises à jour automatiques seront disponibles dans la version installée d’ICON pour Windows.'
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
  document.querySelectorAll('[data-feature]').forEach(button => button.addEventListener('click', () =>
    toastMessage(`Le module « ${button.dataset.feature} » sera construit dans une prochaine étape.`)));
  document.querySelectorAll('[data-pc-tab]').forEach(button => button.addEventListener('click', () => selectPcTab(button.dataset.pcTab)));

  $('#open-pc-page').addEventListener('click', () => navigate('pc'));
  $('#pc-refresh-button').addEventListener('click', analysePc);
  $('#pc-export-button').addEventListener('click', exportReport);
  $('#refresh-button').addEventListener('click', () => refreshData());
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
