import { readFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

let authWasm;
async function directAuthEnabled() {
  const override = process.env.MONQEY_QODER_CAMPAIGN_DIRECT_AUTH;
  if (override !== undefined) return override === '1';
  try {
    const path = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qoder-campaigns.json');
    return JSON.parse(await readFile(path, 'utf8')).directAuthEnabled === true;
  } catch { return false; }
}
async function localLogin() {
  const root = join(homedir(), '.qoder');
  if (!authWasm) {
    const require = createRequire(import.meta.url);
    let entry;
    try { entry = require.resolve('@qoder-ai/qoder-agent-sdk'); }
    catch { entry = createRequire(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'web', 'package.json')).resolve('@qoder-ai/qoder-agent-sdk'); }
    const runtime = process.env.MONQEY_QODER_WORKER_RUNTIME_PATH || join(entry, '..', '_worker', 'qoder-worker-runtime.obf.mjs');
    const source = await readFile(runtime, 'utf8');
    // shortcut: SDK 1.0.53 embeds its credential WASM; fail closed if its layout changes.
    const wasm = source.match(/eac="(AGFzbQ[A-Za-z0-9+/=]+)"/);
    const start = source.indexOf('Foi={};function ');
    const end = source.indexOf(',Loi=F(', start);
    if (!wasm || start < 0 || end < 0) throw new Error('This Qoder SDK cannot read campaign login credentials.');
    const glueSource = source.slice(start, end).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(runtime).href));
    const glue = runInNewContext('const S=f=>f; const sn=(o,e)=>{for(const k in e)Object.defineProperty(o,k,{get:e[k]})};const _$d=(s,k="bUCB6W2QRuuJ")=>{const b=Buffer.from(s,"base64");for(let i=0;i<b.length;i++)b[i]^=k.charCodeAt(i%k.length);return b.toString()};var ' + glueSource + ';Uoi();Foi.initializeBytes=bytes=>Foi.default({module_or_path:bytes});Foi', { Buffer, TextDecoder, TextEncoder, WebAssembly, console, URL, Request, Response, fetch });
    // The initializer checks its own realm's Object prototype.
    await glue.initializeBytes(Buffer.from(wasm[1], 'base64'));
    authWasm = glue;
  }
  const machine = (await readFile(join(root, '.auth', 'machine_id'), 'utf8')).trim();
  const encrypted = (await readFile(join(root, '.auth', 'user'), 'utf8')).trim();
  const user = JSON.parse(authWasm.credential_storage_decrypt(encrypted, machine.slice(0, 16)));
  return { root, machine, user };
}

export function claimableCampaigns(body, now = Date.now() / 1000) {
  if (!Array.isArray(body?.campaigns)) throw new Error('Qoder returned an invalid campaign list.');
  return body.campaigns.filter(c => typeof c?.campaignId === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(c.campaignId)
    && c.actionType === 'CLAIM_BENEFIT' && c.claimStatus === 'CLAIMABLE'
    && Number.isFinite(c.startAt) && Number.isFinite(c.endAt) && c.startAt <= now && now < c.endAt)
    .map(c => ({ id: c.campaignId, amount: typeof c.benefit?.amount === 'number' ? c.benefit.amount : null, expiresAt: c.endAt }));
}

async function campaignSession(signal) {
  const { root, machine, user } = await localLogin();
  if (typeof user.access_token !== 'string' || !user.access_token) throw new Error('Sign in to Qoder before checking rewards.');
  const headers = { Accept: 'application/json', Authorization: `Bearer ${user.access_token}`, 'User-Agent': 'Qoder',
    'Cosy-ClientType': '10', 'Cosy-Version': '0.4.3', 'Cosy-MachineId': machine };
  try {
    const identity = JSON.parse(await readFile(join(root, 'umid-cache.json'), 'utf8'));
    if (identity.platform === process.platform && identity.arch === process.arch
      && ['machineToken', 'machineType', 'machineCode'].every(key => typeof identity.info?.[key] === 'string' && identity.info[key])) {
      headers['Cosy-MachineToken'] = identity.info.machineToken;
      headers['Cosy-MachineType'] = identity.info.machineType;
      headers['Cosy-MachineCode'] = identity.info.machineCode;
      headers['Cosy-MachineOS'] = process.platform;
      headers['Cosy-MachineHostname'] = hostname();
    }
  } catch { /* Qoder can return a narrower catalog without desktop identity. */ }
  return async (suffix = '', method = 'GET') => {
    const response = await fetch(`https://openapi.qoder.sh/sash/api/v1/me/campaigns${suffix}`, {
      method, headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      ...(method === 'POST' ? { body: '{}', headers: { ...headers, 'Content-Type': 'application/json' } } : {})
    });
    if (!response.ok) throw new Error(`Qoder rewards returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Qoder reward response is too large.');
    return JSON.parse(text);
  };
}

export async function getQoderCampaigns(signal) {
  if (!await directAuthEnabled()) return [];
  const request = await campaignSession(signal);
  return claimableCampaigns(await request());
}

const pending = new Set();
export async function claimQoderCampaign(id, signal) {
  if (!await directAuthEnabled()) throw new Error('Direct Qoder campaign authentication is not enabled.');
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(id)) throw new Error('Invalid Qoder campaign.');
  if (pending.has(id)) throw new Error('This reward is already being claimed.');
  pending.add(id);
  try {
    const request = await campaignSession(signal);
    if (!claimableCampaigns(await request()).some(c => c.id === id)) throw new Error('This Qoder reward is no longer claimable.');
    const result = await request(`/${encodeURIComponent(id)}/claim`, 'POST');
    if (result.status !== 'CLAIMED') throw new Error('Qoder did not confirm the reward. Refresh and try again.');
    return { claimed: true, alreadyClaimed: result.replayed === true };
  } finally { pending.delete(id); }
}
