import assert from 'node:assert/strict';
import { qoderToolCallText, qoderToolsPrompt, qoderSafeLength, qoderParseToolCalls } from './lib/qoder-tools.js';

const tools = [{ name: 'web_fetch', description: 'Fetch a page', parameters: { type: 'object' } }];
assert.equal(qoderToolsPrompt([]), '');
assert.match(qoderToolsPrompt(tools), /web_fetch: Fetch a page/);

assert.equal(qoderSafeLength('hello'), 5);
assert.equal(qoderSafeLength('hello <tool'), 6, 'partial tag is held back');
assert.equal(qoderSafeLength('hello <tool_call>{"na'), 6, 'whole tag start is held back');
assert.equal(qoderSafeLength('1 < 2'), 5, 'plain angle bracket is not held back');

const call = qoderToolCallText('web_fetch', { url: 'https://example.com' });
const parsed = qoderParseToolCalls(`Ik haal het op.\n${call}`, new Set(['web_fetch']));
assert.deepEqual(parsed.calls, [{ name: 'web_fetch', arguments: { url: 'https://example.com' } }]);
assert.equal(parsed.text.trim(), 'Ik haal het op.');

assert.deepEqual(qoderParseToolCalls(call, new Set(['other'])).calls, [], 'unknown tool stays text');
assert.deepEqual(qoderParseToolCalls('<tool_call>{broken</tool_call>', new Set(['web_fetch'])).calls, [], 'invalid JSON stays text');
console.log('Qoder tools: prompt, hold-back and call parsing pass.');
