@AGENTS.md

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->

### E2E Testing Rules

Every E2E test in `e2e/` — hand-written or generated — follows these. `e2e/seed.spec.ts` is the
worked exemplar; `e2e/README.md` carries the project-specific conventions (island hydration, the
per-spec wall-clock window, the SQL back door).

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to `getByTestId` only
  when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for specific conditions: `toBeVisible()`, `waitForURL()`,
  `waitForResponse()`. Before the first interaction on a page, wait for island hydration with
  `waitForIslands(page)` — typing into a controlled React input before it hydrates is lost.
- Assert the business outcome, not implementation details. Control question for every assertion:
  _would it fail if the `context/foundation/test-plan.md` risk materialized?_ If not, it is
  decorative — replace it.
- Use unique identifiers for test data — `uniqueStamp(testInfo)` from `e2e/support/unique.ts`, never
  a bare `Date.now()`: two specs starting in the same millisecond in different workers get the same
  value, and teardown-by-phone then deletes the other spec's rows mid-test. Clean up in a `finally`
  block via `deleteCustomerByPhone()` so re-runs and parallel runs never collide.
- Use `storageState` for authentication — never log in through the UI in individual tests. The only
  place the sign-in form is driven is `e2e/auth.setup.ts`.
- Name the test after the risk it protects, and open the file with a provenance header naming that
  risk and the seed.
- Keep the real boundaries real: auth, routing and Postgres are never mocked. Mock only expensive or
  non-deterministic _external_ APIs, at the network layer.
