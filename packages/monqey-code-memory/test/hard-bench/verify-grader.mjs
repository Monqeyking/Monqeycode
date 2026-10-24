// Sanity check of the grader: the starter must fail the batch checks, the reference must pass all of them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const grade = (dir) => JSON.parse(spawnSync(process.execPath, [path.join(here, 'grader', 'grade.mjs'), dir, '--json'], { encoding: 'utf8' }).stdout);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-bench-verify-'));

const starter = path.join(tmp, 'starter');
fs.cpSync(path.join(here, 'template'), starter, { recursive: true });
const before = grade(starter);
console.log('starter  ', JSON.stringify({ A: before.A, B: before.B, existing: before.existingTestsPass }));
assert.equal(before.A.passed, 0);
assert.equal(before.B.passed, 0);
assert.equal(before.S.passed, 0);
assert.equal(before.existingTestsPass, true);

const solved = path.join(tmp, 'reference');
fs.cpSync(path.join(here, 'template'), solved, { recursive: true });
fs.cpSync(path.join(here, 'reference'), solved, { recursive: true });
const after = grade(solved);
console.log('reference', JSON.stringify({ A: after.A, B: after.B, existing: after.existingTestsPass }));
for (const line of after.failed) console.log('  FAIL', line);
assert.equal(after.A.passed, after.A.total);
assert.equal(after.B.passed, after.B.total);
assert.equal(after.S.passed, after.S.total);
assert.equal(after.existingTestsPass, true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('grader verified');
