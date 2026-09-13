# Fold the booking submit onto the shared HTTP path — Plan Brief

> Full plan: `context/changes/refactor-opportunities/plan.md`
> Research: `context/changes/refactor-opportunities/research.md`
> Upstream analysis: `context/changes/booking-flow-analysis/research.md`

## What & Why

`NewAppointmentForm`'s booking submit hand-rolls `fetch` instead of using the repo's shared request
helper. That bypass was reviewed and accepted in August for a specific reason — the shared helper
could not carry the 409 response's `slots`/`emptyReason` payload — and that reason stopped being true
a week later, when an unrelated change extended the failure type. The workaround has outlived its
justification by three weeks, and the repo's own research already logged it as "documented, not
fixed". This retires it.

## Starting Point

Exactly two `fetch` call sites exist in `src/`: the shared `requestJson` helper and this one.
`MutationFailure` has carried `status` and `body` since `be9ece7`. The form has no colocated test;
only a local-only Playwright spec touches the happy path, and CI runs neither Playwright nor pgTAP.

## Desired End State

One `fetch` call site in `src/`. The booking submit goes through `requestJson` like every other
island mutation, a `400` shows the server's per-field Polish message instead of a generic one, and
the component's four response paths are pinned by a test that runs in CI — alongside the Playwright
suite, which now runs there too.

## Key Decisions Made

| Decision                | Choice                                                                                   | Why                                                                                                                                                                             | Source                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Which candidate to plan | K4 — fold the submit                                                                     | Only candidate whose documented justification has provably expired                                                                                                              | Plan (user chose over the higher-risk K2) |
| Which seam to fold onto | `requestJson` directly                                                                   | `useJsonMutation.mutate()` discards the failure into state that a caller cannot read after `await`; `requestJson` returns it synchronously and is the primitive both hooks wrap | Plan                                      |
| Touch the shared hooks? | No                                                                                       | Seven other callers; extending the hook for one user is speculative                                                                                                             | Plan                                      |
| Field-level errors (N4) | In scope                                                                                 | `firstFieldError()` already exists and is tested; the payload is already parsed and thrown away                                                                                 | Plan                                      |
| Message precedence      | `firstFieldError ?? Polish generic` — `failure.message` deliberately skipped outside 409 | The route returns English internals (`"Failed to book appointment"`); chaining through `message` would leak them into a Polish UI                                               | Plan                                      |
| Characterization scope  | 201 / 409 / network, written before the fold                                             | The 409 resync is the entire reason the bypass existed; the tests must pass **unchanged** after the fold — that is the proof                                                    | Plan                                      |
| Regression verification | Wire Playwright into CI                                                                  | User's call, made against a stated warning that it widens the slice                                                                                                             | Plan                                      |
| K1 (duplicated rule)    | Explicitly not touched                                                                   | `add-appointment-with-slots/plan-brief.md:59-62` designed the duplication as layered defence                                                                                    | Research                                  |

## Scope

**In scope:** a colocated `NewAppointmentForm.test.tsx`; the submit's transport; the error-message
chain for non-201/409 responses; a Playwright job in `ci.yml`; the README's CI sentence.

**Out of scope:** deduplicating the no-overlap rule (K1); DB constraints for the six unbacked rules
(K2); splitting `appointments.ts` (K3); inverting `types.ts` (K5); the pgTAP plan count (K6); any
edit to `useJsonMutation` / `useRowMutation`; translating the API's error strings; pgTAP in CI; the
slots call, which already uses the hook correctly.

## Architecture / Approach

```
before:  NewAppointmentForm ──fetch()──────────────► /api/appointments
         useJsonMutation ────requestJson()─fetch()─► /api/appointments/slots

after:   NewAppointmentForm ──requestJson()─┐
         useJsonMutation ────requestJson()──┴fetch()► /api/appointments{,/slots}
```

The form keeps its own `isBooking` / `bookingError` / `booked` state. This unifies the transport, not
the state — `requestJson` is stateless by design, and that is exactly why it can hand back a complete
failure where the stateful hook cannot.

## Phases at a Glance

| Phase               | What it delivers                                                                 | Key risk                                                                      |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Characterize     | `NewAppointmentForm.test.tsx` pinning 201 / 409 / network against untouched code | Tests that pass vacuously — mitigated by a deliberate-break check             |
| 2. Fold             | The submit calls `requestJson`; Phase 1 tests pass **unedited**                  | A test coupled to the request shape would force an edit and destroy the proof |
| 3. Field errors     | `400` shows the field's message; `500` still shows the Polish generic            | Leaking `"Failed to book appointment"` into the UI — guarded by its own test  |
| 4. Playwright in CI | A second CI job running the E2E suite                                            | Supabase-in-CI flakiness; isolated in its own job and revertible alone        |

**Prerequisites:** local Supabase stack for the manual steps (`npm run db:start`); nothing else.
Phases 1–3 need no new dependencies. Phase 4 needs Docker on the runner (ubuntu-latest has it) and
**no GitHub secrets** — every E2E value is a published local-stack default from `.env.e2e.example`,
with fixture accounts created by `supabase/seed.sql:24`.

**Estimated effort:** ~1 session for Phases 1–3 (one handler, one test file); Phase 4 is its own
session and carries all the uncertainty in this plan.

## Open Risks & Assumptions

- **Phase 4 is the outlier.** It was chosen deliberately against a stated warning that it widens a
  deliberately narrow slice. It is sequenced last and is independently revertible precisely so that
  Phases 1–3 land regardless of how it goes.
- Assumption: `supabase start` + `supabase db reset` on a GitHub runner reproduces the local fixture
  state exactly. Unverified until Phase 4 runs; if it does not, Phase 4 is dropped, not patched
  around.
- The `webServer` block in `playwright.config.ts:35-45` carries Astro-7-specific workarounds tuned
  for local agentic environments. CI is a different environment; this is the most likely source of
  a Phase 4 surprise.
- Phases 1–3 have essentially no risk: one call site, guarded by a test written before the change.

## Success Criteria (Summary)

- Booking works exactly as before — proven by tests written before the change and unedited after it.
- A validation error names the field that failed, in Polish; a server error never shows English.
- `npx ast-grep run --pattern 'fetch($$$)' --lang tsx src` finds no match in `NewAppointmentForm.tsx`.
- CI runs the Playwright suite on every push.
