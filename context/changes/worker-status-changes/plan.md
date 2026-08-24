# Worker Status Changes (S-04) Implementation Plan

## Overview

Give a worker (and the owner) a way to move an appointment through its lifecycle — `waiting → in_progress → done`, or `→ no_show` — from two surfaces: a one-tap forward button on the day-plan card, and the brochure's full "Szybka zmiana statusu" block on the visit detail page. The rule that decides which moves are legal lives in one tested pure module both surfaces import; the write goes through a single worker-reachable `PATCH` endpoint.

This is roadmap slice **S-04** (`context/foundation/roadmap.md:138-151`), covering **FR-007** (worker changes status) and the slot-release half of **FR-005**.

## Current State Analysis

The database layer for this slice already shipped with S-02 and needs **no changes**:

- `public.appointment_status` defines all five values, deliberately including the ones only S-04 writes (`supabase/migrations/20260821090000_appointments_and_customers.sql:21`).
- `appointments_update_own_workshop` lets **both roles** update a row in their own workshop (`:97-101`), and the migration's own comment names the reason: "S-04's whole point is that a worker changes status."
- The UPDATE grant is already narrowed to exactly the column this slice writes: `grant update (status) on public.appointments to authenticated` (`supabase/migrations/20260821151500_appointments_update_status_only.sql:11`). Nothing needs widening — that migration's "S-04 widens it again if a later status-change flow needs more" does not apply, because this slice writes only `status`.
- **FR-005's slot release is already implemented.** The overlap guard is a *partial* exclusion constraint, `where (status not in ('cancelled', 'no_show'))` (`:56-61`), so moving a row to `no_show` frees its bay window while the row stays in history.
- pgTAP already asserts a worker can update status and cannot rewrite `bay_id` (`supabase/tests/rls_workshop_scope.test.sql:383-392`).

What is missing sits entirely above the database:

- **No write path.** `src/lib/services/appointments.ts` has no update function past `bookAppointment()`; `src/lib/schemas/appointment.ts` has no status-change schema; there is no status API route.
- **The guard table locks workers out of the appointment API.** `["/api/appointments", "owner"]` (`src/lib/auth-guard.ts:19`), matched by prefix (`:25`). Because the id sits mid-path, a nested `/api/appointments/<id>/status` cannot be exempted without changing the matcher itself.
- **Both UI surfaces are static.** `src/pages/wizyty/[id].astro` renders the brochure detail card but omits the status block and the whole action sidebar; `DayPlanBoard.tsx:144` renders each row as a plain `<a>` with no action affordance.

## Desired End State

A worker signs in, lands on `/dashboard`, and can advance any appointment one status forward by tapping a single button on its card — the pill and the stat tiles update immediately, with no page reload. Tapping the card body still opens `/wizyty/<id>`, where a three-step "Szybka zmiana statusu" grid shows the current position in the flow, a rose **Nie przyjechał** button marks a no-show (releasing the bay window), and a slate **Zadzwoń** button dials the customer. Any status reachable in the UI can also be walked back from the detail page; when that is impossible — the slot was re-booked, or someone else moved the row first — the UI says so in Polish instead of silently reverting.

Verify by: signing in as a worker, advancing an appointment on the day plan and watching the tiles change without a reload; opening the detail page and walking a `done` appointment back to `waiting`; marking a `no_show` and confirming the freed slot reappears in `/wizyty/nowa`'s suggestions.

### Key Discoveries:

- No migration required — see Current State Analysis. This slice ships zero `supabase/migrations/` files, so the `context/foundation/lessons.md:5` rule ("Merging is deploying — push the schema before the merge") has no trigger here.
- Two distinct 409 paths exist and must not be conflated: a **stale current status** (someone else moved the row) and a **re-taken slot** (`23P01`, reversing a `no_show`). The second reuses the exclusion-violation handling already at `src/lib/services/appointments.ts:205`.
- `useRowMutation` (`src/components/hooks/useJsonMutation.ts:106`) gives the day plan its keyed per-row pending state plus a `rollback` callback that must be a functional update touching only its own row. The day plan is a list of rows; use it, do not add a shared `isPending`. **But it cannot carry a conflict payload as it stands**: `requestJson` collapses every failure to `{ fieldErrors, message }` (`:47-56`), discarding the HTTP status and any extra body field, and `run` returns `boolean` after calling `rollback()` unconditionally (`:122-129`). `NewAppointmentForm.tsx:88-89` hand-rolled its own `fetch` for exactly this reason. Phase 1 extends the transport so both new surfaces can read a 409's `current` — see Phase 1 §4.
- The brochure reference is `~/Code/wulkanizator-go-brochure/src/App.jsx:478-538` (`VisitDetailScreen`): a 3-column step grid where the active step is `bg-amber-100 ring-2 ring-amber-200` and the rest are `bg-white ring-1 ring-slate-100`, each carrying an icon, a label, and a note line; the sidebar is a `xl:grid-cols-[1fr_300px]` column holding **Zadzwoń** (`bg-slate-900`), the primary action (`bg-orange-500`), and **Nie przyjechał** (`border-rose-200 bg-rose-50 text-rose-700`).
- `APPOINTMENT_STATUS_PRESENTATION` (`src/lib/appointment-status.ts:14`) is a `Record<AppointmentStatus, …>` on purpose — a new enum value fails the build there rather than falling through. Any new status-keyed map in this slice follows the same shape.
- Naive wall-clock discipline (`AGENTS.md`, `src/lib/workshop-clock.ts`) is untouched by this slice: no code here reads or writes a timestamp.

## What We're NOT Doing

- **No `cancelled` status in the UI.** It stays enum-only and filtered out of the day plan (`appointments.ts:272`). FR-007 names exactly four states.
- **No customer history panel** on the detail page — it needs a per-customer query that belongs to S-05, and walk-ins currently get a fresh `customers` row per booking, so it would render empty.
- **No notes field** (`Notatki dla warsztatu` in the brochure) — no FR covers it and it needs a new column.
- **No database trigger** enforcing transitions. Enforcement is app-level, at the API boundary.
- **No manual slot override** for the owner — parked in `roadmap.md:208`.
- **No schema migration, no `npm run db:types` regeneration** — nothing about the schema changes.
- **No e2e harness.** Module 3 owns that.
- **No README route-table edit.** The "Auth routes" table (`README.md:145-153`) documents user-facing pages; none of the five `/api/*` prefixes already in `ROUTE_ACCESS` appear there, and adding only the sixth would be worse drift than adding none. `README.md:155` already names `src/lib/auth-guard.ts` as the source of truth, and `context/foundation/lessons.md:12` fires on a *deleted or renamed* symbol — this slice only adds one. Documenting all six `/api/*` routes is a standalone docs change if the user wants it.

## Implementation Approach

One pure module owns the transition rules and is imported by every consumer — the two UI surfaces use it to decide which buttons are live, and the service uses it to reject an illegal move. The write is a **compare-and-set**: the client sends both the target status and the status it believes the row currently holds, and the update is scoped `where id = ? and status = <from>`. Zero affected rows means the row moved underneath the caller, which surfaces as a 409 carrying the true current status rather than a silent overwrite. This also removes the need for a read-then-write round trip.

The endpoint is a **sibling route**, `PATCH /api/appointment-status/[id]`, with its own `["/api/appointment-status", "any"]` entry in the guard table. This keeps `src/lib/auth-guard.ts`'s matcher the dumb, auditable prefix table `AGENTS.md` describes, and keeps `/api/appointments` (booking) sealed to owners.

Both UI surfaces update optimistically and roll back on failure, per `useRowMutation`'s established contract.

## Critical Implementation Details

**Nested interactive elements.** The day-plan row is currently an `<a>` wrapping the entire card (`DayPlanBoard.tsx:144-171`). A `<button>` nested inside an `<a>` is invalid HTML and its click is swallowed by the link. The row must be restructured so the navigation link and the status button are siblings — either a stretched-link overlay (`<a class="absolute inset-0">` at the base, action button `relative z-10`) or a dedicated action column. Either is acceptable; a nested button is not.

**Ordering within a phase.** Phase 4 changes `DayPlanBoard`'s `entries` from a render-only prop into local state seeded from the prop. `countByStatus` and `filterByStatus` are already pure functions over that array (`src/lib/services/day-plan.ts:44,57`), so both derive correctly from the new state with no changes — recompute from state on every render rather than mirroring counts in a second `useState`.

---

## Phase 1: Transition rules, request schema, and mutation transport

### Overview

Land the rule that decides which status moves are legal as a pure, fully-tested module, the zod schema for the request body, and the transport change both UI surfaces need in order to read a 409's payload. Nothing is wired to any of it yet — this phase ships logic, tests, and plumbing only.

### Changes Required:

#### 1. Transition rules module

**File**: `src/lib/services/appointment-transitions.ts`

**Intent**: The single source of truth for "which status can follow which", imported by the API (to reject an illegal move) and by both UI surfaces (to decide which buttons are live and which step is active). Pure — no Supabase import — so it is testable in Vitest like `day-plan.ts` and `slot-suggestions.ts` beside it.

**Contract**: Three exports.

- `FORWARD_STEPS: readonly AppointmentStatus[]` — `["waiting", "in_progress", "done"]`, the ordered spine the detail page's 3-button grid renders and the day plan advances along.
- `nextStatus(current: AppointmentStatus): AppointmentStatus | null` — the guided one-tap step. `waiting → "in_progress"`, `in_progress → "done"`, and `null` for `done`, `no_show`, and `cancelled` (nothing forward from a terminal or out-of-scope state).
- `isTransitionAllowed(from: AppointmentStatus, to: AppointmentStatus): boolean` — the API guard. True when `from !== to`, neither side is `"cancelled"`, and both are valid enum members. This is what "reversible on the detail page" means concretely: every non-`cancelled` pair is legal except a no-op. `cancelled` is immutable in both directions so this slice can neither create nor resurrect one.

Keep `cancelled` handled explicitly rather than by omission, so adding a sixth enum value later surfaces as a type error here.

#### 2. Unit tests for the transition rules

**File**: `src/lib/services/appointment-transitions.test.ts`

**Intent**: Cover the rule table exhaustively — it is small enough to enumerate, and it is the invariant the whole slice rests on.

**Contract**: Assert `nextStatus` for all five enum values; assert `isTransitionAllowed` rejects self-transitions, rejects every pair touching `cancelled` in either direction, and accepts the backward moves the detail page depends on (`done → waiting`, `no_show → waiting`, `in_progress → waiting`).

#### 3. Status-change request schema

**File**: `src/lib/schemas/appointment.ts`

**Intent**: Validate the PATCH body at the API boundary, in the same file and style as the two existing request schemas.

**Contract**: Add `appointmentStatusChangeSchema` — an object with `status` and `from`, both `z.enum` over the four in-scope statuses (`waiting`, `in_progress`, `done`, `no_show`), each with a Polish error message matching the tone of the existing schemas. Export the inferred type as `AppointmentStatusChangeInput` and re-export it from `src/types.ts` alongside the other two request input types (`src/types.ts:44`). Deriving the enum from the four in-scope literals — not from `AppointmentStatus` — is what keeps `cancelled` unreachable through the API.

#### 4. Conflict-carrying mutation transport

**File**: `src/components/hooks/useJsonMutation.ts`

**Intent**: Let a caller inspect a failed response and decide whether to roll back, instead of always rolling back. Both new surfaces need this: a `409` carrying the row's true `current` status must resync rather than revert, and today neither the status code nor any extra body field survives `requestJson`. Additive only — the four existing callers (`Bays`, `ServiceDurations`, `WorkingHours`, `WorkshopDetailsForm`) destructure only the fields they already use and must keep compiling untouched.

**Contract**: Two additions.

- `MutationFailure` gains `status?: number` and `body?: unknown`, populated in `requestJson`'s `!res.ok` branch from `res.status` and the already-parsed `json`. `message`/`fieldErrors` keep their current meaning, so existing readers are unaffected.
- `useRowMutation`'s `handlers` gains an optional `onFailure?: (failure: MutationFailure) => boolean` — returning `true` means "handled, do not roll back". When it is absent or returns `false`, `run` calls `rollback()` exactly as it does today. The row error is still recorded either way; a handler that resyncs sets its own message.

This is plumbing, not a UI change — nothing consumes the new fields until Phase 3.

**Contract note**: `NewAppointmentForm.tsx:88-89` documents the old limitation in a comment that this change makes stale. Folding that form back onto the shared helper is out of scope, but update the comment so it stops asserting the helper can't carry a conflict payload.

#### 5. Unit tests for the mutation transport

**File**: `src/components/hooks/useJsonMutation.test.ts`

**Intent**: Pin the half of §4 the whole 409-resync behavior rests on — that a conflict response's status and body reach the caller instead of being flattened into a message. Without this, a future refactor of `requestJson` can silently restore the old lossy shape and both UI surfaces quietly revert to rollback-on-409, which is exactly the regression §4 exists to prevent.

**Contract**: A new test file covering `requestJson` only — it is a plain exported async function, so it runs in the existing node environment with no new dependency. Stub `fetch` with `vi.stubGlobal` (restore in `afterEach`) and assert:

- A `409` whose body is `{ error: "…", current: "in_progress" }` resolves to `{ ok: false }` with `failure.status === 409` and `failure.body` carrying `current` — the case Phase 3 and Phase 4 read.
- A `400` whose body is `{ errors: { status: ["…"] } }` still populates `failure.fieldErrors` and `failure.message` as before, so the four existing callers' behavior is unchanged.
- A response with an unparseable body still yields the default `"Coś poszło nie tak. Spróbuj ponownie."` message with `status` set — the `json()` catch path at `useJsonMutation.ts:45` must not be broken by reading `res.status`.
- A thrown `fetch` (network failure) still yields `"Nie udało się połączyć z serwerem."` with no `status`.

**Contract note on what this does not cover**: `useRowMutation`'s `onFailure`-suppresses-rollback branch is *not* unit-tested. `run` is created inside `useCallback`, so exercising it needs a React renderer — `@testing-library/react` plus a `jsdom` environment, neither of which this repo has (`vitest.config.ts` sets no `environment`; all three existing tests are pure node). Adding React test infrastructure is out of scope for this slice — the plan already hands the test harness to Module 3. That branch is instead covered by manual criteria 3.7 and 4.9. If it later proves worth pinning, the cheapest route is extracting the rollback decision into an exported pure helper rather than pulling in a renderer.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Both new suites actually run (not silently unmatched): `npx vitest run src/lib/services/appointment-transitions.test.ts src/components/hooks/useJsonMutation.test.ts`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- None — this phase ships no user-visible behavior.

---

## Phase 2: Service, API route, guard entry, and pgTAP

### Overview

Wire the rules to the database through a compare-and-set update, expose it on a worker-reachable route, and extend both test suites that cover the new surface.

### Changes Required:

#### 1. Status-change service function

**File**: `src/lib/services/appointments.ts`

**Intent**: The single write path for a status change. Performs a compare-and-set so a concurrent change by another user is detected rather than overwritten, and distinguishes the two ways the write can legitimately fail.

**Contract**: `changeAppointmentStatus(supabase, id, input)` returning a discriminated union:

```ts
export type StatusChangeOutcome =
  // `entry` is null only when the row's joins are incomplete — the write still committed,
  // so `current` is what the client settles its optimistic state on. See the null note below.
  | { status: "updated"; current: AppointmentStatus; entry: DayPlanEntry | null }
  | { status: "stale"; current: AppointmentStatus }
  | { status: "slot_taken" }
  | { status: "not_found" };
```

- Reject with a thrown error (caller maps to 400) when `isTransitionAllowed(input.from, input.status)` is false — the rule module is the authority, not a second copy of the table here.
- The update is `.update({ status }).eq("id", id).eq("status", input.from).select(DAY_PLAN_SELECT).maybeSingle()`. RLS scopes it to the caller's workshop, so no `workshop_id` parameter — matching every other function in this file.
- No row returned → re-read the row with the existing `getAppointmentDetail()` and return `stale` carrying its true current status. If that read comes back `null` the row is not visible to this caller at all, so return a fourth outcome — `not_found`, which the route answers with `404`, matching `getAppointmentDetail`'s "never leaks existence" posture (`appointments.ts:286-287`) and the 404 the route already gives an unknown id. Do **not** synthesize a `stale` carrying the client's own `from`: that tells the client its stale belief is the truth while also signalling a conflict, so the UI resyncs to the wrong value and shows a message contradicting itself. (In practice this branch is unreachable — `20260821090000` grants no DELETE on `appointments` and RLS scoping does not shift mid-session — but the response must still be coherent.)
- Postgres error `23P01` → return `slot_taken`. This is the reversal-of-`no_show` case: the freed window was re-booked, and the partial exclusion constraint re-engages the moment the row leaves `no_show`.
- On success map the returned row through the existing `toDayPlanEntry()` so the response shape matches what both UI surfaces already render. That function returns `DayPlanEntry | null` (`appointments.ts:228-232`) — so the success branch carries `current` alongside a nullable `entry` rather than throwing on null. **The UPDATE has already committed by this point**; a 500 here would roll the client's optimistic change back while the database holds the new status, leaving the two silently disagreeing. On null the route still answers `200`, carrying the id and the confirmed status — which is all either surface needs to settle its optimistic state — and `toDayPlanEntry`'s existing `console.warn` carries the diagnostic.

#### 2. Status API route

**File**: `src/pages/api/appointment-status/[id].ts`

**Intent**: The worker-reachable endpoint. Mirrors `src/pages/api/appointments/index.ts` structurally: `prerender = false`, uppercase export, Supabase-unconfigured guard, zod parse, outcome switch, `console.error` + 500 on an unexpected throw.

**Contract**: `PATCH`, id taken from `Astro.params` and validated with `z.uuid()` before it reaches Postgres (the same defence `src/pages/wizyty/[id].astro:12` uses — a malformed id must not become a 500). Responses: `200` with the updated `DayPlanEntry`, or — in the incomplete-join case — `{ id, status }` alone; `400` with `flattenError(...).fieldErrors` for a bad body and for a rejected transition; `404` for an unknown or other-workshop id; `409` for both `stale` (message naming that someone else changed it, plus the true `current` status so the client can resync) and `slot_taken` (reusing the existing Polish conflict wording "Ten termin został właśnie zajęty"); `503` when Supabase is unconfigured. Never forward a raw Postgres `DETAIL` — the reason is spelled out at `src/pages/api/appointments/index.ts:23-24`.

#### 3. Guard table entry

**File**: `src/lib/auth-guard.ts`

**Intent**: Make the new route reachable by both roles while leaving the owner-only booking API untouched.

**Contract**: Add `["/api/appointment-status", "any"]` to `ROUTE_ACCESS`. No change to `matchRoute` — the whole point of the sibling-route shape is that the prefix matcher stays as-is.

#### 4. Guard unit tests

**File**: `src/lib/auth-guard.test.ts`

**Intent**: Pin the access split this slice depends on, in the style of the existing `/wizyty` split block.

**Contract**: A new `describe` asserting a worker is allowed on `/api/appointment-status/<uuid>`, an owner is allowed there, an unauthenticated caller is redirected to sign-in, and — the regression that matters — a worker is still redirected away from `/api/appointments`.

#### 5. pgTAP assertions

**File**: `supabase/tests/rls_workshop_scope.test.sql`

**Intent**: Prove at the database level that the worker path works end-to-end and that the slot-release invariant behaves as FR-005 requires. The fixtures (workshop A/B, owner, worker, one booked appointment) already exist in the file.

**Contract**: Extend the S-02 appointment block and **bump the `plan(48)` count at `:11` by the number of assertions added**. Assert: (a) a worker can move the appointment `waiting → in_progress → done`; (b) after setting `status = 'no_show'`, inserting a new appointment on the same bay and overlapping window **succeeds** — the partial exclusion constraint released the slot; (c) moving that no-show row back to `waiting` while the replacement occupies the window **fails with `23P01`** — the exact condition the service maps to `slot_taken`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- pgTAP suite passes against a running local stack: `npm run db:test`

#### Manual Verification:

- `curl -X PATCH` against `/api/appointment-status/<id>` as a signed-in worker returns 200 and the updated entry.
- The same call as an unauthenticated caller returns `401` JSON, not an HTML redirect.
- A worker hitting `POST /api/appointments` still gets `403` JSON.

---

## Phase 3: Detail page status block

### Overview

Replicate the brochure's `VisitDetailScreen` status control and action sidebar on `/wizyty/<id>`, as a React island over the existing Astro page.

### Changes Required:

#### 1. Status panel island

**File**: `src/components/appointments/AppointmentStatusPanel.tsx`

**Intent**: The interactive half of the detail page — the "Szybka zmiana statusu" step grid plus the sidebar actions. Owns the appointment's current status as local state seeded from props, mutates optimistically, and rolls back with an inline Polish message on failure.

**Contract**: Props are the appointment id, its current status, and the customer phone. Renders:

- The **step grid** — `FORWARD_STEPS` mapped to three buttons in a `md:grid-cols-3` grid inside a `rounded-2xl border border-slate-100 bg-slate-50 p-4` block headed "Szybka zmiana statusu". The step matching the current status carries `bg-amber-100 ring-2 ring-amber-200` with an amber icon; the others `bg-white ring-1 ring-slate-100` with a slate icon. Each button shows label + note line. Icons and notes per the brochure: `Clock` / "Klient zapisany", `Wrench` / "Auto na stanowisku", `CheckCircle2` / "Można rozliczyć" (`lucide-react`, already a dependency — `DayPlanBoard.tsx:2`).
- The **sidebar** — `Zadzwoń` as an `<a href={tel:…}>` styled `bg-slate-900`, and `Nie przyjechał` as a `border-rose-200 bg-rose-50 text-rose-700` button. The brochure's orange "Oznacz: Gotowe" is redundant once the step grid is live and is not reproduced; the orange treatment belongs to whichever step is the forward action.
- Every button is disabled while its own request is pending and when `isTransitionAllowed(current, target)` is false — which, given the rule table, means only the button for the current status is inert. Failure messages render inline near the block, never as an alert.

**Contract note**: a `409` carrying `current` resyncs local state to the server's value instead of rolling back to the stale one — that is the difference between "someone else moved it" and "your move failed". Read it off `MutationFailure.status === 409` and `MutationFailure.body`, both added in Phase 1 §4; a raw `fetch` here is not needed.

#### 2. Detail page wiring

**File**: `src/pages/wizyty/[id].astro`

**Intent**: Adopt the brochure's two-column layout and mount the island. The static card above it stays server-rendered — only the status control needs interactivity.

**Contract**: Wrap the existing card and a new sidebar column in the brochure's `grid gap-4 xl:grid-cols-[1fr_300px]` (`App.jsx:485`). Mount `<AppointmentStatusPanel client:load … />` with the entry's `id`, `status`, and `customerPhone`. **Drop the existing `<StatusPill>` from the card header** (`wizyty/[id].astro:40`). It is server-rendered, so it would not react to a change made in the island, and two components disagreeing about status on one screen is the worse outcome. The step grid already shows the current state more richly than the pill does, and removing it keeps status ownership entirely inside the island rather than straddling the Astro/React boundary for a decorative element. `StatusPill` itself stays — `DayPlanBoard.tsx:162` still uses it. The existing phone `<a>` at `:36-38` is superseded by the sidebar's Zadzwoń button.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- As a worker, `waiting → in_progress → done` from the detail page; each tap updates the active step immediately with no reload.
- Walking a `done` appointment back to `waiting` works.
- Marking `no_show`, then confirming the freed window reappears among `/wizyty/nowa`'s suggested slots.
- Reversing that `no_show` after the slot was re-booked shows the Polish conflict message and leaves the row at `no_show`.
- Zadzwoń opens the dialer on a phone; layout holds at 360px width.
- Screen matches `~/Code/wulkanizator-go-brochure/src/App.jsx:478-538` near 1:1.

---

## Phase 4: Day-plan inline advance and ship

### Overview

Put the one-tap forward action on the day-plan card — the interaction the roadmap identifies as where worker adoption is won — and close out the slice's docs and roadmap state.

### Changes Required:

#### 1. Day-plan board state and advance action

**File**: `src/components/appointments/DayPlanBoard.tsx`

**Intent**: Let a worker advance an appointment without leaving the list, with the pill and stat tiles reflecting the change instantly.

**Contract**: `entries` becomes local state seeded from the prop; `countByStatus`/`filterByStatus` keep deriving from it unchanged. Each row gains a next-status button, rendered only when `nextStatus(entry.status)` is non-null, labelled from `APPOINTMENT_STATUS_PRESENTATION[next].label` and sized for a gloved tap. Mutations go through `useRowMutation` keyed by appointment id, so two rows tapped in quick succession cannot clear each other's pending or error state; `rollback` must be a functional update touching only that row (`useJsonMutation.ts:98-105`). A `409` carrying `current` resyncs that row rather than rolling back — pass an `onFailure` handler (Phase 1 §4) that detects `status === 409`, applies the server's `current` to that row, and returns `true` to suppress the rollback. Per-row errors render inline on the card.

**Contract note**: the row must be restructured so the button is not nested inside the navigation `<a>` — see Critical Implementation Details.

**Contract note on the status filter**: advancing a row while a status filter is active would drop it out of `filterByStatus`'s result mid-tap — the card vanishes under the finger, and any inline error then renders on a row that is no longer mounted. Keep a `recentlyChanged: ReadonlySet<string>` of appointment ids in board state; `visible` becomes the filter-matched rows plus any pinned id, and the set clears on a filter change or a day navigation. `filterByStatus` and `countByStatus` stay untouched — the union happens at the render site only.

#### 2. Roadmap and change status

**File**: `context/foundation/roadmap.md`, `context/changes/worker-status-changes/change.md`

**Intent**: Record that S-04 shipped.

**Contract**: Flip the `S-04` row in `## At a glance` and the `- **Status:**` line in the `### S-04` body to `done`; resolve the two Unknowns at `:147-149` with the decisions made here (transitions: guided forward, reversible from the detail page; owner slot override: still parked). Bump the roadmap frontmatter `updated:`. Set `change.md` `status: implemented` and `updated:` to the ship date.

**Contract note on ship order**: this slice ships **no migration**, so the `db:push`-before-merge sequence in `context/foundation/lessons.md:5` does not apply. `supabase/tests/rls_workshop_scope.test.sql` is a test file, not a migration — it does not touch production. Merging to `main` still deploys, so run the full gate (`npm run lint && npm run typecheck && npm run build && npm test`) before merging.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- The new route is declared and pinned: `grep -n "api/appointment-status" src/lib/auth-guard.ts src/lib/auth-guard.test.ts` hits both files

#### Manual Verification:

- As a worker on `/dashboard`, one tap advances an appointment; the pill and the "Oczekuje"/"Gotowe" tiles update with no reload.
- Tapping the card body (not the button) still navigates to `/wizyty/<id>`.
- A `done` row shows no advance button.
- Advancing two different rows in quick succession leaves both correct — neither row's spinner or error leaks into the other.
- With the network throttled to offline, a tap rolls back and shows "Nie udało się połączyć z serwerem."
- With the "Oczekuje" filter active, advancing a row keeps its card on screen instead of dropping it mid-tap; switching filters then removes it.
- The board is usable one-handed at 360px width.

---

## Testing Strategy

### Unit Tests (Vitest):

- `appointment-transitions.test.ts` — `nextStatus` for all five enum values; `isTransitionAllowed` across self-transitions, `cancelled` in both directions, and the backward moves the detail page relies on.
- `auth-guard.test.ts` — worker and owner allowed on `/api/appointment-status/<uuid>`, unauthenticated redirected, worker still blocked from `/api/appointments`.
- `useJsonMutation.test.ts` — `requestJson` surfaces a 409's `status` and `body` (the `current` the UI resyncs to), while the existing `fieldErrors` / default-message / network-failure paths behave unchanged. Stubs `fetch`; needs no DOM. `useRowMutation`'s `onFailure` branch stays manual-only (see Phase 1 §5) — unit-testing a `useCallback`-bound function would mean adding `@testing-library/react` and a `jsdom` environment this repo does not have.

### Integration Tests (pgTAP, `npm run db:test`):

- Worker walks an appointment `waiting → in_progress → done` in their own workshop.
- Setting `no_show` releases the bay window: an overlapping insert on the same bay then succeeds.
- Reversing that `no_show` into the now-occupied window fails with `23P01`.

### Manual Testing Steps:

1. Sign in as a worker; on `/dashboard`, tap the advance button on a `waiting` appointment — pill goes "W trakcie", the "Oczekuje" tile decrements, no reload.
2. Tap the same row's body — lands on `/wizyty/<id>` with "W trakcie" as the active step.
3. Tap "Gotowe" on the detail page; then tap "Oczekuje" to walk it back — both succeed.
4. Tap "Nie przyjechał"; open `/wizyty/nowa` as the owner and confirm the released window is offered again.
5. Book that released window, then reverse the no-show — expect the Polish conflict message, row stays `no_show`.
6. In two browsers, advance the same appointment nearly simultaneously — the loser sees the "changed by someone else" 409 and resyncs to the true status.
7. Throttle to offline, tap advance — optimistic change reverts with the connection message.
8. Repeat step 1 at 360px viewport width.

## Performance Considerations

The compare-and-set is a single statement — no read-then-write round trip on the happy path; only the `stale` branch costs a second query. Optimistic updates mean the NFR ("plan dnia i jego aktualizacje widoczne w mniej niż 2 sekundy", `prd.md:98`) is met by local state, not by server latency. `countByStatus` and `filterByStatus` are O(n) over one day's appointments — a few dozen rows at most — so recomputing on every render is cheaper than memoizing.

## Migration Notes

None. This slice ships no `supabase/migrations/` file and does not regenerate `src/db/database.types.ts`. Existing appointment rows need no backfill — `status` has been non-null with a `'waiting'` default since S-02.

## References

- Roadmap slice: `context/foundation/roadmap.md:138-151` (S-04)
- PRD: FR-007 (`prd.md:82`), FR-005 (`prd.md:76`), workflow rule (`prd.md:109`), worker access (`prd.md:115`)
- Design reference: `context/foundation/design-system.md:28` → `~/Code/wulkanizator-go-brochure/src/App.jsx:478-538`
- Prior slice: `context/archive/2026-08-21-day-plan-view/plan.md`
- Existing conflict handling to mirror: `src/lib/services/appointments.ts:204-210`, `src/pages/api/appointments/index.ts:22-33`
- Row-keyed mutation pattern: `src/components/hooks/useJsonMutation.ts:106-148`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Transition rules, request schema, and mutation transport

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — be9ece7
- [x] 1.2 Both new suites actually run: `npx vitest run src/lib/services/appointment-transitions.test.ts src/components/hooks/useJsonMutation.test.ts` — be9ece7
- [x] 1.3 Type checking passes: `npm run typecheck` — be9ece7
- [x] 1.4 Linting passes: `npm run lint` — be9ece7

### Phase 2: Service, API route, guard entry, and pgTAP

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 383dfbb
- [x] 2.2 Type checking passes: `npm run typecheck` — 383dfbb
- [x] 2.3 Linting passes: `npm run lint` — 383dfbb
- [x] 2.4 pgTAP suite passes: `npm run db:test` — 383dfbb

#### Manual

- [x] 2.5 PATCH as a signed-in worker returns 200 and the updated entry — 383dfbb
- [x] 2.6 PATCH unauthenticated returns 401 JSON, not an HTML redirect — 383dfbb
- [x] 2.7 Worker hitting `POST /api/appointments` still gets 403 JSON — 383dfbb

### Phase 3: Detail page status block

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [x] 3.4 Worker advances `waiting → in_progress → done` from the detail page with no reload
- [x] 3.5 Walking a `done` appointment back to `waiting` works
- [x] 3.6 `no_show` releases the slot — window reappears in `/wizyty/nowa` suggestions
- [x] 3.7 Reversing a `no_show` into a re-booked slot shows the Polish conflict message
- [x] 3.8 Zadzwoń opens the dialer; layout holds at 360px
- [x] 3.9 Screen matches the brochure `VisitDetailScreen` near 1:1

### Phase 4: Day-plan inline advance and ship

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Type checking passes: `npm run typecheck`
- [ ] 4.3 Linting passes: `npm run lint`
- [ ] 4.4 Build succeeds: `npm run build`
- [ ] 4.5 `grep -n "api/appointment-status" src/lib/auth-guard.ts src/lib/auth-guard.test.ts` hits both files

#### Manual

- [ ] 4.6 One tap advances an appointment; pill and tiles update with no reload
- [ ] 4.7 Tapping the card body still navigates to `/wizyty/<id>`
- [ ] 4.8 A `done` row shows no advance button
- [ ] 4.9 Two rows advanced in quick succession stay independent
- [ ] 4.10 Offline tap rolls back with the connection message
- [ ] 4.11 Advancing a row under the "Oczekuje" filter keeps the card on screen
- [ ] 4.12 Board is usable one-handed at 360px width
