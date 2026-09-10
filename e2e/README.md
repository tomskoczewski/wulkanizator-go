# E2E suite

Browser-level coverage for the risks in `context/foundation/test-plan.md` that no cheaper layer can
prove. Driven by `/10x-e2e` (plan → generate → review → verify).

**`seed.spec.ts` is the exemplar.** Read it before writing or generating anything here — every spec
in this directory copies its shape, and a generated test that departs from it gets re-prompted, not
hand-patched.

## Running

```bash
npm run db:start && npm run db:reset   # local stack + fixture accounts from supabase/seed.sql
npm run dev                            # the app under test, http://localhost:4321
cp .env.e2e.example .env.e2e           # once
npm run test:e2e                       # whole suite
npx playwright test e2e/<file>.spec.ts # single spec
```

The suite runs against the **real** stack — real auth, real routing, real Postgres. Nothing internal
is mocked; that is where the integration risk lives.

## Conventions beyond the generic rules

The generic rules (role-based locators, wait for state, unique data, cleanup, storageState) live in
`CLAUDE.md` § _E2E Testing Rules_. These four are specific to this app:

1. **Wait for hydration before the first interaction.** Every control is an Astro island: the page
   renders on the server and hydrates after. `fill()` before hydration is silently discarded — the
   DOM takes the value, React's state does not, and the form submits empty. Call
   `waitForIslands(page)` (`e2e/support/hydration.ts`) after any `goto` that precedes typing.
2. **Reserve a wall-clock window per spec.** Each workshop in the fixture has exactly **one active
   bay**, so two specs booking the same time on the same day collide on the
   `appointments_no_overlap_per_bay` exclusion constraint. Declare a `SLOT_TIME` constant at the top
   of the file and keep it unique across the directory:

   | Spec                            | Workshop | Window                                |
   | ------------------------------- | -------- | ------------------------------------- |
   | `seed.spec.ts`                  | A        | 16:00                                 |
   | `core-loop.spec.ts`             | A        | earliest slot the app itself suggests |
   | `cross-workshop-denial.spec.ts` | B        | 15:00                                 |

3. **A spec that signs out owns that account's session.** `supabase.auth.signOut()` revokes the
   refresh token server-side, so signing out owner A would invalidate
   `playwright/.auth/owner-a.json` for every spec running in parallel — a green test here turning
   another spec red. Sign-out specs take owner B (`test.use({ storageState: ... })`) and no other
   spec drives owner B's _session_; seeding into owner B's _workshop_ over SQL is unaffected.
4. **Set up and tear down over SQL, assert in the browser.** The app has no delete-appointment
   surface (DELETE is granted to `postgres` alone), and a denial test cannot create the resource it
   must be refused. `e2e/support/db.ts` is the only sanctioned back door — use it for setup and
   cleanup, **never** to assert an outcome. What the user sees is the assertion.
5. **The customer's phone is the teardown handle, and the stamp must be worker-safe.** Build both the
   phone and the name from `uniqueStamp(testInfo)` (`e2e/support/unique.ts`), then call
   `deleteCustomerByPhone(phone)` in a `finally` block — it removes everything the test created, even
   when the test failed mid-way. A bare `Date.now()` is **not** enough: it was observed handing two
   parallel specs the same stamp, after which the first teardown swept away the second spec's
   appointment mid-assertion. `uniqueStamp` appends `parallelIndex`, which closes that door
   deterministically.

## Layout

```
e2e/
  seed.spec.ts        the exemplar — Risk #1, status change survives a reload
  auth.setup.ts       signs in each fixture account once, writes playwright/.auth/<role>.json
  support/db.ts       SQL setup/teardown (never assertions)
  support/hydration.ts  waitForIslands — the island readiness signal
  support/unique.ts     uniqueStamp — worker-safe test-data stamp
```

## The specs, and the risk each protects

| Spec                            | Risk (`test-plan.md`)                                        | Proven by breaking                                                                              |
| ------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `seed.spec.ts`                  | #1 — a status the UI accepted never reached Postgres         | endpoint answering 200 without writing → red                                                    |
| `core-loop.spec.ts`             | #4 — booking → day plan chain drifts between slices          | `getDayPlan` querying the next day → red, **while all 91 unit tests stayed green**              |
| `cross-workshop-denial.spec.ts` | #3 — a session reads or mutates another workshop's data      | removing the 404 rewrite → red; plus a positive control proving owner B _does_ see the same row |
| `signout.spec.ts`               | #6 (partial) — the session guard fails closed after sign-out | n/a — generated as the levers' control experiment                                               |
