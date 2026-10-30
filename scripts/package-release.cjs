'use strict';
// Deterministic, allowlisted source packages. Does not copy runtime or personal data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

const COMMON = [
  'agent.cjs', 'tools-ui.cjs', 'tools-store.cjs', 'platform.cjs', 'manage.cjs', 'recovery.cjs',
  'README.md', 'LICENSE', 'NOTICE.md', 'SECURITY.md', 'CHANGELOG.md',
  'docs/macos.md', 'docs/windows.md', 'docs/usage.md', 'docs/testing.md', 'docs/images/interface.png'
];
const ENTRIES = ['安装', '打开Codex', '恢复插件', '卸载', '诊断'];
function packageFiles(platform) {
  if (!['macos', 'windows'].includes(platform)) throw new Error('Unknown package platform');
  const scripts = platform === 'macos' ? [...ENTRIES.map(name => `scripts/${name}.command`), 'scripts/entry.sh'] :
    [...ENTRIES.map(name => `scripts/${name}.cmd`), 'scripts/manage.ps1'];
  return [...COMMON, ...scripts];
}
function buildRelease({root = path.resolve(__dirname, '..'), outputDir = path.join(root, 'dist'), python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')} = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version');
  fs.mkdirSync(outputDir, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sidebar-release-'));
  const outputs = [];
  try {
    for (const platform of ['macos', 'windows']) {
      const basename = `codex-sidebar-tools-${pkg.version}-${platform}`;
      const staging = path.join(temporary, basename);
      fs.mkdirSync(staging);
      for (const relative of packageFiles(platform)) {
        const source = path.join(root, relative), stat = fs.lstatSync(source);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Package input is not a regular file: ${relative}`);
        const destination = path.join(staging, relative);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.copyFileSync(source, destination);
      }
      // Runtime distribution is intentionally smaller than the developer checkout.
      const runtimePackage = {...pkg, scripts: {start: 'node manage.cjs launch'}};
      fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
      const destination = path.join(outputDir, basename + '.zip');
      const script = [
        'import pathlib, sys, zipfile',
        'root = pathlib.Path(sys.argv[1])',
        'destination = pathlib.Path(sys.argv[2])',
        'with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:',
        '    for source in sorted(root.rglob("*")):',
        '        if not source.is_file(): continue',
        '        relative = source.relative_to(root).as_posix()',
        '        item = zipfile.ZipInfo(root.name + "/" + relative, date_time=(1980,1,1,0,0,0))',
        '        item.create_system = 3',
        '        item.external_attr = (0o100755 if source.suffix in (".command", ".sh") else 0o100644) << 16',
        '        item.compress_type = zipfile.ZIP_DEFLATED',
        '        archive.writestr(item, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)'
      ].join('\n');
      const result = spawnSync(python, ['-c', script, staging, destination], {encoding: 'utf8', windowsHide: true, shell: false});
      if (result.error || result.status !== 0) throw new Error(`ZIP creation failed: ${result.error?.message || result.stderr.trim()}`);
      outputs.push(destination);
    }
    const checksums = outputs.map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n') + '\n';
    const checksumFile = path.join(outputDir, 'SHA256SUMS.txt');
    fs.writeFileSync(checksumFile, checksums);
    return [...outputs, checksumFile];
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}
module.exports = {packageFiles, buildRelease};
if (require.main === module) {
  try { for (const file of buildRelease()) console.log(file); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
