'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {packageFiles, buildRelease} = require('../scripts/package-release.cjs');

test('release allowlist includes only matching launch scripts and public inputs', () => {
  const mac = packageFiles('macos'), windows = packageFiles('windows');
  assert.ok(mac.includes('scripts/打开Codex.command'));
  assert.ok(mac.includes('scripts/entry.sh'));
  assert.ok(mac.includes('scripts/恢复插件.command'));
  assert.ok(!mac.some(file => /\.cmd$|\.ps1$/.test(file)));
  assert.ok(windows.includes('scripts/打开Codex.cmd'));
  assert.ok(windows.includes('scripts/manage.ps1'));
  assert.ok(windows.includes('scripts/恢复插件.cmd'));
  assert.ok(mac.includes('recovery.cjs') && windows.includes('recovery.cjs'));
  assert.ok(!windows.some(file => file.endsWith('.command')));
  for (const file of [...mac, ...windows]) assert.ok(!/(?:^|\/)data\/|sidebar-data|state\.json|\.env|\.log|test\//.test(file));
  assert.throws(() => packageFiles('linux'), /Unknown package platform/);
});

test('ZIP builds are reproducible and exclude private fixture data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sidebar-package-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'codex-sidebar-tools',version:'0.1.0-beta.2',scripts:{test:'node --test'}}));
  for (const relative of new Set([...packageFiles('macos'), ...packageFiles('windows')])) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, relative + '\n');
  }
  fs.mkdirSync(path.join(root, 'data')); fs.writeFileSync(path.join(root, 'data/state.json'), 'PRIVATE_FIXTURE_DO_NOT_PACKAGE');
  fs.writeFileSync(path.join(root, '.env'), 'PRIVATE_FIXTURE_DO_NOT_PACKAGE');
  const first = buildRelease({root,outputDir:path.join(root,'first')});
  const second = buildRelease({root,outputDir:path.join(root,'second')});
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.deepEqual(first.map(hash), second.map(hash));
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(python, ['-c', [
    'import json,sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' print(json.dumps({"names":z.namelist(),"package":json.loads(z.read(next(n for n in z.namelist() if n.endswith("/package.json"))))}))'
  ].join('\n'), first[0]], {encoding:'utf8',shell:false,windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const archive = JSON.parse(result.stdout);
  assert.ok(!archive.names.some(name => name.includes('/data/') || name.includes('sidebar-data') || name.endsWith('/.env')));
  assert.deepEqual(archive.package.scripts,{start:'node manage.cjs launch'});
  const checksums = fs.readFileSync(first[2],'utf8');
  assert.match(checksums,/^[0-9a-f]{64}  codex-sidebar-tools-0\.1\.0-beta\.2-macos\.zip\n[0-9a-f]{64}  codex-sidebar-tools-0\.1\.0-beta\.2-windows\.zip\n$/);
});
