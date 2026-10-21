import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { TaskStore } from './lib/store.js';
import { defaults, emptyUsage, totalTokens } from './lib/manager.js';
import { taskSchema } from './lib/index.js';

test('atomic task index keeps 50 finished tasks, preserves total usage, validates paths and rejects corrupt state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monqey-worker-store-'));
  try {
    const store = new TaskStore(directory, taskSchema.array());
    const parentId = randomUUID();
    for (let i = 0; i < 53; i++) store.save({ id: randomUUID(), parentId, description: 'Read file', prompt: 'Read one file',
      status: 'completed', detail: '', output: 'Done', attempts: [], usage: { ...emptyUsage(), outputTokens: 10 },
      worker: defaults.worker, fallback: defaults.fallback, tokenLimit: 1000, outputLimit: 256, createdAt: i, updatedAt: i });
    assert.equal(store.read(parentId).length, 50);
    assert.equal(totalTokens(store.totalUsage(parentId)), 530);
    const record = store.read(parentId)[0];
    store.save({ ...record, detail: 'Updated' });
    assert.equal(totalTokens(store.totalUsage(parentId)), 530);
    assert.throws(() => store.read('../outside'), /Invalid parent/);
    fs.writeFileSync(store.file(parentId), '{');
    assert.throws(() => store.read(parentId), SyntaxError);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
