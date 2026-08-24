<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Worker Status Changes (S-04)

- **Plan**: `context/changes/worker-status-changes/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-24
- **Verdict**: NEEDS ATTENTION → **all 10 findings triaged and fixed** (2026-08-24)
- **Findings**: 1 critical, 6 warnings, 3 observations — 10 fixed, 0 skipped

## Post-triage gate

| Gate | Result |
|---|---|
| `npm test` | PASS — 55 tests, 6 files (was 45/5) |
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors |
| `npm run build` | PASS |
| `npm run db:test` | PASS — 54/54, against the un-reset local database that previously failed 6 |

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | FAIL |

## Automated verification re-run

| Gate | Result |
|---|---|
| `npm test` | PASS — 45 tests, 5 files |
| `npx vitest run` on both new suites | PASS — 11 tests, 2 files |
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors (11 pre-existing `no-console` warnings) |
| `npm run build` | PASS |
| `grep -n "api/appointment-status"` (4.5) | PASS — hits both files |
| `npm run db:test` | FAIL — 6/54, environmental (see F9) |

## Findings

### F1 — Tapping the day-plan card body no longer navigates

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/appointments/DayPlanBoard.tsx:209-218,247
- **Detail**: The stretched-link overlay is painted *underneath* the card content. The anchor is `absolute inset-0 z-0` (`:211`) while both content columns are `relative z-10` (`:214`, `:218`), so the columns paint and hit-test above it. The columns are plain non-interactive `<div>`s and are siblings of the anchor, not descendants, so a tap on them reaches nothing at all. Only the card's 12px `p-3` padding ring and the 12px inter-column gap still hit the link. Before this slice the entire card was the `<a>` (old `:144-171`), so this is a live regression on the app's primary screen.

  Verified empirically in Chrome with `document.elementFromPoint` against a reproduction using the exact computed CSS: customer name, bay, service and time all resolve to non-interactive elements with `closest('a') === null`; only the padding ring resolves to the anchor. The advance button remains correctly clickable.

  Plan manual criterion 4.7 ("Tapping the card body still navigates to `/wizyty/<id>`") is marked `[x]` at `plan.md:432` but does not hold — most likely verified by tapping the card edge. Note the plan's own recipe invited this ordering (`Critical Implementation Details`: "`<a class="absolute inset-0">` at the base, action button `relative z-10`"), so the plan is partly at fault; the resulting behavior still contradicts the plan's Desired End State.
- **Fix**: Drop `relative z-10` from the two content columns (`:214`, `:218`) and from the error `<p>` (`:247`), keeping the button's own `relative z-10`. The non-positioned columns then paint below the positioned `z-0` anchor (text stays visible — the anchor is transparent), while the positioned `z-10` button stays above it.
  - Strength: Verified in the same browser reproduction — after the change all four content probes resolve to the anchor with `closest('a')` non-null, and the advance button still resolves to the button. Three token deletions, no structural change.
  - Tradeoff: Card text becomes unselectable, the standard stretched-link trade-off (see F6/A-5 note).
  - Confidence: HIGH — confirmed by direct hit-testing before and after, not by reasoning alone.
  - Blind spot: Not re-tested inside the running app with real data; re-run manual criterion 4.7 by tapping the customer name specifically, not the card edge.
- **Decision**: FIXED — dropped `relative z-10` from both content columns and the error `<p>`; button keeps its own `relative z-10`.

### F2 — A concurrently-moved row can 404 instead of 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/appointments.ts:342-343
- **Detail**: On the zero-rows path the service re-reads with `getAppointmentDetail()`, which funnels through `toDayPlanEntry()` and returns `null` when a `customers`/`services`/`bays` join is incomplete (`:230`). A row that exists, is visible to the caller, and merely moved underneath them is therefore reported as `not_found` → **404 "Nie znaleziono wizyty"**, and the client rolls back instead of resyncing. This is the same class of defect the `updated` branch was deliberately written to avoid — its comment at `:347-350` explains exactly why an incomplete join must not be allowed to change the outcome — applied one branch earlier.
- **Fix**: On the zero-row path query existence directly rather than reusing the joined detail read: `.from("appointments").select("status").eq("id", id).maybeSingle()`. This branch asks about existence, not presentation, so it should not depend on the joins.
  - Strength: Removes the coupling to `toDayPlanEntry`'s null contract, and is cheaper than the current detail query on a path that already costs a second round trip.
  - Tradeoff: A second place in the file that knows how to read a row's status.
  - Confidence: MEDIUM — the plan explicitly chose `getAppointmentDetail` for its "never leaks existence" posture; a direct select must stay RLS-scoped (it does — same anon client, same policies) to preserve that.
  - Blind spot: How often joins are actually incomplete in practice is unknown; `toDayPlanEntry`'s `console.warn` is the only signal today.
- **Decision**: FIXED — the zero-row path now reads `status` directly via `.select("status").eq("id", id).maybeSingle()`, with the read error rethrown.

### F3 — Illegal-transition 400 is routed by sniffing an error message string

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/api/appointment-status/[id].ts:42, src/lib/services/appointments.ts:317-318
- **Detail**: The service throws `` new Error(`Illegal status transition: ${from} -> ${status}`) `` and the route recovers the case with `error.message.startsWith("Illegal status transition")`. Control flow crosses a module boundary through a duplicated string literal, with no test pinning it. This path is reachable in production, not merely defensive: the zod schema happily accepts `{ status: "done", from: "done" }`, which `isTransitionAllowed` rejects. Reword the throw and a legitimate 400 silently becomes a 500. Every other outcome of this function is already a discriminated union arm that the route switches over exhaustively.
- **Fix**: Add `| { status: "illegal" }` to `StatusChangeOutcome` and return it instead of throwing. The route's `switch` then enforces handling at compile time, and the `catch` goes back to covering genuinely unexpected errors only.
  - Strength: Uses the mechanism the rest of this function already established; makes the compiler, not a string, the guarantee.
  - Tradeoff: Touches the service signature and the route switch — slightly wider than a local patch.
  - Confidence: HIGH — the union and the exhaustive switch already exist; this is one more arm.
  - Blind spot: None significant.
- **Decision**: FIXED — added `| { status: "illegal" }`, returned instead of thrown; the route handles it as a 400 in the switch and the `catch` is back to unexpected errors only.

### F4 — Doc comment claims a compile-time guarantee that does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/appointment-transitions.ts:26-36
- **Detail**: The comment states that "`cancelled` is handled explicitly rather than by omission, so a sixth enum value later surfaces as a type error here." For `isTransitionAllowed` this is false — the body is an if-chain ending in a catch-all `return true`, so a sixth `appointment_status` value would compile cleanly and silently become a legal transition target in both directions. The exhaustiveness guarantee genuinely belongs to `nextStatus` above it, whose `switch` plus `AppointmentStatus | null` annotation does fail to compile. The plan asked for a `Record<AppointmentStatus, …>` shape here (Phase 1 §1) and it was not used. The file's comment discipline is otherwise excellent, which is what makes this one harmful: it tells a maintainer the compiler has their back when it does not.
- **Fix**: Either restructure `isTransitionAllowed` as a `switch (from)` with a `satisfies never` default so the claim becomes true, or move the claim onto `nextStatus` and state plainly that `isTransitionAllowed` is a runtime check.
  - Strength: Restoring the invariant is the point of the plan's `Record` instruction and matches `APPOINTMENT_STATUS_PRESENTATION`'s established shape.
  - Tradeoff: The restructure is more code than the current three lines for a rule that is genuinely simple.
  - Confidence: HIGH — verified by reading the body against the comment.
  - Blind spot: None significant.
- **Decision**: FIXED — restructured as an `IS_MUTABLE: Record<AppointmentStatus, boolean>` lookup, so a sixth enum value is now a genuine compile error; comment corrected to match.

### F5 — A redundant concurrent advance shows a red error for an operation that succeeded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/appointments.ts:336-345
- **Detail**: Two workers tapping "W trakcie" on the same card: the second one's compare-and-set matches zero rows, the re-read returns `current === "in_progress"` — exactly what they asked for — and the API still answers 409 "Ktoś inny właśnie zmienił status tej wizyty". The UI resyncs to the correct state and then displays a failure message for an operation whose desired outcome holds. On a shared day-plan screen (the whole premise of this slice) this is the *common* concurrency case, not the rare one.
- **Fix**: When the re-read's `current` equals `input.status`, return `{ status: "updated", current, entry: null }` — the operation is idempotent and the target state is satisfied.
  - Strength: Removes a false-alarm error from the most likely multi-user path; the route already handles a null `entry` on the 200 branch.
  - Tradeoff: A 200 that did not itself write the row; arguably worth distinguishing for auditing later.
  - Confidence: MEDIUM — depends on whether you want "someone else got there first" surfaced even when harmless. Reasonable people differ.
  - Blind spot: Not covered by any test today (see F7).
- **Decision**: FIXED — when the re-read's `current` equals `input.status`, the service now returns `updated` (idempotent success) instead of `stale`.

### F6 — Accessibility gaps across both new surfaces

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/appointments/DayPlanBoard.tsx:243,235-244,247; src/components/appointments/AppointmentStatusPanel.tsx:78-92,96
- **Detail**: Four related gaps in the new interactive surfaces:
  1. `DayPlanBoard.tsx:243` — the pending state replaces the button's entire accessible name with `"…"`, so activating it renames the control rather than announcing progress.
  2. `DayPlanBoard.tsx:235-244` — every row's advance button has the identical accessible name ("W trakcie" / "Gotowe") with nothing tying it to an appointment; a 12-row day plan reads as "Gotowe, button" twelve times. The sibling `<a>` got this right (`aria-label={...customerFirstName}`, `:212`); the button did not.
  3. `DayPlanBoard.tsx:247` and `AppointmentStatusPanel.tsx:96` — both error surfaces are plain `<p>` with no live region, so the 409 "someone else changed this" message (the entire point of the compare-and-set design) is never announced; the status silently changes with no explanation.
  4. `AppointmentStatusPanel.tsx:78-92` — the current step is conveyed only by `bg-amber-100 ring-2` styling while also being `disabled`, so a screen reader cannot distinguish "you are here" from "illegal target".
- **Fix**: Keep the label rendered and add `aria-busy={pending}`; give each advance button an `aria-label` including the customer and time; add `role="status" aria-live="polite"` to both error paragraphs; add `aria-current="step"` to the active step and `role="group" aria-label="Status wizyty"` to the grid.
  - Strength: All four are additive attribute changes with no layout or behavioral risk.
  - Tradeoff: None material; adds some verbosity to the JSX.
  - Confidence: HIGH — read directly from the rendered markup.
  - Blind spot: Not tested with an actual screen reader; the repo has no a11y tooling wired.
- **Decision**: FIXED — all four: label kept with `aria-busy` (opacity moved into `cn()`), per-row `aria-label` with customer + time, `role="status" aria-live="polite"` on both error paragraphs, `aria-current="step"` on the active step and `role="group" aria-label="Status wizyty"` on the grid.

### F7 — The riskiest new logic in the slice carries no unit test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/lib/services/appointments.ts:312-352
- **Detail**: `changeAppointmentStatus` holds the compare-and-set zero-row disambiguation, the `23P01` → `slot_taken` mapping, and the "UPDATE committed but `toDayPlanEntry` returned null" branch — the three pieces of reasoning the plan spends the most words justifying. None is unit-tested. `appointment-transitions.test.ts` covers only the pure rules module; the pgTAP block proves the *database* behaves, not that this function maps its behavior onto the right outcome. F2 and F5 are both defects in exactly this untested region, which is the practical demonstration of the gap. The project is already willing to stub a boundary — `useJsonMutation.test.ts` does it with `vi.stubGlobal("fetch")`.
- **Fix**: Add `src/lib/services/appointments.test.ts` with a hand-rolled `TypedSupabaseClient` builder stub asserting all four `StatusChangeOutcome` variants.
  - Strength: Cheap (no new dependency, no DOM), and pins the branches this review found two bugs in.
  - Tradeoff: A fake query-builder chain is somewhat brittle against Supabase client API changes.
  - Confidence: MEDIUM — the stub shape is straightforward but nothing like it exists in the repo yet to copy.
  - Blind spot: Would not have caught F1, which is a CSS/DOM issue.
- **Decision**: FIXED — added `src/lib/services/appointments.test.ts`, 10 tests covering all five `StatusChangeOutcome` arms plus both rethrow paths. Verified non-vacuous by mutation: disabling the F5 idempotent branch fails the corresponding test.

### F8 — `recentlyChanged` is never cleared on rollback

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/appointments/DayPlanBoard.tsx:67,87
- **Detail**: The pinning set is only cleared by `changeFilter` (`:76-79`). A row that was advanced and then rolled back (network failure) stays pinned, so under an active status filter a card that no longer matches the filter remains on screen showing its reverted status. The pinning mechanism itself is otherwise implemented exactly as the plan specified, including the render-site-only union that leaves `filterByStatus`/`countByStatus` untouched.
- **Fix**: Remove the id from `recentlyChanged` inside the `rollback` callback.
- **Decision**: FIXED — `rollback` now deletes the row's id from `recentlyChanged`.

### F9 — pgTAP suite is not hermetic; the new block adds a fixed-timestamp collision surface

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_workshop_scope.test.sql:539-597
- **Detail**: `npm run db:test` currently fails 6/54 on this machine. **This is not a regression from the slice** — all 6 new S-04 assertions pass, `plan(54)` matches the actual assertion count exactly (48 + 6, arithmetic verified), and the file rolls back cleanly. The failures are pre-existing S-02 assertions (27-28, 32-33, 35-36) that assert absolute counts of `1` while the local database holds leftovers from manual dev use: one appointment (`no_show`, created 2026-08-24 19:47, during Phase 4 manual verification) and two customers, where `seed.sql` creates neither. `npm run db:reset` restores green, and README already documents reset-before-test.

  The new block inherits that fragility and adds to it: it books a hardcoded `'2026-09-08 09:00'` into `(select ... limit 1)` bay and service, so a developer row at that slot would turn the `lives_ok` at `:543` into a spurious `23P01` failure. The unordered `limit 1` also makes fixture selection nondeterministic.
- **Fix**: Derive the S-04 block's timestamp from `max(starts_at) + interval` (or a deliberately absurd year), and add `order by` to the `limit 1` fixture selects. Separately, open a follow-up to make the pre-existing count assertions relative to a measured baseline.
  - Strength: Makes a red `db:test` mean something again; today it carries no signal after any manual UI testing.
  - Tradeoff: The baseline-relative rewrite touches pre-existing assertions outside this slice's scope.
  - Confidence: HIGH — cause confirmed by direct query against the local database.
  - Blind spot: None significant.
- **Decision**: FIXED (both halves) — added a per-workshop `pg_temp.baseline` table captured before any booking plus a `pg_temp.baseline_of()` helper, and rewrote all six absolute count assertions (including the `try_worker_update_appointment_status` row-count) as `baseline + 1`. The S-04 block now books into a slot offset `interval '520 weeks'` from the S-02 fixture date (whole weeks, so the weekday and working hours are unchanged) and orders every `limit 1` fixture select by `id`. `npm run db:test` now passes **54/54 against the un-reset local database** that previously failed 6.

### F10 — `IN_SCOPE_STATUSES` is not tied to the generated enum

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/schemas/appointment.ts:22
- **Detail**: `const IN_SCOPE_STATUSES = ["waiting", "in_progress", "done", "no_show"] as const;` is the boundary that keeps `cancelled` unreachable through the API — deliberately a standalone literal tuple per the plan, which is correct. But it has no type relationship to `Database["public"]["Enums"]["appointment_status"]`, so an enum *rename* would regenerate `database.types.ts` cleanly and leave this file compiling but wrong. Contrast `APPOINTMENT_STATUS_PRESENTATION` (`src/lib/appointment-status.ts:15`), which is a `Record<AppointmentStatus, …>` precisely so a change fails the build.
- **Fix**: `] as const satisfies readonly AppointmentStatus[];` — keeps the four-literal narrowing while making a rename a compile error.
- **Decision**: FIXED — added the `satisfies readonly AppointmentStatus[]` constraint and the `AppointmentStatus` type import.

## Also noted, not itemized

Minor and non-blocking: `DayPlanBoard.advance` lacks the re-entrancy guard its sibling `AppointmentStatusPanel.changeStatus` has (`:38`) and relies on `disabled` alone; the empty state tests `entries.length === 0` rather than `visible.length === 0` (pre-existing), so a filter matching nothing renders a bare container; `AppointmentStatusPanel` is a named export while the other page-level islands are default exports; the two new components disagree on floating-promise style in `onClick`; and the 200 response has two possible body shapes (`DayPlanEntry` vs `{ id, status }`), latent today since both callers discard the body.

## What was verified clean

- **Scope discipline is exemplary.** Zero extra source changes. Every item in "What We're NOT Doing" is respected — `git diff 3789879..HEAD -- supabase/migrations src/db/database.types.ts` is empty, `README.md` is untouched, no e2e harness, no notes field, no customer history panel, no DB trigger, no owner slot override.
- **Authorization model holds.** `matchRoute`'s `pathname === prefix || pathname.startsWith(prefix + "/")` means `/api/appointment-status` is not a prefix of `/api/appointments`, so the booking API stays owner-only; the new guard tests pin exactly this. `cancelled` is unreachable through two independent locks (schema enum + `isTransitionAllowed`). No RLS bypass — the service uses the cookie-scoped anon client, and no `service_role` client exists in the repo. Cross-workshop ids are indistinguishable from nonexistent ones (both 404). The raw `23P01` DETAIL is never forwarded.
- **The `grant update (status)` narrowing is confirmed live** — verified against the running database, UPDATE is column-scoped to `status` alone. (An agent flagged the table-wide grant from `20260821090000`; that migration is superseded by `20260821151500_appointments_update_status_only.sql`. Not a finding.)
- **React state handling is sound.** Props-seeded `useState` in both islands never resyncs, but every navigation is a full document load (real `<a href>`, and no `ClientRouter`/`astro:transitions` anywhere in `src/layouts` or `src/pages`), so both islands remount with fresh props. Worth remembering: adopting `<ClientRouter />` later would silently turn both into stale-state bugs. No mutation-instead-of-copy anywhere; all `setEntries` calls are functional.
- **AGENTS.md hard rules all satisfied** — `prerender = false`, uppercase `PATCH`, zod on every input (including `params.id`, stricter than the `bays/[id].ts` precedent), `cn()` throughout, no Next.js directives, route access only in the guard table, no new `Date` local-field accessors.
- **Contract adherence is otherwise near-total.** Every one of the plan's 14 file contracts matched except the F1 stacking detail, including the `NewAppointmentForm.tsx` stale-comment cleanup the plan asked for as an aside.
