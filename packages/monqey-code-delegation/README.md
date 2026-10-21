# Managed workers

Restart Monqey Agent with **Quit Monqey Agent** in the tray and reopen the existing
shortcut. Open **Settings → Plugins → Workers**, select a worker and optionally a
reserve from connected providers' live catalogs, enable automatic delegation and
save. Existing model defaults are unchanged. This profile package loads from the
app root at startup; the Electron executable itself does not need rebuilding.

The main model is instructed to use `delegate_task` for substantial independent
work and keep trivial or tightly coupled steps itself. It decides when delegation
is useful; this is not a deterministic task splitter. Workers get a self-contained
task capped at 12,000 characters and their normal workspace instructions/tools,
without a copy of the parent conversation. They share files and are subject to the
existing sandbox and delegated approval policy. The main model must review output.

The parent receives native continuable-subagent settlement notices. Cards above
the composer show task, route, state, outcome and usage; `worker_tasks` exposes a
compact status view to the main model. `send_message` can steer a running worker.
Managed workers cannot delegate further. Native manual `subagent`, `subagent_fork`
and workflow calls remain separate from this managed-task budget.

At most two managed tasks run per parent chat. A task uses at most one reserve
attempt after failure. Quota failures cannot switch to another model on the same
provider/account pool. Transient provider retries remain owned by the existing
runtime. Interrupted/refused/stopped tasks are not automatically replayed. Live
checkpoints, original task and previous child ids accompany reserve attempts;
workers must inspect existing work before repeating actions. A model request with
no streaming progress for ten minutes is interrupted; waiting tool approvals do
not trigger that model-stream watchdog.

The task's provider-reported input, output, cache-read and cache-write buckets are
summed over all requests and attempts, including the runtime's retry settlements.
They are token counts, not prices. Once the budget is reached, further managed
requests stop; an in-flight request can exceed it. Usage the provider does not
report is unavailable. A cheaper worker can reduce cost while total token usage
increases; a saving requires comparing complete tasks, including main-model
coordination and review, at equivalent quality.

State is stored under `<app-root>/storages/workers/<parent-id>.json` with atomic
replacement. Each chat retains its 50 latest finished task records and every
active record; older task usage remains in aggregate counters. Native child
history remains in the normal sessions store. On restart, unfinished indexed
tasks become interrupted and are not silently replayed. Start a new managed task
when continuing older work outside this recent-task index.

Checks (run from the app root, with Node on PATH):

```powershell
node --test packages/monqey-code-delegation/*.test.mjs
node packages/monqey-code-delegation/runtime-smoke.cjs
node packages/monqey-code-delegation/runtime-smoke.cjs --fixture
```

The fixture uses an isolated temporary home and local fake model adapters. It
verifies quota → reserve → parent delivery, exact routing, fresh context, nested
delegation restrictions and accounting without a paid model call or changes to
the user's settings. Real provider quality, quota wording and cost savings still
need a representative comparison with the user's selected models.
