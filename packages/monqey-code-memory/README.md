# Local recall and learned project skills

The profile enables DSH's existing SQLite FTS5 index on the first search. The
derived index stays in memory and is rebuilt from local sessions after restart;
there is no second permanent copy of the conversation corpus. Session storage
and existing user settings are preserved. Node 24's built-in SQLite is used.

## Using recall

- Click the search icon beside **Workspaces** to search agent message contents
  as well as titles. Results show a short excerpt and open the original agent.
- `history_search` offers compact discovery; `history_read` retrieves a cited
  event and a small surrounding window when deeper investigation is needed.
- Agents now prefer `history_recall` for missing history: it searches and reads
  cited matching events in one tool call. It returns up to 3 matches (default
  2), with at most 1,200 text characters per match and 2,400 overall. It marks
  truncated text; another read is needed only if necessary evidence is missing.
  Existing search/read tools remain available for deeper investigation.
- History searches match one literal phrase. Use a short exact project or
  feature name rather than concatenating keywords into a sentence.
- Sufficient current conversation context does not require another search.
  The native skill catalog can still require a skill load when the task matches
  a listed workflow, even if similar workflow text is already in the question.
  Short workflows are not automatically inlined by this change.
- Model-facing recall is restricted to the current registered workspace,
  including its subdirectories but excluding other registered nested projects.
  It excludes the current conversation and worker sessions from search results.
- Search returns at most 20 conversations (default 5), 320 characters per hit.
  Reads contain at most 4,000 text characters. Obvious credential patterns are
  omitted. This screening is not a general sensitive-data classifier.
- Historical text is reference material. Current shared decisions and existing
  permission checks remain authoritative. History search does not synchronize
  private conversations to another computer or cloud project folder.
- The native human search shows the current conversation surfaces. Agent recall
  also searches older replaced surfaces retained in the local log. Physical
  session deletion removes its searchable source; a forgotten memory does not
  delete messages already present in old conversations.

## Learned skills

Completed responses now have **Knowledge used** and **Learned** badges beside
their existing actions. Expand a badge, select an entry, and inspect its current
content and source evidence or use **Edit / Forget**. A changed entry explicitly
shows the revision loaded by the answer and the current saved revision. Shared
decisions must still be edited in **Co-work > Shared project**.

Knowledge used means that the memory appeared in an actual dispatched request's
owned local-memory context, or that a successful memory/skill read appeared in
that request. It does not prove the answer relied on it. Catalog advertisements,
prompt previews and failed reads do not count. Learned counts only successful
new saves and updates, including background reviews; unconfirmed shared proposals
are excluded. The display makes no additional model calls.

Activity stores only bounded IDs/revisions/access methods for the latest 100
active turns across this profile (32 references per category), never a second copy
of memory text. Responses from before this feature have no historical receipts.
Forgotten or out-of-scope entries disappear from the badges. Each visible agent
shares one lightweight activity poll across its response badges.

**Settings > Memory > Learned workflows** displays the existing workflow store.
Every eligible workflow is offered through DSH's native skill registry under
`learned-<memory-id>`. The catalog contains names, descriptions and revisions;
the native `skill` tool loads the full procedure only on demand. No duplicate
SKILL.md files are created. The normal memory profile remains the source of
truth, with its existing 300-entry and file-size limits.

Skills are workspace-specific. Disabling memory or forgetting a workflow removes
it from the provider. A changed workflow invalidates the catalog and the next
load uses its latest revision. Old already-loaded content remains in the old
conversation log; start a new agent when a clean context is needed.

Background learning may improve an existing learned workflow when its supplied
ID and revision match and the review cites a user correction followed by a
successful tool result. It retains the workflow's identity and five previous
versions. Automatic learning preserves manually edited entries and stale
versions. Semantic correctness still depends on the reviewing model.

Automatic learning now uses a local, deliberately selective gate: a newly stated
preference or a failure/correction followed by a successful tool result. Ordinary
successes and greetings do not start model reviews. The gate is a Dutch/English
heuristic, not a semantic classifier; implicit lessons can be missed. The agent
can still save explicit memories, and **Review current agent** remains available.
Review evidence advances past the last attempted review, including after restart.

Automatic reviews are limited to three attempts per rolling 24 hours across the
local profile. The reservation is persisted before dispatch; failures,
cancellations and interrupted app runs consume an attempt. Each automatic request
is capped at 8,000 input characters (instructions, evidence and existing workflow
context combined) and 600 output tokens, or the user's lower limits. Input tokens
depend on the provider tokenizer; this is a request/output budget, not an exact
total-token or monetary ceiling. Manual reviews bypass the daily allowance and
use the configured limits. Shared-project action enforcement is independent of
this learning allowance. No provider, model or existing memory is migrated.

New automatic workflows must cite the failure/correction and a later successful
tool result. They use compact **When / Do / Verify** lines (at most 1,600 characters)
to retain applicability, the concrete fix, and the observed check with its limits.
The When line becomes the native skill's applicability summary; full procedures
remain lazy. Existing workflows remain readable in their original format.

Shared workflow changes become proposals in Co-work and require human
confirmation. Only confirmed shared workflows are offered as skills; private
legacy project notes remain excluded once shared-project mode is active.

## Verification

Run `node --test packages/monqey-code-memory/*.test.mjs` for store, scope and
revision tests. `runtime-smoke.cjs` checks the real profile, native index, skill
loader, learning and shared-project guards using test adapters without paid
calls. Add `--preview` to inspect its isolated UI.

`node packages/monqey-code-memory/recall-live-smoke.cjs` is an explicit live-model
test using the configured OAuth worker model and fabricated data. It permits
only recall/skill tools, limits the agent to eight steps and a two-minute turn,
uses an access-only temporary credential, and verifies the main settings and
credential files remain unchanged. Provider-reported usage is written to
`logs/recall-live-result.json`. This demonstrates working retrieval, not measured
token or monetary savings versus a baseline.

For the explicit paired token comparison, run
`node packages/monqey-code-memory/recall-live-smoke.cjs --benchmark`, then
`node packages/monqey-code-memory/recall-benchmark-report.cjs`.
This uses the same connected worker model for twelve real-model runs: three
alternating pairs each with 3 and 60 fabricated historical conversations. One
route receives the entire archive and workflow; the other must use native
history search/read and skill loading. Both must return the exact fact,
checklist and source citation. All reported cached and uncached tokens across
all steps count, including any extra tool calls in the full-context route.
Title generation and automatic learning are disabled in this isolated fixture.
It stops on the first incorrect or unmetered run, at eight steps per run,
before another request once 60 attempts or 600,000 reported tokens are reached,
or at the time limits. It does not change the main model or saved credentials.
The benchmark uses actual model requests; run it deliberately.

Raw usage is saved in `logs/recall-benchmark-result.json`; the report command
validates complete pairs and writes `logs/recall-benchmark-report.md` and
`logs/recall-benchmark-summary.json`. Cache is observed rather than reset.
This compares full historical context with explicit retrieval for one synthetic
task, not the existing compaction system, automatic routing, learning cost,
or general subscription/currency savings. The report's aggregation and failure
checks are covered by `benchmark.test.mjs`.

To compare the previous recall policy with combined/selective retrieval, run
`node packages/monqey-code-memory/recall-live-smoke.cjs --optimized-benchmark`
and `node packages/monqey-code-memory/recall-benchmark-report.cjs --optimized-benchmark`.
This performs 18 real-model runs: three alternating pairs each for missing
context with 3 and 60 old conversations, plus already-supplied context with
3 conversations. Both receive the same question without a prescribed tool
sequence. The previous variant restores the earlier recall instruction and
search description and excludes the new tool; the updated variant uses the
production policy and tools. Correctness, citations, all steps, token usage,
auxiliary-call exclusion and cleanup checks are identical. Results are saved
separately under `logs/recall-efficiency-*`, preserving the earlier benchmark.

After installing these profile changes, fully quit Monqey Agent from its tray
menu and reopen the existing shortcut. A new desktop executable is unnecessary.

## Automatic-learning quality pilot

`node packages/monqey-code-memory/recall-live-smoke.cjs --learning-quality`
performs an explicit live-model coding experiment with the configured OAuth
worker. It starts with a customer-import practice task, adds corrective
validation feedback, and waits for the normal automatic post-turn review to
save a workflow. No hand-written ideal workflow is inserted. If practice
validation or automatic workflow extraction fails, evaluation stops and the
partial result is retained.

Two new import tasks (CSV vendors and JSON inventory) run in three alternating
control/learned pairs each. Both receive the same full requirements, starter
code and tools. Only the learned project has the automatically extracted
workflow. Evaluation learning is disabled and practice history is inaccessible.
The model can read its brief/code, replace only importer.cjs, run fixed public
checks and load native skills. Generated pure functions are evaluated outside
the task directory in a separate Node process with filesystem permissions and
a VM without import/process/require access. Hidden inputs cover the stated
requirements; they introduce no additional requirements. This is a focused
implementation experiment, not a complete application/database migration.

The fixture allows at most ten model steps per turn, rejects further steps at
the global request/token/time limits (150 observed requests, 800,000 reported
tokens, twenty minutes), and has a 150-second turn timeout. The wrapper has a
twenty-five-minute outer timeout. It stops on incomplete/unmetered turns,
input mutation or a task scope/integrity violation. Final generated code,
public-check diagnostics and hidden grades are retained in
`logs/learning-quality-result.json`; temporary
runtime files and credentials are removed on exit.

Run `node packages/monqey-code-memory/learning-quality-report.mjs` to validate
accounting and write `logs/learning-quality-report.md` and its JSON summary.
It separates unseen acceptance cases from public regression cases, reports
successful skill loads, and includes the practice and review token cost.
Equal perfect scores are a ceiling effect, not evidence of improved quality.
`learning-quality.test.mjs` checks the evaluator, mutation detection, positive
reference behavior, Windows junction resolution and report accounting. Its
junction test requires an environment that permits creating test junctions.
