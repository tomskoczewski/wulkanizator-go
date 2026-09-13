---
date: 2026-09-13T00:00:00Z
researcher: tomaszskoczewski
git_commit: 0d870b2
branch: main
repository: wulkanizator-go
topic: "Refactor opportunities — which of the booking flow's recorded problems are worth fixing, in what shape, in what order"
tags: [research, refactor, booking, technical-debt, ranking, verified]
status: complete
last_updated: 2026-09-13
verified_commit: 0d870b2
last_updated_by: tomaszskoczewski
---

# Research: refactor opportunities

**Input treated as settled evidence, not re-derived**: `context/changes/booking-flow-analysis/research.md`
(the L3 deep focus). Priors: `context/map/repo-map.md`, `context/map/artifact-1-territory.md`,
`context/map/artifact-2-structure.md`.

**This report decides nothing.** It explores each recorded problem in the code and in the history and
closes with a ranked proposal for a separate planning session. No refactor happened; no target
architecture is designed beyond naming an adequate shape per candidate.

**Labels**: `[E]` evidence (a line was read / a command was run), `[I]` inference, `[U]` unknown.

---

## 1. Problem inventory and classification

Every problem the L3 report records, regardless of its label there, classified by one test:
**would fixing it change the structure of the code?**

| ID     | Problem                                                                                               | From               | Class                                                 |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| **K1** | The no-overlap rule expressed twice (TS + SQL), joined only by the `"23P01"` literal                  | TD-1               | **CANDIDATE**                                         |
| **K2** | Six time/shape rules enforced only in the untested preflight, no DB backstop                          | TD-2               | **CANDIDATE**                                         |
| **K3** | `appointments.ts` (375 lines) mixes orchestration, Supabase gateway and time math                     | TD-5, artifact 2   | **CANDIDATE**                                         |
| **K4** | Booking submit hand-rolls `fetch`, bypassing the shared mutation hook                                 | TD-4               | **CANDIDATE**                                         |
| **K5** | `types.ts` imports upward into schemas/services — 6 type-only cycles                                  | map §3             | **CANDIDATE**                                         |
| **K6** | `select plan(54 + 12)` forces a file-global edit on the 765-line pgTAP suite                          | TD-6               | **CANDIDATE**                                         |
| N1     | No test on any of the 12 API routes; the 409 contract untested on both ends                           | TD-3               | not a candidate — **missing test**; feeds feasibility |
| N2     | `appointments.test.ts`'s fake cannot see query construction                                           | TD-5 (test half)   | not a candidate — **missing test**                    |
| N3     | Busy-interval query filters on `starts_at` only; an appointment spanning into the window is invisible | TD-7               | not a candidate — **suspected defect**, not a shape   |
| N4     | `fieldErrors` discarded by the booking form                                                           | TD-8               | not a candidate — one missing branch                  |
| N5     | Three auth routes have no zod validation, contradicting `AGENTS.md`                                   | L3 verification C7 | not a candidate — **rule/doc drift**                  |
| N6     | `database.types.ts` regeneration coupling                                                             | L3 cheap debt      | not a candidate — already mechanised                  |

N1–N6 are carried below only where they change the cost or the risk of a candidate.

---

## 2. Per-candidate findings

### K1 · One rule, two expressions

**Current shape [E].** Three predicates are stated twice. Half-open interval: `slot-suggestions.ts:65`
vs `20260821090000_appointments_and_customers.sql:60` (`tsrange(…, '[)')`). Per-bay scope:
`slot-suggestions.ts:59-60` vs `:59` (`bay_id with =`). Status exclusion: `appointments.ts:95`
(`.not("status","in","(cancelled,no_show)")`) vs `:61` (`where (status not in (…))`). The only runtime
link is the SQLSTATE literal at `appointments.ts:207`. `slot-suggestions.ts` has fan-out 0 — it imports
nothing at all.

**Intentionality: DELIBERATE — and this is the finding that reorders the whole report [E].**
`context/archive/2026-08-21-add-appointment-with-slots/plan-brief.md:59-62` states the design in as many
words:

> "Defence in depth, three layers with distinct jobs: **zod** rejects malformed input at the API
> boundary, the **algorithm** avoids proposing a conflict, the **exclusion constraint** guarantees one
> cannot be stored. The first two are UX; the third is correctness."

and `:77-79`:

> "Half-open `[start, end)` intervals **must hold in all three layers** — the likeliest off-by-one hides
> at exactly the back-to-back boundary, the commonest case in a tire shop."

So the duplication is not accidental complexity and **must not be deduplicated** — the two layers answer
different questions (_don't offer a conflict_ vs _don't store one_), and collapsing them would delete the
UX layer or move the correctness guarantee out of the database, which the same brief rejects
(`20260821090000:9-11`: a check-then-insert in the API loses to two simultaneous requests).

**What the design left undone [I].** The brief asserts the invariant "must hold in all three layers" and
nothing verifies that it does. The constraint it was protecting — the DB is the authority, the algorithm
is UX — stays intact under any future change; what is missing is a **conformance check**, not a merge.

**Adequate target shape**: the two layers stay; one executable test asserts they agree at the boundary.

### K2 · Six rules with no backstop

**Current shape [E].** Working hours, closed days, the 15-minute grid, not-in-the-past, the 14-day
horizon and `ends_at = starts_at + duration` are enforced only at `appointments.ts:182-192`, and
`grep -rn "working_hours"` over the three appointment migrations returns nothing. `bookAppointment()`
has no unit test at any layer.

**Intentionality: DELIBERATE at the layer level, UNDECIDED at the rule level [E]/[I].** The same
defence-in-depth statement assigns "the first two are UX" — which is why these rules live in the
application. But no document says these six specifically were considered for a DB constraint and
rejected `[U]`. The decision recorded is about _layers_, not about _this list of rules_.

**Already a named risk, independently [E].** `context/foundation/test-plan.md:46` is Risk #2 — "a booking
write accepts a slot the workshop cannot serve … because the server trusts the client-supplied bay and
start time" — and `:73` pre-empts the exact counter-argument this candidate invites:

> "'The database exclusion constraint makes this safe.' It catches overlap; it does not catch 03:00 on a
> closed day, nor a malformed time value that still parses."

The test plan even prescribes the remedy: "pgTAP (DB invariant + concurrency) plus one route-level
integration test", and `:118` records the working-hours case as still outstanding.

**Adequate target shape**: the preflight stays the single enforcement point, but becomes _pinned_ by
tests — and, separately, the decision "does a closed-day booking deserve a DB constraint?" gets made
explicitly instead of by default.

### K3 · `appointments.ts` mixes three jobs

**Current shape [E].** 375 lines. The seam is already visible in the function layout: pure helpers
(`toWireSlot:49`, `combineDateAndTime:70`, `addDays:75`, `toDayPlanEntry:230`, `weekdayForDateString:249`),
one gateway (`fetchSuggestionInputs:81`), and **five** (report: four) orchestrators
(`suggestSlotsForService:140`, `bookAppointment:178`, `getDayPlan:261`, `getAppointmentDetail:290`,
`changeAppointmentStatus:314`).
Fan-out 7 — the highest in `lib/` — fan-in 5 in the graph plus two `.astro` importers the graph cannot
see (`dashboard.astro:4`, `wizyty/[id].astro:5`).

**Intentionality: ACCIDENTAL [E]/[I].** No plan, plan-review or impl-review in the nine archived changes
discusses splitting this module, or its size, or its mixed responsibilities `[E — grep over
context/archive/*/reviews/impl-review.md found nothing]`. It grew across 6 commits and 417 lines of churn
without anyone arguing for the current shape `[I]`.

**Adequate target shape**: orchestration separated from the Supabase gateway, so the orchestration half
becomes testable without a fake client.

### K4 · The hand-rolled `fetch`

**Current shape [E].** `ast-grep` finds exactly two `fetch` call sites in `src/`: the shared hook
(`useJsonMutation.ts:42`) and the booking submit (`NewAppointmentForm.tsx:98`).

**Intentionality: DELIBERATE, AND THE JUSTIFICATION HAS SINCE EXPIRED [E].** This is the sharpest
history finding in the report. The bypass was reviewed and accepted in
`context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:57-64` (F3, WARNING):

> "This is a deliberate, justified deviation — `useJsonMutation`'s `MutationResult` shape only carries
> `ok`/`fieldErrors`/`message` on failure, with no room for the 409 response's `slots`/`emptyReason`
> payload the booking flow needs."

The prescribed fix was **a comment**, and the comment exists (`NewAppointmentForm.tsx:88-90`). But one
slice later the hook was extended: `be9ece7` added `status` and `body` to `MutationFailure`, forced by a
CRITICAL plan-review finding on a different change
(`context/archive/2026-08-21-worker-status-changes/reviews/plan-review.md:26-43`). The repo already knows
this: `context/changes/testing-mutation-failure-ui/research.md:319` records it as _"`NewAppointmentForm`
bypassed the hook because it couldn't carry a 409 body; **documented, not fixed**"_, and `:300-302` notes
the hook "was generalised under review pressure, not up front".

So the blocker was removed on 2026-08-24 and the workaround has outlived it by three weeks `[E]`.

**Adequate target shape**: one HTTP path for island mutations, with the 409 body carried by the hook's
existing `status`/`body` fields.

### K5 · The `types.ts` inversion

**Current shape [E].** 54 lines, fan-in 25 (24 of them type-only), fan-out 5. Four upward edges into
`schemas` and `services` produce all six cycles; all vanish at runtime.

**Intentionality: UNKNOWN, leaning accidental [E]/[U].** No change folder names `types.ts` as a subject;
it was edited as a side effect of 8 feature commits, and no review ever mentions a cycle, a circular
import or the inversion `[E — grep over all reviews]`. Artifact 2 called it "a deliberate inversion";
this exploration finds **no evidence for the word deliberate** — only that it is consistent.

**Adequate target shape**: derived types re-exported from the module that owns them, so the foundation
file stops importing upward.

### K6 · The pgTAP plan count

**Current shape [E].** `supabase/tests/rls_workshop_scope.test.sql:11` is `select plan(54 + 12)`; 765
lines; 821 lines of churn over 8 commits.

**Intentionality: DELIBERATE AND ROUTINELY MANAGED — this is not debt [E].** Every plan that touches the
suite budgets for the bump as a normal step: `2026-08-15-workshop-setup/plan.md:144` ("Bump
`select plan(N)` to the new count"), `2026-08-21-worker-status-changes/plan.md:212` ("**bump the
`plan(48)` count at `:11`**"), and `2026-08-25-customer-dedupe-on-booking/plan.md:277` reasons carefully
about what the new N should be and how to confirm it. The cost is known, priced and paid each time.

**Adequate target shape**: none needed. The alternative (`select * from finish()` without a plan) trades
a known ritual for the loss of the "planned vs ran" check that
`customer-dedupe-on-booking/plan.md:277` explicitly relies on `[I]`.

---

## 3. Feasibility — safety nets and first steps

**The single most important feasibility fact [E]**: `.github/workflows/ci.yml` runs `npm ci`,
`astro sync`, `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` — **and nothing else**.
Neither pgTAP nor Playwright runs in CI. `lefthook.yml` adds a local pre-commit (`eslint`, `prettier`,
`typecheck`, `vitest related`) and a pre-push types-drift check that **exits 0 when the Supabase stack is
down** (`:26-29`).

Consequence: **Vitest is the only safety net that runs automatically.** The pgTAP suite — which is where
most of the booking invariants are actually proven — protects nothing unless a human remembers to run
`npm run db:test`. Any migration guarded "by pgTAP" is in practice guarded by discipline `[I]`.

|        | Reuses an existing seam?                                                      | Safety net today                                                                                                              | Runs in CI?            | First prerequisite step                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K1** | Yes — both sides exist and are stable; needs one new test, no new abstraction | `slot-suggestions.test.ts` (12 cases) covers TS only; pgTAP `:453-495` covers SQL only; nothing covers agreement              | Vitest: ✅ · pgTAP: ❌ | Write the conformance test — it is itself the deliverable, not a preparation for one                                                                                  |
| **K2** | Yes — the preflight is one function, already isolated                         | **None.** `bookAppointment()` has no unit test; only the happy path via `e2e/core-loop.spec.ts:31-52`                         | e2e: ❌                | Characterization: pin the six rules with tests against the current preflight **before** any decision about a DB constraint                                            |
| **K3** | Yes — the pure/gateway/orchestrator seam already exists in the file layout    | `appointments.test.ts` covers only `changeAppointmentStatus`, with a double-cast fake that cannot see query construction (N2) | Vitest: ✅             | Characterization of `bookAppointment` + `suggestSlotsForService` first — i.e. **K2's step is K3's prerequisite**                                                      |
| **K4** | Yes — the hook already carries `status`/`body`; nothing to invent             | `useJsonMutation.test.ts` covers `requestJson`'s 409/400 paths; the form itself has no test                                   | Vitest: ✅ (hook only) | Add a colocated `NewAppointmentForm.test.tsx` for the 409-resync branch, then fold — the harness recipe already exists (`test-plan.md` §6.4, `DayPlanBoard.test.tsx`) |
| **K5** | Yes — pure import rewiring                                                    | `npm run typecheck` + `npm run build` catch every mistake immediately                                                         | ✅ Both                | None needed; it is a single reversible commit                                                                                                                         |
| **K6** | —                                                                             | —                                                                                                                             | —                      | Not recommended (§2)                                                                                                                                                  |

**Blast radius**, taken from L3, not recomputed: K1 touches `slot-suggestions.ts:65`, `appointments.ts:95`,
the migration `:56-61` and pgTAP `:453-495`/`:730-750` **if the rule changes** — but a _conformance test_
touches none of them, only adds a file. K3 moves one module with 5 graph dependents plus 2 invisible
`.astro` importers. K4 touches one component. K5 touches 5 files, all imports.

**Unknowns that must be resolved before starting** `[U]`: whether an appointment can span midnight (N3 —
decides whether the busy-interval window bug is reachable, and it sits inside K2's surface); whether
`services.duration_min` has a positivity constraint.

---

## 4. Refactor opportunities (ranked)

A proposal for a separate planning session, ranked by **cost of the debt ÷ cost of the change**, with the
intentionality verdicts above as the binding constraint: a deliberate design is not a defect, and a
justification that has expired is not a design.

### ⭐ 1 — K4 · Fold the booking submit onto the shared mutation hook

**Now → target**: two HTTP paths for island mutations → one, with the 409 body carried by
`MutationFailure.status`/`.body`.

**Why first**: it is the only candidate whose **justification is documented as expired**. The review that
accepted it named the exact blocker; a later change removed that blocker; the repo's own research
recorded the result as "documented, not fixed" and moved on. Nothing else in this list has that
combination of _low cost_, _evidence of intent_, and _the intent no longer applying_. It also closes a
real inconsistency: the single most interesting response on the booking path (409 with fresh slots) is
handled by the one code path that shares nothing with the other seven callers.

**Blast radius**: one component. **Safety**: hook paths already unit-tested; the form is not — hence the
prerequisite. **Incremental path**: (1) colocated `NewAppointmentForm.test.tsx` pinning the 409-resync
branch against today's hand-rolled code; (2) swap to `useJsonMutation`; (3) the test must stay green
unchanged — that is the proof. **First step**: step 1.

### ⭐ 2 — K2 · Pin the six unbacked rules with characterization tests

**Now → target**: six rules enforced by untested code → the same six rules enforced by the same code,
with a test that fails if any of them stops being enforced.

**Why second**: highest debt cost in the list — the L3 report showed that deleting the preflight entirely
leaves the whole suite green — and it is already Risk #2 in `test-plan.md`, with the remedy prescribed
there. Deliberately **not** framed as "add DB constraints": that is a design decision the defence-in-depth
brief has a stake in, and it should be made in planning, with the characterization tests already in hand
as evidence. Pinning first is reversible and cheap; constraining the database is neither.

**Blast radius**: new test file only. **Safety**: none today — that is the point. **Incremental path**:
(1) characterize each of the six rules against `bookAppointment` with a fake client; (2) resolve the
midnight-span unknown (N3), which lives inside this surface; (3) _then_ decide, separately, whether any
rule earns a DB constraint. **First step**: step 1.

### ⭐ 3 — K1 · Make the two layers' agreement executable

**Now → target**: "the interval semantics must hold in all three layers" as prose in an archived brief →
one test that fails when they diverge.

**Why third**: the highest-severity _latent_ risk (drift fails open with a confusing 409, or closed and
silently), but the least urgent, because both sides are currently correct and neither has changed in
three weeks. Crucially, the intentionality verdict **forbids the obvious fix**: this must not be
deduplicated. The work is a conformance test — property-style, or a table of boundary cases asserted
against both the TS predicate and a real Postgres range — not a merge.

**Blast radius**: adds a file; touches no production code. **Safety**: each side is tested alone; the
agreement is not. **Caveat that belongs in planning**: the natural home for this test is pgTAP or an
integration test, and **neither runs in CI** — so this candidate quietly depends on the API-harness gap
(N1). **First step**: decide where such a test can run automatically; without that, the test is written
and then never executed.

### Considered and not ranked

- **K3 · Split `appointments.ts`** — genuine accidental complexity, and the seam is real, but it is a
  _consequence_ of K2's gap, not a cause: the reason the module is hard to test is that its orchestration
  is entangled with I/O, and K2's characterization work will show exactly where the seam wants to be.
  Splitting first means designing the boundary blind. Revisit after K2.
- **K5 · Invert the `types.ts` edges** — cheapest change in the list (one commit, fully caught by
  `typecheck`), but zero runtime risk and no reader has ever been recorded as confused by it. Real, tiny,
  and not competing with the three above. Good filler work.
- **K6 · The pgTAP plan count** — **rejected as a candidate.** The history shows a known, priced, routinely
  managed cost, and the alternative loses the planned-vs-ran check the team deliberately relies on.
- **N1–N6** — not structural. N1 (no route tests) is the largest of them and is a stated test-plan phase;
  note that K1's ranking depends on it.

---

## Weryfikacja twierdzeń (ast-grep)

The structural claims the **ranking** rests on, re-derived rather than trusted. Per the rule for this
step, every `ast-grep` zero was re-confirmed with a plain `grep` — and one zero here was a bad pattern,
not an absence, which is exactly why the rule exists. `ast-grep` cannot parse `.astro`, so it sees 59 of
73 source files; grep backstops include `*.astro`.

| Claim (whose rank depends on it)                                               | Verdict                    | Evidence                                                                                                                                                                                                                                                     | Method                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **K4 ⭐1**: the hook can now carry a 409 body — the documented blocker is gone | ✅ **confirmed**           | `useJsonMutation.ts:3-8` — `MutationFailure` declares `status?: number` (`:6`) and `body?: unknown` (`:7`) alongside `fieldErrors`/`message`                                                                                                                 | `grep -n -A8 "interface MutationFailure"`                                                                                                                                                  |
| **K4 ⭐1**: exactly two `fetch` call sites, one of them the bypass             | ✅ confirmed               | `useJsonMutation.ts:42`, `NewAppointmentForm.tsx:98`                                                                                                                                                                                                         | `ast-grep 'fetch($$$)'` (ts+tsx); grep incl. `.astro` agrees                                                                                                                               |
| **K1 ⭐3**: `"23P01"` is the only runtime link between the layers              | ✅ confirmed               | `services/appointments.ts:207`, `:334` — two sites, one file                                                                                                                                                                                                 | `ast-grep '$E.code === "23P01"'`                                                                                                                                                           |
| **K1 ⭐3**: `slot-suggestions.ts` imports nothing                              | ✅ confirmed               | 0 matches; `grep -c "^import"` → **0**                                                                                                                                                                                                                       | `ast-grep` + grep backstop                                                                                                                                                                 |
| **K3**: the pure / gateway / orchestrator seam exists in the file layout       | ⚠️ **refined**             | **5** exported async orchestrators (report said four — `getAppointmentDetail:290` was omitted), 1 local async gateway, 1 exported + 4 local sync helpers = 11 functions in 375 lines                                                                         | ⚠️ `ast-grep 'function $N($$$) { $$$ }'` returned **0** — the pattern does not match TypeScript return-type annotations. **Zero was a false negative**; counts come from the grep backstop |
| **K5**: `types.ts` imports upward into schemas and services                    | ✅ confirmed, made precise | 4 upward imports at `types.ts:2` (`lib/schemas/workshop-setup`), `:10` (`lib/schemas/appointment`), `:15` (`lib/services/appointments`), `:16` (`lib/services/day-plan`); the 5th (`:1`) points down to `db/database.types` and is not part of the inversion | `ast-grep 'import type { $$$ } from $P'` + read                                                                                                                                            |
| **K6**: the plan count is a single line governing the whole suite              | ✅ confirmed               | `rls_workshop_scope.test.sql:11` — `select plan(54 + 12)`                                                                                                                                                                                                    | read                                                                                                                                                                                       |

**Does anything here move a candidate?** No — **to decide at the planning stage**. The one refinement
(K3's function count) slightly _strengthens_ the case that the module carries more than one job, but K3
was already unranked for a reason unaffected by counting: it is a consequence of K2's gap, not a cause.
The K4 verification is the one that matters, and it confirms the ranking's premise outright: the hook
declares `status` and `body` today, so the reason recorded for the bypass in 2026-08-21 no longer holds.

**Method note worth keeping.** The `function $N($$$) { $$$ }` pattern silently returned zero across a
file containing eleven functions. Taken at face value it would have read as "no functions here" — an
absurd result that a less obviously-wrong query would have passed off as a finding. This is the second
time in this module's work that the grep backstop changed an answer.

---

## 5. Method and limits

Explored by reading the L3 report as settled evidence, then the nine archived changes, `test-plan.md`,
`lessons.md`, CI and hook configuration, and git history for each candidate. The three-subagent
exploration this step normally uses was interrupted by a session limit and completed in the main session
instead; the dimensions covered are the same (current shape / intentionality / feasibility) `[E]`.

**Limits.** Intentionality verdicts rest on this repo's written record, which is unusually rich but
single-author with **zero human PR reviews** — "nobody argued against it" is weak evidence that a shape
was chosen rather than defaulted into `[I]`. Nothing here was executed against a running database. The
ranking is a proposal; the L4 contract puts the decision in the planning interview, not here.
