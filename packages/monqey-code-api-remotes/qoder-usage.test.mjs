import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TYPERT } from '../../profiles/web/node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js';

let client;
vm.runInNewContext(readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(module) { client = module.factory(() => {}); } } },
  TextEncoder, TextDecoder, URL, AbortController, console
});
const mounted = [];
const dispose = await client.apply({ remote: { async $mount(contribution) {
  mounted.push(...contribution.descriptors);
  return () => {};
} } });
const host = TYPERT.invocations.find(item => item.method === 'getQoderUsage');
const remote = mounted.find(item => item.method === 'getQoderUsage');
assert.ok(host, 'Host must publish Qoder usage');
assert.ok(remote, 'Browser must mount Qoder usage');
assert.equal(host.id, remote.id);
assert.equal(host.cancellation.parameter, remote.cancellation.parameter);
const fixture = {
  planType: 'Free', userQuota: { total: 500, used: 300, remaining: 200, percentage: 60, unit: 'credits' },
  addOnQuota: null, orgResourcePackage: null, detailUrl: null,
  totalUsagePercentage: 60, isQuotaExceeded: false,
  campaigns: [{ id: 'campaign-123', amount: 100, expiresAt: 200 }]
};
assert.deepEqual(JSON.parse(JSON.stringify(remote.result.schema.parse(host.result.schema.parse(fixture)))), fixture);
assert.equal(remote.result.schema.safeParse({ ...fixture, isQuotaExceeded: 'yes' }).success, false);
const claimHost = TYPERT.invocations.find(item => item.method === 'claimQoderReward');
const claimRemote = mounted.find(item => item.method === 'claimQoderReward');
assert.equal(claimHost.id, claimRemote.id);
assert.equal(claimRemote.parameters[0].wire, 'id');
assert.equal(claimRemote.result.schema.parse({ claimed: true, alreadyClaimed: false }).claimed, true);
await dispose();
console.log('Qoder usage: browser mount, host registration, matching schemas and validation pass.');
