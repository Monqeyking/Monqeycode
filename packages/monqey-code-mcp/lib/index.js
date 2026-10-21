import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

function resolveProfilePackage(name) {
  const roots = [
    process.cwd(),
    process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles'),
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web')
  ];
  for (const root of roots) {
    try {
      return createRequire(path.join(root, 'package.json')).resolve(name);
    } catch {}
  }
  throw new Error(`Unable to resolve ${name} from the active DeepSeek profile`);
}

const Schema = (await import(pathToFileURL(resolveProfilePackage('@deepseek-ai/schemastery')).href)).default;
const { apply: applyMcpClient } = await import(pathToFileURL(resolveProfilePackage('@deepseek-ai/dsh-mcp-client')).href);
const { nativeFileManager, openNativePath, revealNativePath } = await import(pathToFileURL(resolveProfilePackage('@deepseek-ai/dsh-native-command')).href);

const PRESENT_HOST_ROUTE = '/api/present.host';
const PRESENT_OPEN_ROUTE = '/api/present.open';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function rejectUnauthenticated(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

function parsePresentedRequest(req) {
  const query = new URL(String(req.url), 'http://localhost').searchParams;
  const sessionId = query.get('sessionId');
  const seq = Number(query.get('seq'));
  const index = Number(query.get('index'));
  if (!sessionId || sessionId.length > 256 || !Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(index) || index < 0) {
    return undefined;
  }
  return { sessionId, seq, index };
}

async function resolvePresentedFile(ctx, request, signal) {
  let observed;
  try {
    observed = await ctx.sessionQuery.readSession(request.sessionId);
  } catch {
    return undefined;
  }
  const event = observed.events.find((candidate) => candidate.seq === request.seq && candidate.type === 'deliverables/presented');
  const file = event?.data?.files?.[request.index];
  if (!event || typeof file?.path !== 'string' || file.path.trim() === '' || typeof observed.session?.cwd !== 'string') {
    return undefined;
  }
  try {
    const target = await ctx.fs.resolve(file.path, { cwd: observed.session.cwd, signal });
    const info = await ctx.fs.stat(target, signal);
    if (info?.type !== 'file') return undefined;
    const processPath = typeof ctx.fs.processPath === 'function' ? ctx.fs.processPath(target) : target.displayPath;
    return typeof processPath === 'string' && processPath.length > 0 && path.isAbsolute(processPath) ? processPath : undefined;
  } catch {
    return undefined;
  }
}

const ServerSchema = Schema.object({
  serverName: Schema.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/),
  enabled: Schema.boolean().default(false),
  transport: Schema.union([
    Schema.const('stdio'),
    Schema.const('streamable-http')
  ]).default('stdio'),
  command: Schema.string().default(''),
  args: Schema.array(Schema.string()).default([]),
  cwd: Schema.string().default(''),
  url: Schema.string().default(''),
  toolCallTimeoutMs: Schema.number().min(1).max(600000).default(60000)
});

const SettingsSchema = Schema.object({
  servers: Schema.array(ServerSchema).default([])
});

const SecretServerSchema = Schema.object({
  env: Schema.dict(Schema.string()).role('secret').default({}),
  headers: Schema.dict(Schema.string()).role('secret').default({})
});

const SecretsSchema = Schema.object({
  servers: Schema.dict(SecretServerSchema).default({})
});

function validateSettings(value) {
  const names = new Set();
  for (const server of value.servers) {
    if (names.has(server.serverName)) throw new Error(`Duplicate MCP server name: ${server.serverName}`);
    names.add(server.serverName);
    if (server.enabled && server.transport === 'stdio' && !server.command.trim()) {
      throw new Error(`MCP server ${server.serverName} needs a command`);
    }
    if (server.enabled && server.transport === 'streamable-http' && !server.url.trim()) {
      throw new Error(`MCP server ${server.serverName} needs a URL`);
    }
  }
}

function toClientConfig(server, secrets = {}) {
  const common = {
    serverName: server.serverName,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: false,
    reconnect: { enabled: true }
  };
  if (server.transport === 'stdio') {
    return {
      ...common,
      transport: 'stdio',
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: secrets.env ?? {}
    };
  }
  return {
    ...common,
    transport: 'streamable-http',
    url: server.url,
    headers: secrets.headers ?? {}
  };
}

function fingerprint(config) {
  return JSON.stringify(config);
}

export const name = 'monqey-code-mcp';
export const inject = ['settings', 'tools', 'webServer', 'connection', 'sessionQuery', 'fs'];

export async function apply(ctx) {
  const fileManager = nativeFileManager();
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENT_HOST_ROUTE,
    handler: async (req, res) => {
      if (rejectUnauthenticated(ctx, req, res)) return;
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('allow', 'GET');
        res.end();
        return;
      }
      sendJson(res, 200, {
        name: 'Monqey Agent',
        available: fileManager !== null,
        fileManager
      });
    }
  }), `monqey-code-mcp: GET ${PRESENT_HOST_ROUTE}`);

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRESENT_OPEN_ROUTE,
    handler: async (req, res) => {
      if (rejectUnauthenticated(ctx, req, res)) return;
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.setHeader('allow', 'POST');
        res.end();
        return;
      }
      const request = parsePresentedRequest(req);
      if (request === undefined) {
        sendJson(res, 400, { code: 'bad-request', message: 'invalid presented-file coordinates' });
        return;
      }
      if (fileManager === null) {
        sendJson(res, 422, { code: 'native-unavailable', message: 'this platform has no supported file manager' });
        return;
      }
      const controller = new AbortController();
      try {
        const target = await resolvePresentedFile(ctx, request, controller.signal);
        if (target === undefined) {
          sendJson(res, 404, { code: 'not-found', message: 'presented file is no longer available' });
          return;
        }
        const action = new URL(String(req.url), 'http://localhost').searchParams.get('action');
        if (action === 'reveal') await revealNativePath(target, controller.signal);
        else await openNativePath(target, controller.signal);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        ctx.logger.warn(`presented file action failed: ${String(error)}`);
        sendJson(res, 502, { code: 'native-action-failed', message: 'could not open the presented file' });
      } finally {
        controller.abort();
      }
    }
  }), `monqey-code-mcp: POST ${PRESENT_OPEN_ROUTE}`);

  const settings = ctx.settings.register('mcp', SettingsSchema, {
    applies: 'live',
    validate: validateSettings
  });
  const secrets = ctx.settings.register('mcp-secrets', SecretsSchema, { applies: 'live' });
  const live = new Map();
  let queue = Promise.resolve();

  async function stop(serverName) {
    const record = live.get(serverName);
    if (!record) return;
    live.delete(serverName);
    await record.fiber.dispose();
  }

  async function reconcile(value, secretValue) {
    const wanted = new Map(value.servers.filter((server) => server.enabled).map((server) => [server.serverName, server]));
    for (const serverName of live.keys()) {
      const server = wanted.get(serverName);
      const nextFingerprint = server ? fingerprint(toClientConfig(server, secretValue.servers[serverName])) : '';
      if (!server || live.get(serverName).fingerprint !== nextFingerprint) await stop(serverName);
    }
    for (const [serverName, server] of wanted) {
      if (live.has(serverName)) continue;
      try {
        const fiber = ctx.plugin(applyMcpClient, toClientConfig(server, secretValue.servers[serverName]));
        await fiber.await();
        live.set(serverName, { fiber, fingerprint: fingerprint(toClientConfig(server, secretValue.servers[serverName])) });
        ctx.logger.info(`MCP server connected: ${serverName}`);
      } catch (error) {
        ctx.logger.error(`MCP server failed: ${serverName}: ${String(error)}`);
      }
    }
  }

  function schedule(value, secretValue) {
    queue = queue.then(() => reconcile(value, secretValue)).catch((error) => {
      ctx.logger.error(`MCP settings update failed: ${String(error)}`);
    });
    return queue;
  }

  const current = () => ({ value: settings.get(), secretValue: secrets.get() });
  const onChange = () => {
    const next = current();
    return schedule(next.value, next.secretValue);
  };
  const unwatch = settings.watch(onChange);
  const unwatchSecrets = secrets.watch(onChange);
  ctx.effect(() => async () => {
    unwatch();
    unwatchSecrets();
    await schedule({ servers: [] }, { servers: {} });
  }, 'monqey-code-mcp: connections');
  const initial = current();
  await schedule(initial.value, initial.secretValue);
}
