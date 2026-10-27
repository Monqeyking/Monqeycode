const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const home = path.resolve(__dirname, '..');
const root = path.join(home, 'vendor', 'speech');
fs.mkdirSync(root, { recursive: true });
const uv = process.argv[2] || 'uv';
const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, 'python'), UV_CACHE_DIR: path.join(root, 'setup-cache'), UV_PYTHON_BIN_DIR: path.join(root, 'bin'), HF_HUB_DISABLE_TELEMETRY: '1' };
function run(file, args) { return execFileSync(file, args, { env, windowsHide: true, stdio: 'inherit' }); }
run(uv, ['python', 'install', '3.12.12', '--no-config']);
const install = fs.readdirSync(env.UV_PYTHON_INSTALL_DIR).find(name => name.startsWith('cpython-3.12.12-'));
if (!install) throw Error('Python installation missing.');
const python = path.join(env.UV_PYTHON_INSTALL_DIR, install, process.platform === 'win32' ? 'python.exe' : 'bin/python3');
// PyAV 19 removed metadata_errors, which this faster-whisper release still uses.
run(uv, ['pip', 'install', '--python', python, '--target', path.join(root, 'site-packages'), '--no-config', 'faster-whisper==1.2.1', 'av==16.0.1']);
env.PYTHONPATH = path.join(root, 'site-packages');
const model = path.join(home, 'storages', 'speech', 'base');
run(python, ['-c', 'from huggingface_hub import HfApi, snapshot_download; import sys; revision=HfApi().model_info("Systran/faster-whisper-base").sha; snapshot_download("Systran/faster-whisper-base", revision=revision, local_dir=sys.argv[1], allow_patterns=["config.json","model.bin","tokenizer.json","vocabulary.*"]); print("Downloaded model revision:",revision)', model]);
fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({ python: path.relative(root, python) }, null, 2));
const cache = path.resolve(env.UV_CACHE_DIR);
if (cache !== path.join(root, 'setup-cache')) throw Error('Unexpected setup cache path.');
fs.rmSync(cache, { recursive: true, force: true });
console.log('Local multilingual dictation installed. No microphone was opened.');
