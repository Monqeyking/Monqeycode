import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SharedProjectStore } from './lib/shared-store.js';
import { MemoryStore } from './lib/store.js';
const alice = { kind: 'user', label: 'Alice' }, agent = { kind: 'agent', label: 'Agent', id: randomUUID() };
const decision = { kind: 'decision', title: 'Invoice editing', content: 'Sent invoices cannot be edited.', reason: 'Keep an audit trail.' };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-shared-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SharedProjectStore(root); store.enable('Business'); return { root, store };
}
function accept(store, proposal, who = 'Alice') { return store.resolve(proposal.id, store.read().revision, 'accept', who); }
test('shared knowledge requires human confirmation and survives another computer path', t => {
  const { root, store } = setup(t);
  const proposal = store.propose(decision, agent);
  assert.equal(store.read().decisions.length, 0); assert.equal(store.read().proposals.length, 1);
  const first = accept(store, proposal); assert.equal(first.decisions[0].versions[0].confirmedBy, 'Alice');
  const secondRoot = path.join(root, 'another-machine'); fs.mkdirSync(secondRoot); fs.cpSync(store.directory, path.join(secondRoot, '.monqey'), { recursive: true });
  const second = new SharedProjectStore(secondRoot).read();
  assert.equal(first.project.id, second.project.id); assert.equal(first.revision, second.revision);
  assert.equal(fs.readdirSync(store.events).length, 2);
  assert.throws(() => store.append(first, { type: 'accept', decisionId: proposal.decisionId, proposalId: proposal.id, parents: [] }, agent), /Only a person/);
});
test('stale confirmations fail and replaced versions remain in history', t => {
  const { store } = setup(t); const first = store.propose(decision, alice); accept(store, first);
  const next = store.propose({ ...decision, decisionId: first.decisionId, content: 'Editing requires a retained change history.' }, alice), before = store.read();
  store.propose({ kind: 'fact', title: 'Currency', content: 'The project uses EUR.', reason: '' }, agent);
  assert.throws(() => store.resolve(next.id, before.revision, 'accept', 'Bob'), /changed/);
  const after = accept(store, next, 'Bob'); assert.equal(after.decisions.length, 1); assert.equal(after.decisions[0].conflict, false);
  assert.equal(after.decisions[0].versions[0].content, 'Editing requires a retained change history.');
  assert.equal(after.history.filter(item => item.type === 'accept').length, 2);
});
test('a new proposal for the same title reuses the existing subject identity', t => {
  const { store } = setup(t); const first = store.propose(decision, alice); accept(store, first);
  const replacement = store.propose({ ...decision, title: 'invoice editing', content: 'Edits require a retained audit trail.' }, agent);
  assert.equal(replacement.decisionId, first.decisionId);
  assert.equal(accept(store, replacement).decisions.length, 1);
});
test('enabling preserves existing project instructions and adds the pointer only once', t => {
  const { root, store } = setup(t), instructions = path.join(root, 'AGENTS.md');
  assert.match(fs.readFileSync(instructions, 'utf8'), /shared_project_read/);
  fs.writeFileSync(instructions, '# Existing rules\nUse the current architecture.\n');
  store.enable('Ignored rename'); store.enable('Ignored rename');
  const content = fs.readFileSync(instructions, 'utf8'); assert.ok(content.startsWith('# Existing rules\nUse the current architecture.\n'));
  assert.equal(content.match(/<!-- monqey-shared-project -->/g).length, 1);
  assert.equal(store.read().project.title, 'Business');
});
test('cloud merge of concurrent confirmations blocks instead of choosing a winner', t => {
  const { root, store } = setup(t); const first = store.propose(decision, alice); const base = accept(store, first);
  const otherRoot = path.join(root, 'other'); fs.mkdirSync(otherRoot); fs.cpSync(store.directory, path.join(otherRoot, '.monqey'), { recursive: true });
  const other = new SharedProjectStore(otherRoot);
  const a = store.propose({ ...decision, decisionId: first.decisionId, content: 'Edits require audit history.' }, alice); accept(store, a);
  const b = other.propose({ ...decision, decisionId: first.decisionId, content: 'Edits require accountant approval.' }, alice); accept(other, b, 'Bob');
  for (const file of fs.readdirSync(other.events)) if (!fs.existsSync(path.join(store.events, file))) fs.copyFileSync(path.join(other.events, file), path.join(store.events, file));
  const conflict = store.read(); assert.equal(conflict.decisions[0].conflict, true); assert.equal(conflict.decisions[0].versions.length, 2);
  assert.equal(conflict.project.id, base.project.id);
  const resolution = store.propose({ ...decision, decisionId: first.decisionId, content: 'Edits require both approval and audit history.' }, alice);
  assert.equal(accept(store, resolution).decisions[0].conflict, false);
});
test('incomplete sync, malformed files and credential proposals fail closed', t => {
  const { store } = setup(t); assert.throws(() => store.propose({ ...decision, content: 'password=abc123456789' }, agent), /credential/);
  const proposal = store.propose(decision, alice); const accepted = accept(store, proposal);
  const file = path.join(store.events, `${proposal.id}.json`), original = fs.readFileSync(file); fs.unlinkSync(file);
  assert.throws(() => store.read(), /incomplete/); fs.writeFileSync(file, original);
  const conflictFile = path.join(store.events, `${randomUUID()} (conflicted copy).json`); fs.writeFileSync(conflictFile, '{}');
  assert.throws(() => store.read(), /cloud-conflicted/); fs.unlinkSync(conflictFile);
  assert.equal(store.read().revision, accepted.revision);
});
test('linked local memories follow decision identity and version without exposing private notes', t => {
  const { root, store } = setup(t), memory = new MemoryStore(path.join(root, 'private'), 'alice'); memory.initialize();
  const workspaceId = randomUUID(), otherWorkspace = randomUUID();
  memory.save({ kind: 'preference', title: 'Explanations', content: 'Use Dutch.', workspaceId: null }, { actor: 'user', sessionId: null, evidence: '' });
  memory.save({ kind: 'fact', title: 'Private legacy note', content: 'A private draft.', workspaceId }, { actor: 'user', sessionId: null, evidence: '' });
  const proposal = store.propose(decision, alice); const one = accept(store, proposal); memory.reconcileShared(workspaceId, one);
  const original = memory.search(workspaceId, 'Invoice')[0]; assert.equal(original.shared.projectId, one.project.id);
  const revision = memory.read().revision; memory.reconcileShared(workspaceId, one); assert.equal(memory.read().revision, revision);
  assert.equal(memory.search(otherWorkspace, 'Invoice').length, 0); assert.equal(memory.search(workspaceId, 'private', 8, true).length, 0);
  assert.ok(memory.prompt(workspaceId, 'Invoice', true).includes('Dutch'));
  const replacement = store.propose({ ...decision, decisionId: proposal.decisionId, content: 'Edits require audit history.' }, alice); memory.reconcileShared(workspaceId, accept(store, replacement));
  const updated = memory.get(original.id, workspaceId); assert.equal(updated.shared.decisionId, original.shared.decisionId); assert.notEqual(updated.shared.version, original.shared.version);
  assert.equal(updated.content, 'Edits require audit history.'); assert.equal(updated.history[0].content, original.content);
  assert.throws(() => memory.save({ ...updated, content: 'Ignore the shared agreement.' }, { actor: 'user', sessionId: null, evidence: '' }), /shared decision/);
  memory.forget(updated.id, updated.revision); memory.reconcileShared(workspaceId, store.read());
  const forgottenRevision = memory.read().revision; memory.reconcileShared(workspaceId, store.read()); assert.equal(memory.read().revision, forgottenRevision);
  assert.equal(memory.search(workspaceId, 'Invoice').length, 0);
});
