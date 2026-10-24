// Usage: node grade.mjs <runDir> [--json]
// Grades a finished run directory with evaluator-owned checks. Never modifies <runDir>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !fs.existsSync(runDir)) {
  console.error('usage: node grade.mjs <runDir> [--json]');
  process.exit(2);
}

function runHidden(dir, variant) {
  const child = spawnSync(process.execPath, [path.join(here, 'hidden.mjs'), dir, variant], { encoding: 'utf8', timeout: 90_000 });
  const line = (child.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
  try {
    return JSON.parse(line);
  } catch {
    return { loadError: `hidden run failed (${variant}): ${(child.stderr || child.error?.message || 'no output').slice(0, 200)}`, results: [] };
  }
}

const defaultRun = runHidden(runDir, 'default');

// Variant with different config constants, in a throwaway copy.
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'hard-bench-cfg-'));
fs.cpSync(runDir, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
const configFile = path.join(copy, 'src', 'config.js');
if (fs.existsSync(configFile)) {
  let text = fs.readFileSync(configFile, 'utf8');
  text = text.replace(/FEE_RATE_BPS\s*=\s*\d+/, 'FEE_RATE_BPS = 200').replace(/FEES_ACCOUNT\s*=\s*(['"])[^'"]*\1/, "FEES_ACCOUNT = 'sys:alt-fees'");
  fs.writeFileSync(configFile, text);
}
const cfgRun = runHidden(copy, 'cfg');
fs.rmSync(copy, { recursive: true, force: true });

const checks = [...defaultRun.results, ...cfgRun.results];

// B06: the agent added its own passing tests in test/batch.test.js.
const ownTests = path.join(runDir, 'test', 'batch.test.js');
let b06 = { id: 'B06 own tests exist and pass', group: 'B', ok: false, error: 'test/batch.test.js missing' };
if (fs.existsSync(ownTests)) {
  const text = fs.readFileSync(ownTests, 'utf8');
  const run = spawnSync(process.execPath, ['--test', 'test/batch.test.js'], { cwd: runDir, encoding: 'utf8', timeout: 90_000 });
  const ok = run.status === 0 && text.includes('node:test') && text.includes('applyBatch');
  b06 = { id: b06.id, group: 'B', ok, error: ok ? undefined : `exit ${run.status}; imports node:test and applyBatch: ${text.includes('node:test') && text.includes('applyBatch')}` };
}
checks.push(b06);

// Group S: static convention checks on the source. They do not depend on batch behaviour working end to end.
const readIf = (rel) => { const file = path.join(runDir, rel); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; };
const batchSource = readIf('src/batch.js');
const errorsSource = readIf('src/errors.js');
const requiredCodes = ['AMOUNT_INVALID', 'UNKNOWN_ACCOUNT', 'INSUFFICIENT_FUNDS', 'DUPLICATE_ENTRY', 'REF_INVALID', 'REFUND_EXCEEDS', 'ENTRY_TYPE_INVALID',
  'AT_INVALID', 'RATE_UNAVAILABLE', 'LIMIT_EXCEEDED', 'IDEMPOTENCY_CONFLICT', 'DEPENDENCY_UNMET', 'STORE_FAILURE', 'BATCH_INVALID'];
const usedCodes = [...batchSource.matchAll(/['"`]([A-Z][A-Z0-9]*_[A-Z0-9_]+)['"`]/g)].map((match) => match[1]);
const missingCodes = [...new Set([...requiredCodes, ...usedCodes])].filter((code) => !new RegExp(`['"\`]${code}['"\`]`).test(errorsSource));
const staticChecks = [
  { id: 'S01 balances formatted with formatCents', ok: /\bformatCents\b/.test(batchSource), error: 'src/batch.js does not use formatCents' },
  { id: 'S02 fee rate and fees account come from config', ok: /\bFEE_RATE_BPS\b/.test(batchSource) && /\bFEES_ACCOUNT\b/.test(batchSource) && !/sys:fees/.test(batchSource) && !/\b150\b/.test(batchSource), error: 'config constants unused, or literal fee values present' },
  { id: 'S03 every error code is registered in ERROR_CODES', ok: missingCodes.length === 0, error: `missing: ${missingCodes.join(', ')}` },
];
checks.push(...staticChecks.map((item) => ({ ...item, group: 'S', error: item.ok ? undefined : item.error })));
checks.push({ id: 'S04 own batch tests exist and pass', group: 'S', ok: b06.ok, error: b06.error });

const regressionRun =spawnSync(process.execPath, ['--test', 'test/existing.test.js'], { cwd: runDir, encoding: 'utf8', timeout: 90_000 });
const regressionOk = regressionRun.status === 0;

const tally = (group) => {
  const list = checks.filter((item) => item.group === group);
  return { passed: list.filter((item) => item.ok).length, total: list.length };
};
const summary = {
  runDir,
  loadError: defaultRun.loadError ?? null,
  A: tally('A'),
  B: tally('B'),
  S: tally('S'),
  existingTestsPass: regressionOk,
  failed: checks.filter((item) => !item.ok).map((item) => `${item.id}${item.error ? ` — ${item.error}` : ''}`),
};
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...summary, checks }, null, 2));
} else {
  console.log(`A (stated requirements): ${summary.A.passed}/${summary.A.total}`);
  console.log(`B (project conventions): ${summary.B.passed}/${summary.B.total}`);
  console.log(`S (static conventions):  ${summary.S.passed}/${summary.S.total}`);
  console.log(`existing tests pass:    ${summary.existingTestsPass}`);
  if (summary.loadError) console.log(`load error: ${summary.loadError}`);
  for (const line of summary.failed) console.log(`  FAIL ${line}`);
}
