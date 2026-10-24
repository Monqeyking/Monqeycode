// Mutation sanity check: each mutant of the reference must lose at least one A check.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mutants = {
  'no time sort': ['order.sort((a, b) => {', 'order.sort((a, b) => { return a.index - b.index;'],
  'half-up': ['if (remainder * 2 === den) return quotient + (quotient % 2);', 'if (remainder * 2 === den) return quotient + 1;'],
  'reapplied rate on refund': ['const giveAfter = divHalfEven(ref.credited * cumulative, ref.cents);', 'const giveAfter = ref.refundedGiveCents + divHalfEven(ref.credited * cents, ref.cents);'],
  'fee account without currency': ['`${FEES_ACCOUNT}:${payer.currency}`', 'FEES_ACCOUNT'],
  'limit ignores date': ["at.slice(0, 10)", "'x'"],
  'refund before transfer allowed': ['if (ref.at > at) fail', 'if (false) fail'],
  'dependsOn not remembered': ["store.putRecord(`batch:${batch.id}`, { fingerprint, report });\n        return report;", 'return report;'],
};
for (const [name, [from, to]] of Object.entries(mutants)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.cpSync(path.join(here, 'template'), dir, { recursive: true });
  fs.cpSync(path.join(here, 'reference'), dir, { recursive: true });
  const file = path.join(dir, 'src', 'batch.js');
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(from)) { console.log(`${name}: PATTERN NOT FOUND`); continue; }
  fs.writeFileSync(file, text.replace(from, to));
  const out = JSON.parse(spawnSync(process.execPath, [path.join(here, 'grader', 'grade.mjs'), dir, '--json'], { encoding: 'utf8' }).stdout);
  console.log(`${name}: A ${out.A.passed}/${out.A.total} -> ${out.A.passed < out.A.total ? 'caught' : 'MISSED'}`);
  fs.rmSync(dir, { recursive: true, force: true });
}
