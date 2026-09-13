# Fold the booking submit onto the shared HTTP path — Implementation Plan

## Overview

`NewAppointmentForm`'s booking submit hand-rolls `fetch` instead of using the repo's shared request
helper. The bypass was reviewed and accepted in 2026-08 for a reason that no longer holds. This plan
retires it: characterize the current behaviour, fold the submit onto `requestJson`, surface the
field-level validation errors the form currently discards, and — chosen deliberately in planning —
wire the Playwright suite into CI so the safety net this work leans on actually runs.

## Current State Analysis

**The bypass and why it exists.** `src/components/appointments/NewAppointmentForm.tsx:98` is one of
exactly two `fetch` call sites in `src/`; the other is the shared helper at
`src/components/hooks/useJsonMutation.ts:42`. The comment at `NewAppointmentForm.tsx:88-90` documents
the deviation. Its origin is
`context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:57-64` (F3, WARNING),
which called it "a deliberate, justified deviation" because the hook's failure shape "only carries
`ok`/`fieldErrors`/`message` … with no room for the 409 response's `slots`/`emptyReason` payload",
and prescribed a comment as the fix.

**Why the justification expired.** One slice later, `be9ece7` extended `MutationFailure` with
`status` and `body` — forced by a CRITICAL plan-review finding on an unrelated change
(`context/archive/2026-08-21-worker-status-changes/reviews/plan-review.md:26-43`).
`useJsonMutation.ts:6-7` carries both fields today. The repo already noticed:
`context/changes/testing-mutation-failure-ui/research.md:319` records it as _"`NewAppointmentForm`
bypassed the hook because it couldn't carry a 409 body; documented, not fixed."_

**What planning discovered that the research did not.** The transport exists, but **not in the hook
the form would reach for**. `useJsonMutation.mutate()` returns `TResponse | null`
(`useJsonMutation.ts:77`) and pushes the failure into React state (`:83`) — state that a caller
cannot read after `await`, because the closure still holds the previous render's value. This is why
the repo's existing 409-resync uses `useRowMutation`'s **`onFailure` callback**
(`DayPlanBoard.tsx:105-114`), not a state read. The single-form hook has no such callback. The seam
that does hand the caller a complete failure synchronously is the stateless
`requestJson<T>()` (`useJsonMutation.ts:36-66`), which both hooks wrap and which is already exported.

**What the form does today** (`NewAppointmentForm.tsx:91-131`): sets `isBooking`, clears the error,
POSTs, then branches on `res.status` — `201` stores the appointment; `409` swaps in the server's
fresh `slots`/`emptyReason`, clears the selection and shows the server's Polish message; anything
else shows a hard-coded Polish generic; `catch` shows a connection message; `finally` clears
`isBooking`. The `400` body's per-field `errors` are parsed and then discarded.

**Safety nets.** `.github/workflows/ci.yml:18-28` runs `npm ci`, `astro sync`, `npm run lint`,
`npm test`, `npm run typecheck`, `npm run build` — and nothing else. Neither pgTAP nor Playwright
runs in CI. `NewAppointmentForm.tsx` has no colocated test; only `e2e/core-loop.spec.ts:31-52`
exercises the happy path, and only locally.

## Desired End State

`src/` contains exactly one `fetch` call site — `useJsonMutation.ts:42` inside `requestJson` — and
the booking submit goes through it like every other island mutation. A `400` shows the server's
per-field message instead of a generic one, while `500`/`503` keep showing the Polish generic rather
than leaking internal English strings. A colocated component test pins all four response paths and
runs in CI on every push, and the Playwright suite runs there too.

Verify: `npx ast-grep run --pattern 'fetch($$$)' --lang tsx src` returns no match in
`NewAppointmentForm.tsx`; `npm test` passes; the CI run shows a green Playwright job.

### Key Discoveries:

- `MutationFailure` already carries `status` and `body` — `src/components/hooks/useJsonMutation.ts:6-7`
- `useJsonMutation.mutate()` discards the failure to state (`:77`, `:83`) — unreadable after `await`
- `requestJson()` is exported and returns the full `MutationResult` — `:36-66`
- `requestJson` already defaults `message` to the Polish generic — `:55`
- The repo's 409-resync precedent uses a callback, not a state read — `DayPlanBoard.tsx:105-114`
- `firstFieldError()` exists and is unit-tested — `useJsonMutation.ts:22-28`
- The happy-dom harness recipe — `src/components/appointments/DayPlanBoard.test.tsx:1-11`
- `playwright.config.ts` is already CI-aware — `:7` ("Absent file is fine when the values already
  come from the environment (CI)"), `:23-25` (`forbidOnly`, `retries`, the `github` reporter)
- E2E fixture accounts come from `supabase/seed.sql:24`; every value in `.env.e2e.example` is a
  non-secret local-stack default, so CI needs **no GitHub secrets**

## What We're NOT Doing

- **Not deduplicating the no-overlap rule** (K1). `context/archive/2026-08-21-add-appointment-with-slots/plan-brief.md:59-62`
  designed the duplication on purpose — "the algorithm avoids proposing a conflict, the exclusion
  constraint guarantees one cannot be stored". Out of scope and, on current evidence, wrong to do.
- **Not adding database constraints for the six unbacked rules** (K2). A separate decision.
- **Not splitting `appointments.ts`** (K3), **not inverting `types.ts`** (K5), **not touching the
  pgTAP plan count** (K6).
- **Not changing `useJsonMutation` or `useRowMutation`.** No shared-hook edits; seven other callers
  stay untouched.
- **Not translating the API's error strings.** `api/appointments/index.ts` keeps returning
  `"Failed to book appointment"`; the form deliberately does not display it.
- **Not adding pgTAP to CI.** Phase 4 covers Playwright only.
- **Not touching the slots call.** It already uses `useJsonMutation` correctly.

## Implementation Approach

Characterize, then fold, then change behaviour, then close the safety gap. The ordering exists so
each step has an unambiguous proof: Phase 1 writes tests against untouched code, Phase 2 must leave
them **passing unchanged** — that is the whole evidence that the fold is behaviour-preserving —
and Phase 3 changes behaviour only after that proof exists, adding its own test. Phase 4 is
independent of all three and is placed last so it cannot block them.

## Critical Implementation Details

**Why `failure.message` is deliberately not displayed on a server error.** (Two paths do use it: the 409, and the network failure — see Phase 2's contract.) `requestJson` sets
`message: body.error ?? "Coś poszło nie tak. Spróbuj ponownie."` (`useJsonMutation.ts:55`), and the
booking route returns `{ error: "Failed to book appointment" }` for 500 and
`{ error: "Supabase is not configured" }` for 503 (`api/appointments/index.ts:10,38`). Chaining
through `failure.message` — the pattern `useRowMutation.ts:138` uses — would put internal English
text in a Polish UI. The 409 branch is the exception: there the server's message
(`"Ten termin został właśnie zajęty"`) is user-facing copy and must be shown.

---

## Phase 1: Characterize the booking submit

### Overview

Pin the three response paths that exist today, against the current hand-rolled `fetch`. No
production code changes in this phase.

### Changes Required:

#### 1. Component test

**File**: `src/components/appointments/NewAppointmentForm.test.tsx` (new)

**Intent**: Assert the submit's observable outcomes for `201`, `409` and a network failure, so the
next phase's refactor has something to be judged against. Follow the harness recipe in
`DayPlanBoard.test.tsx:1-11` — `// @vitest-environment happy-dom` docblock, `cleanup()` +
`vi.unstubAllGlobals()` in `afterEach`, `userEvent` for interaction.

**Contract**: Stub `globalThis.fetch` per case. The component needs a `services` prop and a slot
fetch before a submit is possible, so the stub must answer both `/api/appointments/slots` and
`/api/appointments`.

**Every stub must resolve to a real `Response`** — reuse the `jsonResponse()` helper shape at
`DayPlanBoard.test.tsx:41-43` (`new Response(JSON.stringify(body), { status })`). This is not
stylistic: today's code branches on `res.status`, so a bare `{ status: 201, json: … }` object would
pass Phase 1 — but `requestJson` branches on `res.ok` (`useJsonMutation.ts:49`), which is
`undefined` on such an object. The `201` case would flip to the failure branch in Phase 2, forcing
an edit to this file and breaking gates 2.1 and 2.2.

Assertions, all user-visible:

- `201` → the success card renders, showing the formatted date and the `HH:MM–HH:MM` range.
- `409` → the chips re-render from the conflict body's `slots`, the previous selection is no longer
  selected, and the server's `error` string is displayed.
- `fetch` rejects → "Nie udało się połączyć z serwerem." is displayed.

Assert rendered output, never internal state. Do not assert the request body — Phase 2 changes how
the request is issued, and a test coupled to that would have to be edited, destroying the proof.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The new file exists and is picked up: `npx vitest run src/components/appointments/NewAppointmentForm.test.tsx`

#### Manual Verification:

- Each of the three tests fails when its corresponding branch in `handleSubmit` is temporarily
  broken — confirming the tests actually bind to the behaviour rather than passing vacuously

**Implementation Note**: Pause after this phase for confirmation that the deliberate-break check was
performed before proceeding.

---

## Phase 2: Fold onto `requestJson`

### Overview

Replace the hand-rolled `fetch` with the shared helper. Behaviour must not change.

### Changes Required:

#### 1. The booking submit

**File**: `src/components/appointments/NewAppointmentForm.tsx`

**Intent**: Call `requestJson` instead of `fetch`, and branch on the returned `MutationResult`
rather than on a raw `Response`. Remove the now-false comment at `:88-90` — it explains a bypass
that no longer exists. The form keeps its own `isBooking` / `bookingError` / `booked` state; this
phase unifies the transport, not the state.

**Contract**: `requestJson<Appointment>("/api/appointments", "POST", body)` returns
`{ ok: true, data } | { ok: false, failure }`. Map: `ok` → `setBooked(data)`;
`failure.status === 409` → read the conflict payload from `failure.body`, then resync exactly as
today (`setSlots`, `setEmptyReason`, `setSelectedSlot(null)`, `setBookingError`).

Every other failure picks its message by **whether `status` is present**, and that discriminator is
load-bearing. `requestJson` omits `status` on exactly one path — its `catch`
(`useJsonMutation.ts:64`) — and there it already supplies the precise Polish network copy the form
shows today. So:

- `failure.status === undefined` → `setBookingError(failure.message)`, i.e.
  `"Nie udało się połączyć z serwerem."` — identical to `NewAppointmentForm.tsx:127` today.
- any other status → the hard-coded Polish generic, unchanged from today.

Collapsing both arms into the generic would silently change the network message and fail Phase 1's
third test — which would force an edit to the test file and destroy this phase's entire proof.

The network failure now arrives as `{ ok: false }` rather than a thrown exception, so the
`try`/`catch` around the call is no longer load-bearing — `finally { setIsBooking(false) }` still is.
`BookingConflictResponse` (`:28`) stays where it is and now types `failure.body`.

### Success Criteria:

#### Automated Verification:

- **Phase 1's tests pass with no edits to the test file**: `npx vitest run src/components/appointments/NewAppointmentForm.test.tsx`
- `git diff --stat src/components/appointments/NewAppointmentForm.test.tsx` is empty —
  **precondition: Phase 1 is committed first.** On an untracked path this command prints nothing no
  matter how the file was rewritten, so the gate is vacuous until the file is in git.
- No `fetch` outside the shared helper: `npx ast-grep run --pattern 'fetch($$$)' --lang tsx src` returns only non-`NewAppointmentForm` matches (expected: none)
- Full unit suite passes: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Booking a real appointment against the local stack still shows the success card
- Forcing a conflict (book the same slot twice in two tabs) still re-renders fresh chips with the
  Polish conflict message

---

## Phase 3: Surface field-level validation errors

### Overview

A `400` collapses to a generic message even though the server names the offending field. Show it —
without letting internal English strings reach the UI.

**That `400` is not reachable through the UI today, and shipping the guard anyway is a deliberate
call.** `appointmentBookingRequestSchema` (`src/lib/schemas/appointment.ts:13-19`) constrains the
two user-typed fields with `.min(1)` only — exactly what `canSubmit`
(`NewAppointmentForm.tsx:165`) already enforces before enabling the button; the other three fields
are machine-supplied from the selected service and slot. So no input a user can type produces a
`400`. This phase is a guard for the first time the schema tightens (a phone format, a name
length), plus the half that is live today: a regression test that a `500` never shows its English
string. Do not go looking for a user-visible change — there isn't one yet.

### Changes Required:

#### 1. Error message resolution

**File**: `src/components/appointments/NewAppointmentForm.tsx`

**Intent**: For non-`201`/non-`409` failures, prefer the server's per-field message and otherwise
fall back to the existing Polish generic. Import the already-tested `firstFieldError` helper rather
than re-deriving it.

**Contract**: the network arm established in Phase 2 (`failure.status === undefined`) keeps its own
message and is **not** touched here. Only the `failure.status !== undefined` arm changes — from the
bare generic to `firstFieldError(failure.fieldErrors) ?? "Coś poszło nie tak. Spróbuj ponownie."`.
`failure.message` is deliberately not part of _that_ chain — add a short comment saying why, citing
the English 500/503 strings, so the omission does not read as an oversight to the next reader.

#### 2. Test for the new path

**File**: `src/components/appointments/NewAppointmentForm.test.tsx`

**Intent**: Add a fourth case; the three from Phase 1 stay untouched.

**Contract**: A `400` whose body is `{ errors: { phone: ["Telefon jest wymagany"] } }` displays that
message. A `500` whose body is `{ error: "Failed to book appointment" }` displays the Polish generic
and **not** the English string — this is the regression guard for the decision above.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the two new cases: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The English string never reaches the assertion surface: `npx vitest run src/components/appointments/NewAppointmentForm.test.tsx`

#### Manual Verification:

- Stop the local Supabase stack and submit: the Polish generic appears and the English
  `"Supabase is not configured"` does not. The `400` arm gets no manual step — it is unreachable
  through the UI (see this phase's Overview); the unit test above is its whole coverage.

---

## Phase 4: Run the Playwright suite in CI

### Overview

Chosen deliberately during planning, in full knowledge that it widens the change: the safety net the
previous phases lean on does not currently run automatically. This phase is last and independently
revertible — Phases 1–3 stand on their own if it is deferred or rolled back.

### Changes Required:

#### 1. CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a job that boots the local Supabase stack, applies migrations and the seed, installs
Playwright browsers, and runs the E2E suite. Keep it a **separate job** from the existing one so a
Supabase or browser failure is distinguishable at a glance from a lint/type/build failure.

**Contract**: Ubuntu runner (Docker is present). Steps: checkout → Node from `.nvmrc` → `npm ci` →
`npm run db:start` → `npx playwright install --with-deps chromium` → `npm run test:e2e`.

**Never invoke a bare `supabase`.** The CLI is a devDependency (`package.json:72`), so it sits on
`node_modules/.bin` — which npm scripts see and a workflow `run:` step does not. Use the existing
`npm run db:start` (or `npx supabase`); a raw `- run: supabase start` fails with "command not
found". `supabase start` already applies `supabase/migrations/` and `supabase/seed.sql` (the latter
creates the `owner-a@example.com` / `owner-b@example.com` fixtures at `seed.sql:24`), so no
separate `db reset` step is needed on a cold runner.

**Environment.** The four `E2E_*` values are published local-stack defaults and can be inlined in
the workflow, copied from `.env.e2e.example`: `E2E_BASE_URL`, `E2E_DATABASE_URL`,
`E2E_OWNER_A_EMAIL/PASSWORD`, `E2E_OWNER_B_EMAIL/PASSWORD`. `SUPABASE_URL` and `SUPABASE_KEY` —
which the dev server started by the Playwright `webServer` block needs — are **not** in that file
(it holds only the six above). Derive them from the stack this job just started, immediately after
the start step:

```yaml
- run: npx supabase status -o env >> "$GITHUB_ENV" # exports API_URL / ANON_KEY
```

then map `API_URL` → `SUPABASE_URL` and `ANON_KEY` → `SUPABASE_KEY` on the test step. Confirm the
exact key names on the first run; the pinned CLI is `supabase@^2.23.4` (`package.json:72`).

**This job must never reference `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY`.** Those point at
the _cloud_ project — `ci.yml:26-27,30-31` already uses them for typecheck and build, so copying
the adjacent step is the natural wrong move. It would leave the dev server talking to production
while `E2E_DATABASE_URL` stays on `127.0.0.1:54322`: the suite books appointments against
production and tears them down from the local stack, accumulating rows that no table has a DELETE
grant to remove (`context/foundation/lessons.md` §"A `security definer` RPC that unconditionally
inserts…"). With the derivation above, **no GitHub secrets are required** — every value is a
local-stack default or read from the running stack.

Upload the HTML report as an artifact on failure.
`playwright.config.ts` needs no changes: it already branches on `process.env.CI` (`:23-25`) and
already tolerates a missing `.env.e2e` (`:4-8`).

#### 2. Documentation

**Files**: `README.md`, `AGENTS.md`, `context/foundation/test-plan.md`

**Intent**: Three docs state the CI gate as "lint + test + typecheck + build". Update all three to
name the E2E job, so they keep matching reality — the failure mode
`context/foundation/lessons.md` §"Deleting a symbol means grepping the docs that name it" warns
about. `AGENTS.md` matters most: it is the first file a future agent reads, so a stale line there
propagates into every downstream slice.

**Contract**: the three call sites, verified by
`grep -rn "lint + test + typecheck + build" README.md AGENTS.md context/` returning nothing
afterwards:

- `README.md:276` — the `## CI` section's sentence listing what runs on push and PR.
- `AGENTS.md:35` — the "Commit & Pull Request Guidelines" gate sentence.
- `context/foundation/test-plan.md:132` — the same list, in the CI-coverage note.

### Success Criteria:

#### Automated Verification:

- The workflow parses: `npx --yes @action-validator/cli --verbose .github/workflows/ci.yml` (or a
  successful push that schedules both jobs)
- The E2E job completes green on a pushed branch
- The existing job is unaffected: lint, test, typecheck, build still pass

#### Manual Verification:

- A deliberately broken spec makes the CI job red — confirming the job actually runs the suite
  rather than silently skipping it
- Total CI wall-clock remains acceptable for the workflow (note the observed duration in the PR)
- The uploaded Playwright report is readable on a failed run

---

## Testing Strategy

### Unit Tests:

- `NewAppointmentForm.test.tsx` — four response paths: `201`, `409` resync, `400` field error,
  `500` generic-not-English. Network failure covered as a fifth case from Phase 1.
- No changes to `useJsonMutation.test.ts`; the shared helper is not modified.

### Integration Tests:

- None added. The route-level harness remains the unstarted Phase 1 of
  `context/foundation/test-plan.md` and is out of scope here.

### Manual Testing Steps:

1. `npm run db:start`, then book an appointment through `/wizyty/nowa` — success card appears.
2. In two tabs, book the same slot — the loser re-renders fresh chips with the Polish conflict text.
3. Stop Supabase and submit — the generic Polish message appears, not `"Supabase is not configured"`.
   (Forcing a `400` is not on this list: no typed input can produce one — see Phase 3's Overview.)

## Performance Considerations

None for Phases 1–3; the change is one call site. Phase 4 adds CI wall-clock — the E2E job runs in
parallel with the existing one, so the critical path grows by the E2E duration only.

## Migration Notes

Not applicable — no schema, no data, no API contract changes.

## References

- Ranking and intentionality verdicts: `context/changes/refactor-opportunities/research.md`
- Flow analysis: `context/changes/booking-flow-analysis/research.md`
- The original F3 finding: `context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:57-64`
- Why the blocker was lifted: `context/archive/2026-08-21-worker-status-changes/reviews/plan-review.md:26-43`
- 409-resync precedent: `src/components/appointments/DayPlanBoard.tsx:105-114`
- Test harness recipe: `src/components/appointments/DayPlanBoard.test.tsx:1-11`, `context/foundation/test-plan.md` §6.4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Characterize the booking submit

#### Automated

- [ ] 1.1 Unit tests pass: `npm test`
- [ ] 1.2 Type checking passes: `npm run typecheck`
- [ ] 1.3 Linting passes: `npm run lint`
- [ ] 1.4 New test file runs: `npx vitest run src/components/appointments/NewAppointmentForm.test.tsx`

#### Manual

- [ ] 1.5 Deliberate-break check: each test fails when its branch is broken

### Phase 2: Fold onto `requestJson`

#### Automated

- [ ] 2.1 Phase 1 tests pass with no edits to the test file
- [ ] 2.2 `git diff --stat` on the test file is empty (Phase 1 committed first)
- [ ] 2.3 No `fetch` outside the shared helper (ast-grep)
- [ ] 2.4 Full unit suite passes: `npm test`
- [ ] 2.5 Type checking passes: `npm run typecheck`
- [ ] 2.6 Linting passes: `npm run lint`
- [ ] 2.7 Build passes: `npm run build`

#### Manual

- [ ] 2.8 Real booking against the local stack still shows the success card
- [ ] 2.9 Forced conflict still re-renders fresh chips with the Polish message

### Phase 3: Surface field-level validation errors

#### Automated

- [ ] 3.1 Unit tests pass including the two new cases: `npm test`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 The `500` case asserts the Polish generic, not the English string

#### Manual

- [ ] 3.5 Stack stopped: Polish generic shown, English string not

### Phase 4: Run the Playwright suite in CI

#### Automated

- [ ] 4.1 The workflow file parses / both jobs schedule on push
- [ ] 4.2 The E2E job completes green on a pushed branch
- [ ] 4.3 The existing job still passes lint, test, typecheck, build

#### Manual

- [ ] 4.4 A deliberately broken spec turns the CI job red
- [ ] 4.5 CI wall-clock is acceptable; duration noted in the PR
- [ ] 4.6 The uploaded Playwright report is readable on a failed run
