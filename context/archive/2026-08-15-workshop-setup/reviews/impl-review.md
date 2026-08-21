<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Workshop Setup (S-01)

- **Plan**: `context/changes/workshop-setup/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-08-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 7 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Automated verification (re-run 2026-08-20)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors, 0 warnings (48 files) |
| `npm run lint` | PASS — 0 errors, 7 `no-console` warnings |
| `npm run build` | PASS |
| `npm run db:reset` | PASS — all 4 migrations apply from scratch |
| `npm run db:test` | PASS — 26/26 pgTAP assertions |
| `npm run db:types && git diff --exit-code` | PASS — drift-free |
| `grep -rn "No database tables or migrations" README.md` | PASS — no hits |

## Plan adherence summary

Every item in all five phases' "Changes Required" verified as MATCH except where noted in F6 below.
Schema, grant/policy symmetry (no DELETE grant anywhere, no INSERT on `working_hours`), seeding
idempotency, backfill placement, default-data exactness, route table entries, the `/api/` JSON guard
branch, AppShell's two deliberate brochure deviations, the 5-minute stepper floor, and all Phase 5
doc edits are faithful to the contract. No planned file is missing; no unplanned source file appeared.
No violation of "What We're NOT Doing" was found.

## Findings

### F1 — Unguarded index on an optional field-error key throws in the failure path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/settings/WorkingHours.tsx:54 (also ServiceDurations.tsx:90, WorkshopDetailsForm.tsx:39)
- **Detail**: `body?.errors?.opens_at[0]` optional-chains `errors` but indexes `opens_at` unguarded.
  `flattenError().fieldErrors` only carries keys that actually failed. Repro: on `/ustawienia`, clear
  Monday's *closing* time and save — the body is `{opens_at:"07:00",closes_at:"",is_closed:false}`,
  `closes_at` fails `.min(1)`, and because a zod object's `.refine` does not run when the inner parse
  fails, the response is `{"errors":{"closes_at":[…]}}` with no `opens_at` key. `undefined[0]` throws a
  TypeError inside `save()`, which has no try/catch → unhandled rejection, `setRowErrors` never runs,
  the user sees a silent revert with no message. `useJsonMutation.ts:9` types `errors` as
  `Record<string, string[]>`, which is why the compiler permits all three sites.
- **Fix**: Use `?.[0]` at all three sites and change the hook's type to
  `Record<string, string[] | undefined>` so the compiler enforces it; prefer showing the first error of
  any returned field rather than one hard-coded key.
  - Strength: Directly restores the Phase 4 contract ("surfacing the server's field-keyed error next to the offending input") and the type change prevents recurrence at every future call site.
  - Tradeoff: None — four one-line edits.
  - Confidence: HIGH — reproduced from the code path; the other two sites are latent only because those requests carry a single field.
  - Blind spot: None significant.
- **Decision**: FIXED — `useJsonMutation.ts` type widened to `Record<string, string[] | undefined>`, `firstFieldError()` helper added and used by `useRowMutation`; `WorkshopDetailsForm.tsx` uses `?.[0]`.

### F2 — Four hand-rolled fetch paths: no try/catch, silent failure, stale snapshot rollback

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/components/settings/Bays.tsx:15-28, ServiceDurations.tsx:69-93 and :95-108, WorkingHours.tsx:35-57
- **Detail**: Three defects share one root cause — these four mutations bypass `useJsonMutation`, the
  hook written for exactly this pattern (the two add-forms and `WorkshopDetailsForm` do use it).
  (a) No `try/catch` around `fetch`: offline or a Worker error rejects a promise from an un-awaited
  `onClick`, so the row stays optimistically removed while nothing was persisted. In
  `adjustDuration`, `setPendingId(null)` sits after the `await` with no `finally`, so a rejection
  leaves that stepper **permanently disabled** until reload.
  (b) Whole-list snapshot rollback: `const previous = bays` with no in-flight guard. Deactivate bay1,
  then bay2; bay1 succeeds and bay2 fails → `setBays(previous₂)` puts **bay1 back in the UI** even
  though it was successfully deactivated.
  (c) `pendingId` is a single id for the whole list, so `setPendingId(null)` on any response
  re-enables a *different* row whose PATCH is still in flight, allowing overlapping writes with no
  sequencing — UI shows 40 while the DB holds 35.
  Both `deactivate` functions also surface no error at all on failure.
- **Fix A ⭐ Recommended**: Route all four through `useJsonMutation` (which already has try/catch/finally and an error object), and replace snapshot rollback with functional updates (`setBays(prev => …)`).
  - Strength: Removes all three defects at once, and converges the island on the single mutation pattern the hook exists to provide — the convention S-02–S-06 will copy.
  - Tradeoff: Touches four functions; the per-row pending state still needs widening to a `Set<string>` separately.
  - Confidence: HIGH — the three files already using the hook demonstrate the target shape.
  - Blind spot: Haven't verified the hook's error object carries everything the row-level error UI needs for the working-hours case.
- **Fix B**: Add `try/catch/finally` and functional rollback in place, leaving the four call sites hand-rolled.
  - Strength: Smallest diff; no restructuring of working code.
  - Tradeoff: Leaves the duplication that caused the divergence, so the next slice can reintroduce it.
  - Confidence: HIGH — mechanical change.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — added `useRowMutation` (keyed pending/error state, functional rollback) to `useJsonMutation.ts`; `Bays.tsx`, `ServiceDurations.tsx`, `WorkingHours.tsx` now route all four mutations through it.

### F3 — Working-hours row state never re-syncs, so the rollback is invisible

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/settings/WorkingHours.tsx:98-100
- **Detail**: `WorkingHoursRowItem` seeds `isClosed`/`opensAt`/`closesAt` into its own `useState` from
  the `row` prop, and the list is keyed by `weekday`. When the parent reverts `hours` after a failed
  save, the child never re-mounts and never re-syncs — the inputs keep showing the rejected values
  while parent state says otherwise. The rollback is real in state but never reaches the screen.
- **Fix**: Key the row on a version counter that changes on revert, or lift the draft state into the parent so there is one source of truth.
- **Decision**: FIXED — draft state lifted into `WorkingHours` parent (`drafts` map, one source of truth); `WorkingHoursRowItem` is now a pure display component driven by props.

### F4 — `working_hours` window invariant exists only in zod, not in the schema

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260815183000_workshop_configuration.sql:44-54
- **Detail**: Verified against the live schema — `working_hours` carries only `working_hours_pkey`,
  `working_hours_weekday_range`, the FK, and `working_hours_workshop_weekday_unique`. There is no
  constraint tying `opens_at`/`closes_at`/`is_closed` together, so the invariant lives solely in
  `workingHoursUpdateSchema`'s `.refine`. `services` got `services_duration_min_positive` for exactly
  this class of rule, so the rigor is inconsistent. Anything writing outside the PUT route (Studio, a
  future endpoint, a repair script) can persist `opens_at > closes_at`, or `is_closed = false` with
  both times null — and S-02's slot-suggestion algorithm reads this table directly and would treat
  that as a valid window.
- **Fix A ⭐ Recommended**: Add a follow-up migration with
  `check ((is_closed and opens_at is null and closes_at is null) or (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at))`.
  - Strength: Puts the invariant on the surface S-02 actually reads, matching the precedent `services` already sets; the seeded defaults already satisfy it, so the backfill needs no repair.
  - Tradeoff: A new migration to push to production; must confirm no existing row violates it first.
  - Confidence: HIGH — checked the live constraint set; seeded data conforms.
  - Blind spot: Production rows edited by hand since the deploy haven't been checked against the predicate.
- **Fix B**: Leave the invariant in the app layer and add it to S-02's plan as a precondition to verify when the slot algorithm lands.
  - Strength: No schema change to ship now; S-01 is already deployed and green.
  - Tradeoff: The gap is only closed if S-02 remembers; every non-route writer stays unconstrained.
  - Confidence: MEDIUM — depends on the S-02 plan actually carrying it forward.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A) — `supabase/migrations/20260820120000_working_hours_window_check.sql` adds `working_hours_window_valid`; `db:reset`/`db:test` re-verified green.

### F5 — Time strings aren't format-validated: 500 instead of 400, and an unsound `<` comparison

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas/workshop-setup.ts:37-44
- **Detail**: `opens_at`/`closes_at` are validated only with `.trim().min(1)`. Two consequences:
  (1) `{"opens_at":"abc","closes_at":"zzz","is_closed":false}` passes both `.min(1)` and the
  lexicographic refine, reaches Postgres, and fails with `22007 invalid input syntax for type time` —
  which `src/pages/api/working-hours/[weekday].ts:29` turns into a **500** instead of the contracted
  400. (2) The `<` comparison is only sound for zero-padded `HH:MM`; `"9:00" < "10:00"` is `false`, so
  a legitimately-formatted non-padded time is rejected with a misleading message.
- **Fix**: Add `.regex(/^([01]\d|2[0-3]):[0-5]\d$/)` to both fields — this makes the string comparison sound and moves the failure from a 500 to a field-keyed 400.
- **Decision**: FIXED — `TIME_HH_MM` regex added to `opens_at`/`closes_at` in `workingHoursUpdateSchema`.

### F6 — Profile-less session still receives a 302 on `/api/*`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/middleware.ts:33-37
- **Detail**: The plan's Critical Implementation Details state flatly that "`/api/` paths must not
  receive a 302", and the guard branch at :50-58 implements that correctly. But the earlier
  "authenticated but no profile row" branch still returns `context.redirect(...)` for every path,
  `/api/*` included. A profile-less session calling `PATCH /api/workshop` gets a followed 302 → HTML →
  the exact JSON-parse failure the plan set out to eliminate. Structurally rare — the
  `on_auth_user_created` trigger guarantees a profile — but it is the one uncovered 302-to-API path,
  and the trigger kill-switch in the README is a documented scenario that produces exactly this state.
- **Fix**: Reuse the same `pathname.startsWith("/api/")` JSON return in that branch, answering `401` after the sign-out.
- **Decision**: FIXED — `src/middleware.ts` now returns `401` JSON for `/api/*` in the profile-less branch before the sign-out redirect.

### F7 — `class:list` built by template-literal concatenation (AGENTS.md hard-rule violation)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/AppShell.astro:69-71
- **Detail**: `class:list={`flex h-9 w-9 … ${active === label ? "bg-orange-500 text-white" : "…"}`}`
  concatenates Tailwind classes manually. AGENTS.md Hard Rules: "Use `cn()` from `@/lib/utils` for all
  Tailwind class merging — never concatenate class strings manually." Every `.tsx` in this change
  complies (`Bays.tsx:100`, `WorkshopDetailsForm.tsx:52`, `ServiceDurations.tsx:197`); this is the only
  holdout, and it sits in the shared shell that S-02–S-06 all inherit.
- **Fix**: `class:list={cn("flex h-9 w-9 …", active === label ? "bg-orange-500 text-white" : "text-slate-400 …")}` — `cn` imports into Astro frontmatter exactly as it does into React.
- **Decision**: FIXED — `AppShell.astro` imports `cn` and builds `class:list` with it.

### F8 — Not-found and empty-PATCH bodies surface as 500

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/workshop-setup.ts:71, :90; src/lib/schemas/workshop-setup.ts:14-18, :25-33
- **Detail**: Two paths that should be 4xx return 5xx. (1) `.eq("id", id).select().single()` against a
  row belonging to another workshop is filtered by RLS → 0 rows → `PGRST116` → the route logs
  `console.error` and returns **500** for what is really a 404. No data leaks (RLS holds), but every
  probe writes an alarming log line. (2) Every field in `bayUpdateSchema`/`serviceUpdateSchema` is
  optional, so `{}` parses, `.update({})` reaches PostgREST, PostgREST rejects it, and the route
  converts that to a 500 as well.
- **Fix**: Use `.maybeSingle()` and return 404 when `data` is null; add `.refine(v => Object.keys(v).length > 0)` to both update schemas.
  - Strength: Correct status codes for the two most likely malformed requests, and quieter logs; sets the error-mapping convention the S-02+ routes will copy.
  - Tradeoff: Touches all four write functions and both update schemas.
  - Confidence: MEDIUM — `PGRST116` behavior inferred from `.single()` semantics, not reproduced against a live cross-workshop id.
  - Blind spot: Haven't confirmed PostgREST's exact status for an empty update body.
- **Decision**: FIXED — `updateBay`/`updateService`/`updateWorkingHours` use `.maybeSingle()`, routes return 404 on `null`; `bayUpdateSchema`/`serviceUpdateSchema` refined to reject an empty object.

### F9 — API routes omit `Content-Type: application/json`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: all six routes under src/pages/api/ (workshop.ts, bays/*, services/*, working-hours/*)
- **Detail**: All twelve responses are `new Response(JSON.stringify(...), { status })` with no headers,
  so Workers serves them as `text/plain;charset=UTF-8`. The one existing JSON-emitting precedent,
  `src/middleware.ts:53-56`, sets the header correctly — so the same request is answered with two
  different content types depending on whether the middleware or the route rejected it. Harmless today
  (`res.json()` ignores the header), but it is the convention S-02–S-06 will copy.
- **Fix**: Use `Response.json(body, { status })` throughout, or add the header explicitly.
- **Decision**: FIXED — all six route files under `src/pages/api/` use `Response.json(...)`.

## Also noted, not raised as findings

- **Benign EXTRA**: `revoke execute on function public.seed_workshop_defaults(uuid) from public, anon, authenticated` (migration #2:59) is unplanned hardening in the right direction. Worth keeping.
- **Perf**: `currentWorkshopId()` costs an extra Supabase round trip per write even though `src/middleware.ts:41-45` already resolved `profile.workshopId` on the same request. Two hops per mutation from a Worker; nowhere near the 2-second NFR at this scale.
- **Trigger hardening**: `seed_workshop_defaults()` is correctly idempotent and free of anything that can raise, as the plan required. But the `perform` runs inside the signup transaction with no exception handler, so any *future* constraint added to these tables becomes "Database error saving new user" for every signup. Wrapping it in `begin … exception when others then raise warning …; end;` would degrade that to "workshop without defaults". Out of scope for this slice; worth carrying into S-02.
- **Input caps**: no `.max()` on any text field and no length constraint on `bays.name`/`services.name`/`workshops.name`. Acceptable at MVP scale for an owner-only surface.
