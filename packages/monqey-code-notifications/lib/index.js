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

const SettingsSchema = Schema.object({
  enabled: Schema.boolean().default(true),
  notifyOnCompletion: Schema.boolean().default(true),
  notifyOnQuestion: Schema.boolean().default(true),
  desktopNotifications: Schema.boolean().default(true)
});

export const name = 'monqey-code-notifications';
export const inject = ['settings'];

export function apply(ctx) {
  ctx.settings.register('notifications', SettingsSchema, { applies: 'live' });
}
