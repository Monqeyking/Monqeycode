import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { sessionIdentifier } from '../../monqey-code-memory/lib/identifiers.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => { if (!/^[0-9a-f-]{36}$/i.test(value ?? '')) throw Error('Invalid checkpoint identifier.'); return value; };
const ignored = new Set(['.git', '.monqey', 'node_modules', '.pnpm-store', 'npm-cache', 'storages', 'sessions', 'logs', 'electron-data', 'local-appdata', 'vendor', 'upstream-deepseek-harness', 'library', 'temp', 'obj', 'bin', 'dist', 'build', 'coverage', '.next', 'artifacts', 'electron-builder-cache']);
const excluded = name => ignored.has(name.toLowerCase()) || /^(?:dist-|\.env|\.credentials)|\.(?:exe|dll|apk|zip|pdb|lnk|png|jpe?g|webp|gif|ico|bmp|tga|psd|fbx|blend|obj|gltf|glb|wav|mp3|ogg|mp4|pdf|docx|xlsx|unitypackage|ttf|woff2?|db|sqlite3?|pak|mpq)$/i.test(name);
const limits = { files: 20000, bytes: 256 * 1024 * 1024, disk: 512 * 1024 * 1024, keep: 20 };
const atomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
};
export function inside(root, relative, checkLinks = true) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || excluded(part))) throw Error('Unsafe or excluded checkpoint path.');
  const full = path.resolve(root, relative), rest = path.relative(root, full);
  if (rest.startsWith('..') || path.isAbsolute(rest)) throw Error('Checkpoint path is outside this workspace.');
  if (!checkLinks) return full;
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Checkpoint path contains a link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}
function rootPath(folder) {
  const absolute = path.resolve(folder);
  if (fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase()) throw Error('Use the real workspace folder, not a linked folder.');
  if (fs.lstatSync(absolute).isSymbolicLink()) throw Error('Linked workspace folders are not supported.');
  return absolute;
}
function sharedStamp(root) {
  const dir = path.join(root, '.monqey');
  if (!fs.existsSync(dir)) return '';
  let count = 0, bytes = 0; const entries = [];
  function walk(folder) {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('Shared project metadata contains a link.');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        if (++count > 10000 || (bytes += stat.size) > 16 * 1024 * 1024) throw Error('Shared project metadata exceeds the checkpoint check budget.');
        entries.push([path.relative(dir, file), hash(fs.readFileSync(file))]);
      }
    }
  }
  walk(dir); return hash(JSON.stringify(entries));
}
export class Checkpoints {
  constructor(home) { this.root = path.join(home, 'storages', 'checkpoints'); this.blobs = path.join(this.root, 'blobs'); this.records = path.join(this.root, 'records'); this.active = new Set(); this.prune(); }
  list(workspaceId, sessionId) {
    if (!fs.existsSync(this.records)) return [];
    return fs.readdirSync(this.records).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).map(name => this.read(name.slice(0, -5))).filter(row => row.workspaceId === workspaceId && (!sessionId || row.sessionId === sessionId)).sort((a, b) => b.at - a.at);
  }
  read(id) {
    const file = path.join(this.records, `${uuid(id)}.json`);
    if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('Invalid checkpoint size.');
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (row.id !== id || row.format !== 1 || !Number.isSafeInteger(row.at) || !path.isAbsolute(row.folder) || typeof row.shared !== 'string' || !row.before || typeof row.before !== 'object' || Array.isArray(row.before)) throw Error('Invalid checkpoint record.');
    uuid(row.workspaceId); sessionIdentifier(row.sessionId);
    for (const manifest of [row.before, row.after].filter(Boolean)) {
      Object.setPrototypeOf(manifest, null);
      if (Object.keys(manifest).length > limits.files) throw Error('Invalid checkpoint manifest.');
      for (const [name, value] of Object.entries(manifest)) { inside(row.folder, name, false); if (!/^[0-9a-f]{64}$/.test(value?.hash) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > limits.bytes) throw Error('Invalid checkpoint file.'); }
    }
    if (row.targets !== undefined) {
      if (!Array.isArray(row.targets) || !row.targets.length || row.targets.length > 100) throw Error('Invalid checkpoint targets.');
      for (const target of row.targets) inside(row.folder, target, false);
    }
    return row;
  }
  blob(bytes) {
    const digest = hash(bytes), file = path.join(this.blobs, digest);
    if (!fs.existsSync(file)) atomic(file, bytes);
    return { hash: digest, size: bytes.length };
  }
  scan(folder, save = false, targets) {
    const root = rootPath(folder), files = Object.create(null); let bytes = 0, skipped = 0, count = 0;
    const walk = directory => {
      const entries = targets ? targets.map(name => ({ name, isTarget:true })) : fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (excluded(entry.name)) continue;
        const file = entry.isTarget ? inside(root, entry.name) : path.join(directory, entry.name);
        let stat; try { stat = fs.lstatSync(file); } catch (error) { if (entry.isTarget && error.code === 'ENOENT') continue; throw error; }
        if (stat.isSymbolicLink()) { skipped++; continue; }
        if (stat.isDirectory()) { if (entry.isTarget) throw Error('A checkpoint file target is a directory.'); walk(file); }
        else if (stat.isFile()) {
          if (stat.size > 8 * 1024 * 1024) { skipped++; continue; }
          const name = path.relative(root, file).split(path.sep).join('/'); inside(root, name);
          const data = fs.readFileSync(file);
          const after = fs.lstatSync(file);
          if (after.isSymbolicLink() || data.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw Error('A workspace file changed during checkpoint capture. Retry.');
          if (data.includes(0)) { skipped++; continue; }
          if (++count > limits.files || (bytes += stat.size) > limits.bytes) throw Error('Automatic terminal snapshot skipped: workspace exceeds the backup budget (20,000 files / 256 MB). File edits can still have targeted restore points.');
          files[name] = save ? this.blob(data) : { hash: hash(data), size: data.length };
        }
      }
    };
    walk(root); return { files, skipped };
  }
  save(row) { atomic(path.join(this.records, `${row.id}.json`), JSON.stringify(row)); }
  capture(workspace, sessionId, label, targets) {
    this.prune(); const folder = rootPath(workspace.path);
    if (targets) targets = [...new Set(targets.map(target => path.relative(folder, path.resolve(folder,target)).split(path.sep).join('/')))];
    const shared = sharedStamp(folder), scanned = this.scan(folder, true, targets);
    if (shared !== sharedStamp(folder)) throw Error('Shared project changed while capturing the checkpoint.');
    const row = { format: 1, id: randomUUID(), workspaceId: uuid(workspace.id), sessionId: sessionIdentifier(sessionId), folder, label: String(label).slice(0, 120), at: Date.now(), shared, skipped: scanned.skipped, before: scanned.files, after: null, ...(targets ? {targets} : {}) };
    this.save(row); this.active.add(row.id); return row;
  }
  finish(row) {
    row.after = this.scan(row.folder, false, row.targets).files;
    row.sharedAfter = sharedStamp(row.folder);
    if (this.changes(row).length) this.save(row);
    else fs.unlinkSync(path.join(this.records, `${row.id}.json`));
    this.active.delete(row.id); this.prune(row.id);
  }
  changes(row) {
    if (!row.after) return [];
    return [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])].filter(name => row.before[name]?.hash !== row.after[name]?.hash).sort();
  }
  preview(workspace, sessionId, id) {
    const row = this.read(id), folder = rootPath(workspace.path);
    if (row.workspaceId !== workspace.id || row.sessionId !== sessionId || row.folder !== folder) throw Error('Checkpoint belongs to a different agent or workspace.');
    if (!row.after) throw Error('This interrupted checkpoint has no verified final state and cannot be restored.');
    const sharedChanged = row.shared !== sharedStamp(folder) || row.sharedAfter !== row.shared;
    const current = this.scan(folder, false, this.changes(row)).files;
    return { row, files: this.changes(row).map(name => ({ name, action: !row.before[name] ? 'remove' : !row.after[name] ? 'recreate' : 'restore', conflict: sharedChanged || current[name]?.hash !== row.after[name]?.hash })), sharedChanged };
  }
  diff(workspace, sessionId, id, name) {
    const { row, files } = this.preview(workspace, sessionId, id);
    if (!files.some(file => file.name === name)) throw Error('File is not part of this restore point.');
    const before = row.before[name] ? fs.readFileSync(path.join(this.blobs, row.before[name].hash)) : Buffer.alloc(0);
    if (row.before[name] && hash(before) !== row.before[name].hash) throw Error('A checkpoint backup is damaged.');
    let current; try { current = fs.readFileSync(inside(row.folder, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; current = Buffer.alloc(0); }
    const text = bytes => { if (bytes.includes(0)) return '[Binary file]'; try { return new TextDecoder('utf-8', { fatal:true }).decode(bytes).slice(0,8000); } catch { return '[Binary or non-UTF-8 file]'; } };
    return { before:text(before), current:text(current), truncated:before.length>8000||current.length>8000 };
  }
  restore(workspace, sessionId, id, names) {
    if (!Array.isArray(names) || !names.length || names.length > 100 || new Set(names).size !== names.length) throw Error('Choose 1–100 distinct files.');
    const preview = this.preview(workspace, sessionId, id);
    if (names.some(name => !preview.files.some(file => file.name === name && !file.conflict))) throw Error('Selected files changed since this agent action, or shared decisions changed. Nothing was restored.');
    const { row } = preview;
    // Read and verify every backup before the first write.
    const contents = new Map(names.map(name => {
      const expected = row.before[name]; if (!expected) return [name, null];
      const bytes = fs.readFileSync(path.join(this.blobs, expected.hash));
      if (hash(bytes) !== expected.hash || bytes.length !== expected.size) throw Error('A checkpoint backup is damaged. Nothing was restored.');
      return [name, bytes];
    }));
    const guard = this.capture(workspace, sessionId, 'Before manual restore', names);
    try {
      for (const [name, bytes] of contents) {
        const file = inside(row.folder, name);
        let current; try { current = hash(fs.readFileSync(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current !== row.after[name]?.hash || sharedStamp(row.folder) !== row.shared) throw Error('A file or shared decision changed during restore.');
        if (bytes === null) fs.unlinkSync(file); else atomic(file, bytes);
      }
    } catch (error) { throw Error(`Restore stopped: ${error.message} Check the files; recovery checkpoint ${guard.id} was retained.`, { cause: error }); }
    finally { this.finish(guard); }
    return { restored: names.length, guardId: guard.id };
  }
  prune(keepId) {
    if (!fs.existsSync(this.records)) return;
    const rows = fs.readdirSync(this.records).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).map(name => this.read(name.slice(0,-5))).sort((a,b) => b.at-a.at);
    const kept = [], counts = new Map(); let budget = 0;
    for (const row of rows) {
      const count = counts.get(row.workspaceId) ?? 0, size = Object.values(row.before).reduce((sum, item) => sum + item.size, 0);
      if (row.id === keepId || this.active.has(row.id) || count < limits.keep && budget + size <= limits.disk) { kept.push(row); counts.set(row.workspaceId, count+1); budget += size; }
      else fs.unlinkSync(path.join(this.records, `${row.id}.json`));
    }
    const used = new Set(kept.flatMap(row => Object.values(row.before).map(item => item.hash)));
    if (fs.existsSync(this.blobs)) for (const name of fs.readdirSync(this.blobs)) if (/^[0-9a-f]{64}$/.test(name) && !used.has(name)) fs.unlinkSync(path.join(this.blobs, name));
  }
}
