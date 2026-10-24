const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const APP_ID = 'com.monqey.code';

function stableExecutable({ home, packaged, env = process.env, execPath = process.execPath }) {
  if (!packaged) return;
  const target = path.resolve(env.PORTABLE_EXECUTABLE_FILE || execPath);
  const relative = path.relative(home, target);
  // Never register the portable app's extracted Temp executable with Windows.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.exe$/i.test(target) || !fs.existsSync(target)) return;
  return target;
}

function repairShortcuts({ shell, home, executable, appData, desktop, platform = process.platform }) {
  const result = { updated: [], errors: [] };
  if (platform !== 'win32') return result;
  if (stableExecutable({ home, packaged: true, env: {}, execPath: executable }) !== executable) throw Error('Shortcuts require an existing executable inside Monqey-Agent.');
  const programs = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const pinned = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const canonical = path.join(programs, 'Monqey Agent.lnk');
  const links = new Set([canonical]);
  for (const folder of [programs, desktop, pinned]) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) if (/^Monqey ?(?:Agent|Code)(?: .*?)?\.lnk$/i.test(name)) links.add(path.join(folder, name));
  }
  for (const file of links) {
    try {
      const exists = fs.existsSync(file);
      const previous = exists ? shell.readShortcutLink(file) : {};
      if (exists && previous.appUserModelId !== APP_ID && !/^Monqey (?:Agent|Code)(?: .*?)?\.exe$/i.test(path.basename(previous.target || ''))) continue;
      const desired = { target: executable, cwd: home, args: previous.args || '', description: 'Monqey Agent', icon: executable, iconIndex: 0, appUserModelId: APP_ID };
      if (Object.entries(desired).every(([key,value]) => previous[key] === value)) continue;
      if (exists) {
        const backup = path.join(home, 'electron-data', 'shortcut-backups', `${randomUUID()}-${path.basename(file)}`);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(file, backup);
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!shell.writeShortcutLink(file, exists ? 'update' : 'create', desired)) throw Error('Windows refused the shortcut update.');
      const actual = shell.readShortcutLink(file);
      if (!Object.entries(desired).every(([key,value]) => actual[key] === value)) throw Error('Windows shortcut verification failed.');
      result.updated.push(file);
    } catch (error) { result.errors.push({ file, message: error.message }); }
  }
  return result;
}
module.exports = { APP_ID, stableExecutable, repairShortcuts };
