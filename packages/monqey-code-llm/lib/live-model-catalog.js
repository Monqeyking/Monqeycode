import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

function validModels(models) {
  if (!Array.isArray(models) || models.length === 0 || models.length > 10000) throw new Error('Provider returned an empty or oversized model catalog.');
  const seen = new Set();
  return models.map(model => {
    if (!model || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 500 || seen.has(model.id)) throw new Error('Provider returned an invalid model catalog.');
    seen.add(model.id);
    return structuredClone(model);
  });
}

// Catalog metadata is public model information. Credentials never enter a cache
// record; the filename hashes the owning route/configuration, not a model name.
export class LiveModelCatalog {
  constructor(provider, scope, { home = process.env.DSH_HOME, ttl = 300000 } = {}) {
    this.provider = provider;
    this.ttl = ttl;
    this.models = [];
    this.lastSuccess = 0;
    this.lastAttempt = 0;
    this.error = false;
    this.pending = null;
    if (home) {
      const key = createHash('sha256').update(JSON.stringify([provider, scope])).digest('hex');
      this.file = path.join(home, 'storages', 'model-catalogs', `${key}.json`);
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.models = validModels(saved.models);
        this.lastSuccess = Number.isFinite(saved.lastSuccess) ? saved.lastSuccess : 0;
      } catch {}
    }
  }
  async refresh(load, { force = false, signal } = {}) {
    signal?.throwIfAborted();
    if (this.pending) return this.pending;
    // A disk snapshot is a fallback, never proof of a refresh in this process.
    if (!force && this.lastAttempt && Date.now() - this.lastAttempt < (this.error ? 30000 : this.ttl)) return this.models;
    this.lastAttempt = Date.now();
    this.pending = (async () => {
      try {
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
        const models = validModels(await Promise.resolve().then(() => load(requestSignal)));
        requestSignal.throwIfAborted();
        this.models = models;
        this.lastSuccess = Date.now();
        this.error = false;
        if (this.file) {
          const temporary = `${this.file}.${randomUUID()}.tmp`;
          try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify({ models, lastSuccess: this.lastSuccess }));
            fs.renameSync(temporary, this.file);
          } catch { try { fs.unlinkSync(temporary); } catch {} }
        }
      } catch (error) {
        this.error = true;
        if (signal?.aborted) throw error;
        if (!this.models.length) throw error;
      } finally { this.pending = null; }
      return this.models;
    })();
    return this.pending;
  }
  status() {
    return { lastSuccess: this.lastSuccess || null, state: this.pending ? 'refreshing' : this.error ? this.models.length ? 'cached' : 'unavailable' : this.lastAttempt ? 'ready' : 'pending' };
  }
}

export async function fetchOpenAIModels(baseURL, apiKey, signal, headers = {}) {
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  const response = await fetch(url, { headers: { ...headers, accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal, redirect: 'error' });
  if (!response.ok) throw new Error(`Model catalog returned HTTP ${response.status}.`);
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Model catalog response was too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return validModels(body.data).map(model => ({ id: model.id, name: typeof model.name === 'string' && model.name ? model.name : model.id,
    ...(Number.isSafeInteger(model.context_window) && model.context_window > 0 ? { contextWindow: model.context_window } : {}) }));
}

export function installDeepSeekLiveCatalog(adapter, headers = {}) {
  if (!adapter.config?.options || !adapter.config?.resolveApiKey || adapter.refreshModelCatalog) return;
  const options = adapter.config.options;
  const list = adapter.listModels.bind(adapter);
  const prepare = adapter.prepareCall.bind(adapter);
  let connection;
  let cache;
  let routeKey;
  const current = () => {
    const next = options();
    const key = JSON.stringify([next.baseURL, next.apiKeyEnv]);
    if (key !== routeKey) {
      routeKey = key;
      cache = new LiveModelCatalog('deepseek-official', [next.baseURL, next.apiKeyEnv]);
    }
    connection = next;
    return connection;
  };
  adapter.config.options = () => {
    const original = current();
    const models = new Map(original.models.map(model => [model.id, model]));
    for (const model of cache.models) models.set(model.id, { ...model, ...models.get(model.id) });
    return { ...original, models: [...models.values()] };
  };
  adapter.refreshModelCatalog = async (_provider, request = {}) => {
    const original = current();
    await cache.refresh(async signal => fetchOpenAIModels(original.baseURL, await adapter.config.resolveApiKey(original), signal, headers), request);
  };
  adapter.modelCatalogStatus = () => {
    const original = current();
    const status = cache.status();
    return status.state === 'unavailable' && original.models.length ? { ...status, state: 'cached' } : status;
  };
  adapter.listModels = async provider => {
    try { await adapter.refreshModelCatalog(provider); } catch {}
    return list(provider);
  };
  adapter.prepareCall = async (provider, model, signal) => {
    try { await adapter.refreshModelCatalog(provider, { signal }); } catch (error) { if (signal?.aborted) throw error; }
    return prepare(provider, model, signal);
  };
}
