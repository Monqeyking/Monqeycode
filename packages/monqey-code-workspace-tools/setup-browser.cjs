const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const home = path.resolve(__dirname, '../..');
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This desktop distribution currently supports Windows x64.');
  const folder = path.join(home, 'vendor', 'browserskill'), version = '0.3.3';
  fs.mkdirSync(folder, { recursive: true });
  const binary = path.join(folder, 'bsk.exe');
  if (fs.existsSync(binary) && execFileSync(binary, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim() === `bsk ${version}`) { console.log(`BrowserSkill ${version} is installed.`); return; }
  const response = await fetch(`https://github.com/Tencent/BrowserSkill/releases/download/cli-v${version}/bsk-v${version}-x86_64-pc-windows-msvc.zip`);
  if (!response.ok) throw Error(`BrowserSkill download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== '5ed6aa00e60c0538a637febac6bfbc6a0bd55a11083cd90a987968cff4bc0e02') throw Error('BrowserSkill checksum mismatch. Existing installation retained.');
  const archive = path.join(folder, `bsk-${version}.zip`), stage = path.join(folder, `stage-${Date.now()}`);
  fs.writeFileSync(archive, bytes);
  execFileSync('tar.exe', ['-xf', archive, '-C', fs.mkdirSync(stage, { recursive: true }) || stage], { windowsHide: true });
  const source = path.join(stage, 'bsk.exe');
  if (execFileSync(source, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim() !== `bsk ${version}`) throw Error('BrowserSkill version verification failed.');
  const staged = `${binary}.install-${Date.now()}`;
  try { fs.copyFileSync(source, staged); fs.renameSync(staged, binary); }
  finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
  fs.unlinkSync(source); fs.rmdirSync(stage); fs.unlinkSync(archive);
  console.log(`Installed BrowserSkill ${version} inside Monqey Agent.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
