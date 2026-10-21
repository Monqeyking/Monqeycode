const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolvePaths, repairRuntimeLinks } = require('./paths.cjs');

const paths = resolvePaths();
repairRuntimeLinks(paths);
const sdkRoot = path.join(paths.profile, 'node_modules', '@qoder-ai', 'qoder-agent-sdk');
const postinstall = path.join(sdkRoot, 'scripts', 'postinstall.cjs');
const bundledDir = path.join(sdkRoot, 'dist', '_bundled');
const cliNames = process.platform === 'win32' ? ['qoder.exe', 'qodercli.exe'] : ['qoder', 'qodercli'];

if (!existsSync(postinstall)) {
  throw new Error(`Qoder Agent SDK is missing at ${sdkRoot}. Install the web profile dependencies before building Monqey Agent.`);
}

if (cliNames.some((name) => existsSync(path.join(bundledDir, name)))) {
  console.log('[Monqey Agent] Bundled Qoder CLI is already present.');
  process.exit(0);
}

console.log('[Monqey Agent] Downloading the official Qoder CLI for the desktop build...');
const result = spawnSync(process.execPath, [postinstall], {
  cwd: sdkRoot,
  env: {
    ...process.env,
    QODER_INSTALL_BUNDLED_CLI: '1'
  },
  stdio: 'inherit'
});

if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`The Qoder CLI build dependency failed with exit code ${result.status ?? 'unknown'}.`);
