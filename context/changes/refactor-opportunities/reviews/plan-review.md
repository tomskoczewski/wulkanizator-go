<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Fold the booking submit onto the shared HTTP path

- **Plan**: `context/changes/refactor-opportunities/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-13
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 2 critical, 4 warnings, 2 observations (8 of 8 triaged, 8 fixed)

## Verdicts

| Dimension             | Verdict | After fixes |
| --------------------- | ------- | ----------- |
| End-State Alignment   | PASS    | PASS        |
| Lean Execution        | WARNING | PASS        |
| Architectural Fitness | PASS    | PASS        |
| Blind Spots           | FAIL    | PASS        |
| Plan Completeness     | FAIL    | PASS        |

Two FAILs would mechanically read RETHINK, but the approach is sound — every finding had a targeted
fix and none required a redesign. Recorded as REVISE.

## Grounding

9/9 paths ✓, 9/9 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (4 phases, 25 rows, all matched;
re-verified after every edit). One stale citation: the plan writes `useRowMutation.ts:138`, which is
`useJsonMutation.ts:138` — the file does not exist under that name.

Verified inline rather than via sub-agent (session policy), same coverage at this scope.

## Findings

### F1 — Phase 2's mapping drops the network message, so its own no-edit gate can't pass

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness (internal contradiction)
- **Location**: Phase 2 "Contract"; repeated in Phase 3 "Contract"
- **Detail**: Today a network failure shows `"Nie udało się połączyć z serwerem."`
  (`NewAppointmentForm.tsx:127`), and Phase 1 pins exactly that. After the fold `requestJson`
  returns that message as `{ ok: false, failure: { message } }` with **no `status`**
  (`useJsonMutation.ts:64`). Phase 2's contract said "any other failure → the hard-coded Polish
  generic", which maps the network case to the wrong string and fails Phase 1's third test —
  breaking gates 2.1 and 2.2, the plan's entire proof that the fold is behaviour-preserving. The
  same paragraph also said the network branch keeps "requestJson's own message"; the two sentences
  disagreed and the implementer had to guess. Phase 3 repeated the hole.
- **Fix**: State the discriminator explicitly in both Phase 2 and Phase 3 —
  `failure.status === undefined` → network → `failure.message`; any other status →
  `firstFieldError(failure.fieldErrors) ?? generic`. `status` is absent only on `requestJson`'s
  catch path, so it is the one reliable signal.
  - Strength: Preserves all four messages exactly; Phase 1's tests pass unedited.
  - Tradeoff: Couples the form to a `requestJson` internal — mitigated by a one-line comment.
  - Confidence: HIGH — `useJsonMutation.ts:51-58` vs `:64` is unambiguous.
  - Blind spot: None significant.
- **Decision**: FIXED — applied to Phase 2 and Phase 3 contracts, plus the "Critical Implementation
  Details" heading, which now names the two paths that _do_ use `failure.message`.

### F2 — Phase 4 names env vars that don't exist; the obvious fallback points CI at production Supabase

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 "Contract"
- **Detail**: The plan claimed env comes from `.env.e2e.example` "plus `SUPABASE_URL` and
  `SUPABASE_KEY`". Those two are not in that file — it holds only `E2E_BASE_URL`,
  `E2E_DATABASE_URL` and the four `E2E_OWNER_*` values. `.env.example:1-2` carries them as `###`
  placeholders. Meanwhile `ci.yml:26-27,30-31` already wires `secrets.SUPABASE_URL` /
  `secrets.SUPABASE_KEY` into typecheck and build — the **cloud** project. An implementer filling
  the gap by copying the adjacent step gets a dev server talking to production while
  `E2E_DATABASE_URL` stays on `127.0.0.1:54322`: the suite books appointments against production
  and tears them down from the local stack, leaving rows no table has a DELETE grant to remove.
  `astro.config.mjs:19-20` marks both optional, so omitting them instead fails loudly — but the
  "no GitHub secrets" claim was wrong as written and nothing blocked the dangerous reading.
- **Fix A ⭐ Recommended**: Derive both from the stack the job just started —
  `npx supabase status -o env >> "$GITHUB_ENV"`, mapping `API_URL` → `SUPABASE_URL` and
  `ANON_KEY` → `SUPABASE_KEY`; plus an explicit prohibition on `secrets.SUPABASE_*` in this job.
  - Strength: Correct by construction — the values can only be the local stack's.
  - Tradeoff: One more step; depends on `status -o env` key names.
  - Confidence: HIGH — `supabase` is a devDependency (`package.json:72`), present after `npm ci`.
  - Blind spot: Exact key names unverified on the pinned 2.23.x — confirm on first run.
- **Fix B**: Add the well-known local anon JWT to `.env.e2e.example`.
  - Strength: Simplest; makes "no secrets" literally true and documents the default for humans.
  - Tradeoff: Pins a key the CLI could change; a long JWT in a committed file reads as a secret.
  - Confidence: MEDIUM — stable in practice, not guaranteed.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A.

### F3 — Phase 3's payoff is unreachable through the UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 3 Overview; Manual Verification 3.5
- **Detail**: `appointmentBookingRequestSchema` (`src/lib/schemas/appointment.ts:13-19`) constrains
  `first_name` and `phone` with `.min(1)` only — exactly what `canSubmit`
  (`NewAppointmentForm.tsx:165`) already enforces before enabling the button. The other three
  fields are machine-supplied from the selected slot and service. No input a user can type produces
  a `400`, so the phase's stated gap ("the server names the offending field — show it") is
  unreachable, and manual step 3.5 ("blank phone forced past the disabled button") was not
  executable without dev-tools surgery.
- **Fix A ⭐ Recommended**: Keep Phase 3, reframe it as a guard for future schema tightening, name
  the `500`-not-English regression test as the live half, and replace manual step 3.5.
  - Strength: Keeps a cheap correct improvement; stops the next reader hunting a change that isn't there.
  - Tradeoff: None material — a doc edit.
  - Confidence: HIGH — schema and `canSubmit` read directly.
  - Blind spot: None significant.
- **Fix B**: Drop the `firstFieldError` half; keep only the `500` guard.
  - Strength: Smallest possible slice.
  - Tradeoff: Loses two lines that will matter the first time the schema tightens.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — Overview, manual step 3.5, Progress row 3.5 and the Testing
  Strategy's manual list all updated.

### F4 — Phase 1's stub shape is unspecified, and the Phase 2 gate depends on it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §1 "Contract"
- **Detail**: Phase 1 said only "Stub `globalThis.fetch` per case". Today's code branches on
  `res.status`, so a bare `{ status: 201, json: … }` passes — but `requestJson` branches on
  `res.ok` (`useJsonMutation.ts:49`), `undefined` on such an object. The `201` test would flip to
  the failure branch in Phase 2, forcing a test-file edit and breaking gates 2.1/2.2. The repo
  already has the right helper: `jsonResponse()` at `DayPlanBoard.test.tsx:41-43`.
- **Fix**: Require real `Response` objects and name `jsonResponse` in Phase 1's contract.
- **Decision**: FIXED.

### F5 — Phase 4 runs a bare `supabase` binary that isn't on PATH

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1 "Contract" — the step list
- **Detail**: The steps read `supabase start` → `supabase db reset`. `supabase` is a devDependency
  (`package.json:72`), not a global: npm scripts find it on `node_modules/.bin`, a workflow `run:`
  step does not. Both steps fail with "command not found". Separately, `supabase start` already
  applies migrations and `seed.sql`, so the following `db reset` is redundant on a cold runner.
- **Fix**: Use `npm run db:start` (or `npx supabase`); drop the redundant reset.
- **Decision**: FIXED.

### F6 — Doc sync stops at README; AGENTS.md states the same stale CI gate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2 "Documentation"
- **Detail**: Phase 4 updated `README.md:276` only. `AGENTS.md:35` and
  `context/foundation/test-plan.md:132` state the same "lint + test + typecheck + build" gate. This
  is the failure `context/foundation/lessons.md` §"Deleting a symbol means grepping the docs that
  name it" records, and its stated reason applies verbatim: AGENTS.md is the first file a future
  agent reads.
- **Fix**: Add both files to Phase 4's contract, with a `grep` verification.
- **Decision**: FIXED.

### F7 — Gate 2.2 passes vacuously unless Phase 1 is committed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, criterion 2.2
- **Detail**: `git diff --stat <test file>` on an untracked path prints nothing — always. If Phase 1
  isn't committed before Phase 2 starts, the gate reports green no matter how the file was
  rewritten. `/10x-implement` commits per phase, so this held on the normal path only.
- **Fix**: Name "Phase 1 is committed" as an explicit precondition of the criterion.
- **Decision**: FIXED.

### F8 — Three callers of `requestJson`, three different message chains

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §1 / "Critical Implementation Details"
- **Detail**: `useRowMutation` (`useJsonMutation.ts:138`) uses `firstFieldError ?? message ??
fallback`; `AppointmentStatusPanel.tsx:55` uses `message ?? generic`; Phase 3 introduces
  `firstFieldError ?? generic`, skipping `message`. The plan's reasoning for diverging is sound and
  it mandates a comment, so this is not a defect in the plan. **Verified during triage and upgraded
  from speculation to fact**: `/api/appointment-status/[id]` returns `"Failed to change appointment
status"` (500) and `"Supabase is not configured"` (503), and both surfaces that chain through
  `message` render those English strings into the Polish UI today. Pre-existing, out of this
  change's scope, and not currently tracked anywhere else.
- **Fix**: No plan edit. Record the house rule as a lesson so the next caller doesn't re-derive it.
- **Decision**: FIXED — `context/foundation/lessons.md` §"Never chain through `failure.message`
  unless the route's error strings are user-facing Polish".
