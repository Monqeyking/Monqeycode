const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

const MAX_AUDIO = 8 * 1024 * 1024;
function trusted(event, win, origin) {
  try { return !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
function validateAudio(audio, language) {
  if (typeof audio !== 'string' || !audio.length || audio.length % 4 || audio.length > Math.ceil(MAX_AUDIO / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || Buffer.from(audio, 'base64').toString('base64') !== audio) throw Error('Invalid or oversized recording.');
  if (!['nl', 'en', 'auto'].includes(language)) throw Error('Unsupported dictation language.');
  return { audio, language: language === 'auto' ? null : language };
}
class Dictation {
  constructor(home, workerFile, spawnWorker = spawn) { this.home = home; this.workerFile = workerFile; this.spawnWorker = spawnWorker; }
  paths() {
    const root = path.join(this.home, 'vendor', 'speech');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'));
    const python = path.resolve(root, manifest.python);
    if (!python.startsWith(root + path.sep) || !fs.existsSync(python)) throw Error('Invalid speech runtime.');
    return { python, site: path.join(root, 'site-packages'), model: path.join(this.home, 'storages', 'speech', 'base') };
  }
  status() { try { const p = this.paths(); return { available: fs.existsSync(path.join(p.model, 'model.bin')) }; } catch { return { available: false }; } }
  async request(fields) {
    if (this.pending) throw Error('Dictation is already processing.');
    if (!this.status().available) throw Error('Local speech is not installed. Run the speech setup first.');
    return new Promise((resolve, reject) => {
      const finish = (error, value) => { clearTimeout(this.timer); this.pending = null; error ? reject(error) : resolve(value); };
      this.pending = finish;
      this.timer = setTimeout(() => this.close('Speech recognition timed out. Try a shorter recording.'), 120000);
      if (!this.child) {
        const p = this.paths();
        const child = this.spawnWorker(p.python, ['-u', this.workerFile, p.model], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONPATH: p.site, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } });
        this.child = child;
        let tail = '';
        child.stderr.on('data', value => { tail = (tail + value.toString()).slice(-2000); });
        child.stdin.on('error', () => this.close('Speech worker stopped.'));
        createInterface({ input: child.stdout }).on('line', line => {
          if (this.child !== child) return;
          try {
            const result = JSON.parse(line);
            if (result.ready) { child.stdin.write(JSON.stringify(fields) + '\n'); return; }
            if (result.error) this.pending?.(Error('Could not transcribe this recording. Try again.'));
            else if (typeof result.text === 'string') this.pending?.(null, result.text.slice(0, 16000));
          } catch { this.close('Invalid speech worker response.'); }
        });
        child.on('error', () => { if (this.child === child) this.close('Could not start local speech recognition.'); });
        child.on('exit', () => { if (this.child === child) this.close(tail ? 'Local speech stopped. Run speech setup to repair the engine.' : 'Speech worker stopped.'); });
      } else this.child.stdin.write(JSON.stringify(fields) + '\n');
    });
  }
  close(message = 'Dictation cancelled.') {
    const child = this.child; this.child = null;
    child?.kill();
    this.pending?.(Error(message));
  }
}
function installDictation({ win, ipcMain, home, origin, workerFile }) {
  const engine = new Dictation(home, workerFile);
  ipcMain.handle('monqey-code:dictation', (event, command, audio, language) => {
    if (!trusted(event, win, new URL(origin).origin)) throw Error('Desktop window required.');
    if (command === 'status') return engine.status();
    if (command === 'transcribe') return engine.request(validateAudio(audio, language));
    if (command === 'cancel') { engine.close(); return; }
    throw Error('Unknown dictation action.');
  });
  const allowed = details => details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio';
  const clipboard = new Set(['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(details.requestingUrl).origin === new URL(origin).origin; } catch {}
    callback(contents === win.webContents && details.isMainFrame === true && sameOrigin && (clipboard.has(permission) || permission === 'media' && allowed(details)));
  });
  win.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    contents === win.webContents && requestingOrigin === new URL(origin).origin && details.isMainFrame === true && (clipboard.has(permission) || permission === 'media' && details.mediaType === 'audio'));
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) engine.close(); });
  return engine;
}
module.exports = { Dictation, installDictation, validateAudio, trusted };
