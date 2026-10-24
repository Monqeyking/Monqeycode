// Usage: node prepare-run.mjs <emptyOutputDir>
// Copies the starter project (and nothing of the grader or reference) into a fresh directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node prepare-run.mjs <outputDir>');
  process.exit(2);
}
if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
  console.error(`refusing to write into a non-empty directory: ${out}`);
  process.exit(2);
}
fs.cpSync(path.join(here, 'template'), out, { recursive: true });
console.log(out);
