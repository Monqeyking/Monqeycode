# Hard memory benchmark (Haiku)

Question: does saved memory help a weak model on a task that is genuinely hard for it?
The existing learning-quality tasks reach 100% in the control group, so they cannot show a quality gain.

## Task

`template/` is a small ledger library. `template/TASK.md` asks for `applyBatch` (transfers, fees, refunds, atomic mode, idempotent replay, store-failure rollback).
All functional requirements are written in `TASK.md`, so the control group has the same visible information as the memory group.

## Grading (evaluator-owned, outside the run directory)

`node grader/grade.mjs <runDir>` reports three things separately:

| Part | Meaning | Checks |
| --- | --- | --- |
| A | Requirements stated in `TASK.md` (rounding, cumulative fee refunds, rollback, idempotency, ...) | 29 |
| B | Project conventions that are *not* stated in `TASK.md`: report balances as 2-decimal strings, fee rate and fees account read from config, every code registered in `ERROR_CODES`, never throw on malformed input, own tests in `test/batch.test.js` | 6 |
| existing | `test/existing.test.js` still passes | pass/fail |

B is where memory from earlier sessions can matter; A is where a learned workflow (integer cents, half-even rounding, validate before commit, snapshot/restore) can matter.
`node verify-grader.mjs` checks that the starter scores 0 and the reference solution scores everything.

## Protocol

1. **Calibrate the control** (no memory): `node prepare-run.mjs <dir>` three times, let the model solve `TASK.md` in each, grade each. Target: A mean between 30% and 70%. At 100% make the task harder, at 0% easier. Do not tune the task toward a favourable memory result.
2. **Practice sessions** (`sessions/`): run with the real Monqey pipeline so the normal learning review writes the memory. Do not hand-write memories.
3. **Memory arm**: same model, same starter, only the learned memory added. At least 5 runs per arm, alternating order. Keep every run, including failures.
4. **Report** A, B, hard failures, tokens/steps/time, and the one-time practice and review cost.

## Limits

- The calibration runs use isolated subagents on the Haiku model, not Monqey's runtime. They calibrate task difficulty only.
- Runs can in principle read files outside their directory (the grader is in this repository); the prompt forbids it and the grader is never copied into a run directory.
