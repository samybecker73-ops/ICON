const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

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
  assert.match(read('.github/workflows/build.yml'), /work\/\*\*/);
});
