const fs = require('node:fs');
const { existsSync } = fs;
const path = require('node:path');

function isMonqeyRoot(root) {
  return existsSync(path.join(root, 'profiles', 'web', 'package.json'))
    && existsSync(path.join(root, 'desktop-wrapper', 'package.json'));
}

function findRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (isMonqeyRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function resolvePaths({ wrapperDir = __dirname, packaged = false, env = process.env, execPath = process.execPath } = {}) {
  // Portable Electron extracts to a temporary directory; anchor to the original executable.
  const executableDir = env.PORTABLE_EXECUTABLE_DIR
    || (env.PORTABLE_EXECUTABLE_FILE && path.dirname(env.PORTABLE_EXECUTABLE_FILE))
    || path.dirname(execPath);
  let home;
  if (env.MONQEY_HOME) {
    home = path.resolve(packaged ? executableDir : path.join(wrapperDir, '..'), env.MONQEY_HOME);
    if (!isMonqeyRoot(home)) throw new Error('MONQEY_HOME must point to the Monqey-Agent folder containing profiles/web and desktop-wrapper.');
  } else {
    home = findRoot(packaged ? executableDir : wrapperDir);
  }
  if (!home) throw new Error('Cannot find the Monqey-Agent folder. Place the executable inside it, or set MONQEY_HOME to its location.');
  return {
    home,
    profile: path.join(home, 'profiles', 'web'),
    launcher: path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    npmCache: path.join(home, 'npm-cache'),
    localAppData: path.join(home, 'local-appdata'),
    electronData: path.join(home, 'electron-data'),
    logs: path.join(home, 'logs')
  };
}

function repairRuntimeLinks(paths) {
  let repaired = 0;
  const profileModules = path.join(paths.home, 'profiles', 'node_modules');
  const cacheMarker = `${path.sep}npm-cache${path.sep}_npx${path.sep}`;
  const pending = existsSync(profileModules) ? [profileModules] : [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const link = path.join(directory, entry.name);
      if (entry.isSymbolicLink() && !existsSync(link)) {
        const target = path.resolve(directory, fs.readlinkSync(link));
        const marker = target.lastIndexOf(cacheMarker);
        if (marker < 0) continue;
        const replacement = path.join(paths.home, target.slice(marker + 1));
        if (!existsSync(replacement)) continue;
        fs.unlinkSync(link);
        fs.symlinkSync(replacement, link, process.platform === 'win32' ? 'junction' : 'dir');
        repaired++;
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(link);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.profile, 'package.json'), 'utf8'));
  for (const [name, spec] of Object.entries(manifest.dependencies || {})) {
    if (!spec.startsWith('link:')) continue;
    const replacement = path.resolve(paths.profile, spec.slice(5));
    const relative = path.relative(paths.home, replacement);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const link = path.join(paths.profile, 'node_modules', name);
    if (existsSync(link) || !existsSync(replacement)) continue;
    let stat;
    try { stat = fs.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat && !stat.isSymbolicLink()) continue;
    if (stat) fs.unlinkSync(link);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(replacement, link, process.platform === 'win32' ? 'junction' : 'dir');
    repaired++;
  }
  return repaired;
}

module.exports = { resolvePaths, repairRuntimeLinks };
