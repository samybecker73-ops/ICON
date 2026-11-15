const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('Windows build produces both installer and named portable executable', () => {
  assert.match(pkg.scripts['build:win'], /--win nsis portable/);
  assert.equal(pkg.build.portable.artifactName, 'ICON.exe');
  assert.match(pkg.scripts['build:win:portable'], /--win portable/);
});

test('portable builds do not start the installer auto-updater', () => {
  const main = read('main.js');
  assert.match(main, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(main, /process\.env\.PORTABLE_EXECUTABLE_FILE/);
  assert.match(main, /!isPortableMode\(\)/);
  assert.match(main, /isPortable:\s*isPortableMode\(\)/);
});

test('normal builds cannot publish to GitHub', () => {
  for (const script of ['build:dir', 'build:win', 'build:win:portable', 'build:mac', 'build:linux']) {
    assert.match(pkg.scripts[script], /--publish never/, script + ' must explicitly disable publishing');
  }
  assert.match(pkg.scripts['release:win'], /--publish always/);
});

test('Electron renderer is isolated from Node.js', () => {
  const main = read('main.js');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});

test('file scans are user initiated and do not delete data', () => {
  const html = read('src/index.html');
  const main = read('main.js');
  assert.match(html, /id="disk-choose-folder"/);
  assert.match(html, /id="hidden-choose-folder"/);
  assert.match(main, /showOpenDialog/);
  assert.match(main, /isSymbolicLink\(\)/);
  assert.match(main, /Start-MpScan -ScanType QuickScan/);
  assert.doesNotMatch(main, /Remove-Item\s+-Recurse/i);
});

test('each main module has a navigation target', () => {
  const html = read('src/index.html');
  for (const page of ['home', 'pc', 'disk', 'processes', 'security', 'hidden', 'apps', 'startup', 'network', 'tools']) {
    assert.match(html, new RegExp('data-content-page="' + page + '"'));
    assert.match(html, new RegExp('data-page="' + page + '"'));
  }
});

test('release workflow is restricted to main while work branches build', () => {
  assert.match(read('.github/workflows/release.yml'), /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(read('.github/workflows/release.yml'), /--win nsis portable --publish always/);
  assert.match(read('.github/workflows/build.yml'), /path: dist\/ICON\.exe/);
  assert.match(read('.github/workflows/build.yml'), /work\/\*\*/);
});

test('Discord community entry opens only the configured invite through the main process', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('preload.js');
  const main = read('main.js');

  assert.ok(html.includes('id="open-discord-server"'));
  assert.ok(html.includes('class="discord-icon"'));
  assert.ok(html.includes('Rejoindre Discord'));
  assert.match(renderer, /openDiscordServer\(\)/);
  assert.ok(preload.includes("openDiscordServer: () => ipcRenderer.invoke('community:open-discord')"));
  assert.ok(main.includes("const DISCORD_INVITE_URL = 'https://discord.gg/fKgFP82Jm'"));
  assert.match(main, /ipcMain\.handle\('community:open-discord'/);
  assert.match(main, /shell\.openExternal\(DISCORD_INVITE_URL\)/);
});

test('sidebar version label matches the package version', () => {
  const html = read('src/index.html');
  assert.ok(html.includes('ICON · Version ' + pkg.version));
});


test('diagnostics workspace is wired through the isolated preload bridge', () => {
  const html = read('src/index.html');
  const renderer = read('src/renderer.js');
  const preload = read('preload.js');
  const main = read('main.js');

  assert.match(html, /data-page="diagnostics"/);
  assert.match(html, /data-content-page="diagnostics"/);
  assert.match(html, /id="diagnostics-refresh"/);
  assert.match(html, /id="diagnostics-events-table"/);
  assert.match(renderer, /getDiagnostics\(\)/);
  assert.ok(preload.includes("getDiagnostics: () => ipcRenderer.invoke('diagnostics:run')"));
  assert.match(main, /ipcMain\.handle\('diagnostics:run', \(\) => getDiagnostics\(\)\)/);
});

test('diagnostics only read Windows battery, PnP and event-log state', () => {
  const main = read('main.js');
  const start = main.indexOf('async function getDiagnostics()');
  const end = main.indexOf('async function openSystemTool(toolKey)', start);
  assert.ok(start >= 0 && end > start, 'diagnostics function must exist');
  const diagnostics = main.slice(start, end);

  assert.match(diagnostics, /Win32_Battery/);
  assert.match(diagnostics, /BatteryStaticData/);
  assert.match(diagnostics, /Win32_PnPEntity/);
  assert.match(diagnostics, /Get-WinEvent/);
  assert.match(diagnostics, /AddDays\(-7\)/);
  assert.doesNotMatch(diagnostics, /\b(Remove-Item|Stop-Process|Disable-PnpDevice|Uninstall-Package|Restart-Computer)\b/i);
});
