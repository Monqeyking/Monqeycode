import assert from 'node:assert/strict';
import { claimableCampaigns, getQoderCampaigns, claimQoderCampaign } from './lib/qoder-campaigns.js';

const valid = { campaignId: 'campaign-123', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE', startAt: 100, endAt: 200, benefit: { amount: 100 } };
const expected = [{ id: 'campaign-123', amount: 100, expiresAt: 200 }];
assert.deepEqual(claimableCampaigns({ campaigns: [valid] }, 150), expected);
assert.deepEqual(claimableCampaigns({ campaigns: [valid] }, 100), expected);
for (const patch of [
  { actionType: 'VIEW_DETAILS' }, { claimStatus: 'CLAIMED' },
  { startAt: 151 }, { endAt: 150 }, { startAt: undefined }, { endAt: '200' },
  { campaignId: '../claim' }, { campaignId: '' }
]) assert.deepEqual(claimableCampaigns({ claimable: true, campaigns: [{ ...valid, ...patch }] }, 150), []);
assert.throws(() => claimableCampaigns({ claimable: true }, 150), /invalid campaign list/);
process.env.MONQEY_QODER_CAMPAIGN_DIRECT_AUTH = '0';
assert.deepEqual(await getQoderCampaigns(), []);
await assert.rejects(claimQoderCampaign(valid.campaignId), /not enabled/);
console.log('Qoder rewards: claimability, windows, invalid IDs, and disabled direct-auth gate pass.');
