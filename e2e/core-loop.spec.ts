/**
 * risk: context/foundation/test-plan.md #4 — "a change inside one slice silently breaks the
 *       neighbouring slice's contract: a just-booked appointment does not appear on the day plan,
 *       while every unit test stays green". Named in the Phase 2 interview (Q4) as the scariest
 *       gap, and in roadmap.md §S-03 as the place the S-01 → S-02 → S-03 chain would surface drift.
 * seed: e2e/seed.spec.ts
 *
 * The chain each unit suite sees only one link of: booking form island -> POST /api/appointments ->
 * Postgres -> the server-rendered day plan -> the appointment's own page. slot-suggestions.test.ts
 * and DayPlanBoard.test.tsx both stay green when the two halves disagree about the date, the bay,
 * or the shape of an entry — only a browser walking the whole chain can see that.
 *
 * Nothing is mocked: real session, real routing, real API, real database.
 */
import { test, expect } from "@playwright/test";
import { deleteCustomerByPhone } from "./support/db";
import { waitForIslands } from "./support/hydration";
import { uniqueStamp } from "./support/unique";

test.describe("Risk #4 — the booking → day plan chain holds across slices", () => {
  test("zarezerwowana wizyta pojawia się na planie dnia swojego terminu", async ({ page }, testInfo) => {
    // Unique per run *and* per worker (see support/unique.ts): the phone is the teardown handle,
    // the name is what every locator matches on.
    const stamp = uniqueStamp(testInfo);
    const customerName = `Rezerwacja ${stamp}`;
    const customerPhone = stamp;

    try {
      // Book through the UI, exactly as an owner would — the form is an island, so wait for it to
      // hear input events before typing into it.
      await page.goto("/wizyty/nowa");
      await waitForIslands(page);

      // Picking a service is what makes the server propose slots; wait for that answer, not a delay.
      const slotsAnswer = page.waitForResponse((response) => response.url().includes("/api/appointments/slots"));
      await page.getByRole("button", { name: "Wymiana kół 30 min" }).click();
      await slotsAnswer;

      // Take whichever slot the workshop offers first — the test must not out-guess the suggestion
      // engine, only insist that what it sells actually lands on the plan.
      const earliestSlot = page.getByRole("button", { name: /^\d{2}:\d{2}/ }).first();
      await expect(earliestSlot).toBeVisible();
      await earliestSlot.click();

      await page.getByRole("textbox", { name: "Telefon" }).fill(customerPhone);
      await page.getByRole("textbox", { name: "Klient" }).fill(customerName);
      await page.getByRole("button", { name: "Zapisz wizytę" }).click();

      // The confirmation is the app's own promise to the user: this date, this hour. Everything
      // below checks the rest of the system kept that promise.
      const confirmation = page.getByText(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}–\d{2}:\d{2}$/);
      await expect(confirmation).toBeVisible();

      const promised = /^(\d{2})\.(\d{2})\.(\d{4}), (\d{2}:\d{2})/.exec((await confirmation.textContent()) ?? "");
      if (!promised) throw new Error("booking confirmation did not name a date and time");
      const [, day, month, year, time] = promised;

      // The other slice: the day plan for the promised date, rendered by the server from Postgres.
      // If the chain drifted — wrong date range, wrong workshop scope, an entry shape the board
      // cannot render — the appointment is missing here and this test goes red.
      await page.goto(`/dashboard?data=${year}-${month}-${day}`);
      await expect(page.getByRole("link", { name: `Szczegóły wizyty — ${customerName}` })).toBeVisible();

      // The advance button's accessible name encodes the *next* status and the hour, so this single
      // assertion pins that the plan shows the booking at the promised time and as still waiting —
      // not merely that the customer's name appears somewhere on the page.
      await expect(page.getByRole("button", { name: `W trakcie — ${customerName}, ${time}` })).toBeVisible();

      // Last link of the chain: the row's own page resolves rather than 404-ing.
      await page.getByRole("link", { name: `Szczegóły wizyty — ${customerName}` }).click();
      await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
    } finally {
      // Cleanup runs even on a red assertion, so a failed run never poisons the next one.
      await deleteCustomerByPhone(customerPhone);
    }
  });
});
