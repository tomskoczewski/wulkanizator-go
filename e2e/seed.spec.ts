/**
 * SEED TEST — the exemplar every other spec in this repo is modeled on.
 *
 * risk: context/foundation/test-plan.md #1 — "a worker taps a status, the tile updates, the write
 *       never landed". The unit suite (DayPlanBoard.test.tsx) proves the *rollback* branch with a
 *       stubbed fetch; only a browser against the real stack can prove the opposite: that a tap
 *       the UI accepted actually survived the round trip to Postgres.
 *
 * What this file demonstrates, and what every generated spec must copy:
 *   1. Role-based locators only — getByRole / getByLabel / getByText, never CSS or DOM structure.
 *   2. One self-contained test — its own setup, action, assertion and cleanup; no shared state.
 *   3. Waiting for state, never for time — waitForResponse / web-first assertions, no waitForTimeout.
 *   4. Unique test data (timestamp suffix) plus teardown, so re-runs and parallel runs never collide.
 *   5. Auth via storageState (playwright.config.ts), never by driving the sign-in form here.
 */
import { test, expect } from "@playwright/test";
import { deleteCustomerByPhone, seedAppointment, workshopIdOf } from "./support/db";
import { waitForIslands } from "./support/hydration";
import { uniqueStamp } from "./support/unique";
import { workshopTodayDateString } from "@/lib/workshop-clock";

// The workshop has a single active bay, so specs cannot share a wall-clock window. 16:00 is this
// file's reservation; a new spec picks its own (see e2e/README.md).
const SLOT_TIME = "16:00";

test.describe("Risk #1 — a status change the UI accepted really landed in the database", () => {
  test("zmiana statusu wizyty przetrwa przeładowanie planu dnia", async ({ page }, testInfo) => {
    // Unique per run *and* per worker: the customer's phone is the handle teardown deletes by, and
    // the name is what every locator below matches on. See support/unique.ts for why Date.now()
    // alone is not enough.
    const stamp = uniqueStamp(testInfo);
    const customerName = `Seed ${stamp}`;
    const customerPhone = stamp;
    const date = workshopTodayDateString();

    const advanceToInProgress = page.getByRole("button", { name: `W trakcie — ${customerName}, ${SLOT_TIME}` });
    const advanceToDone = page.getByRole("button", { name: `Gotowe — ${customerName}, ${SLOT_TIME}` });

    try {
      // Setup: an appointment waiting on today's plan. Seeded through the service-role client
      // because the assertion is about a *status change*, not about booking.
      await seedAppointment({
        workshopId: await workshopIdOf(process.env.E2E_OWNER_A_EMAIL ?? ""),
        date,
        time: SLOT_TIME,
        customerFirstName: customerName,
        customerPhone,
      });

      await page.goto(`/dashboard?data=${date}`);
      await expect(advanceToInProgress).toBeVisible();
      // The button is server-rendered before its island hydrates; clicking it too early hits no React
      // handler at all, the PATCH never leaves the browser, and the wait below hangs to timeout.
      await waitForIslands(page);

      // Action: tap the status forward, and wait for the write to answer — not for a duration.
      const statusWrite = page.waitForResponse(
        (response) => response.url().includes("/api/appointment-status/") && response.request().method() === "PATCH",
      );
      await advanceToInProgress.click();
      await statusWrite;

      // Assertion: after a full reload the server must hand back the new status. The advance button
      // is the witness — its accessible name encodes the *next* target, so "Gotowe — …" can only
      // render if the row is now `in_progress` in Postgres. This fails if the risk materializes.
      await page.reload();
      await expect(advanceToDone).toBeVisible();
      await expect(advanceToInProgress).toBeHidden();
    } finally {
      // Cleanup: runs even when an assertion above fails, so a red test never poisons the next run.
      await deleteCustomerByPhone(customerPhone);
    }
  });
});
