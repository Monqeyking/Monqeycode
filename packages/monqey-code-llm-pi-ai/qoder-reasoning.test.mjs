import assert from 'node:assert/strict';
import { qoderReasoning, qoderModelPolicy } from './lib/qoder-reasoning.js';
import { getSupportedThinkingLevels } from '../../profiles/node_modules/@earendil-works/pi-ai/dist/models.js';

assert.deepEqual(getSupportedThinkingLevels(qoderReasoning({ efforts: ['high', 'low', 'unsupported'] })), ['low', 'high']);
assert.deepEqual(getSupportedThinkingLevels(qoderReasoning({ thinking_config: { disabled: {}, enabled: { efforts: { medium: {} } } } })), ['off', 'medium']);
assert.equal(qoderReasoning({ isReasoning: true }).reasoning, false);
for (const effort of ['off', 'low', 'medium', 'high', 'max']) {
  assert.deepEqual(qoderModelPolicy('qwen-flash-next', effort)(), {
    model: 'qwen-flash-next', parameters: { reasoningEffort: effort }
  });
}
console.log('Qoder reasoning: catalog capabilities and SDK model policy pass.');
