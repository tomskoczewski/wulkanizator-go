/**
 * risk: context/foundation/test-plan.md #3 — "a signed-in user reads or mutates another workshop's
 *       data — a customer phone or plate, or an appointment on a bay that is not theirs".
 *       PRD §NFR (RODO baseline: access only when signed in and within the given workshop).
 * seed: e2e/seed.spec.ts
 *
 * Layer split, per test-plan §2 Risk Response Guidance: pgTAP owns the exhaustive per-operation,
 * per-role denial matrix (supabase/tests/rls_workshop_scope.test.sql). This spec takes the one
 * thing pgTAP cannot see — that the denial survives the whole stack, all the way to what the
 * browser renders. A policy can be correct while the page still leaks: `getAppointmentDetail`
 * returning null must become a 404 render, not a blank card, and never the customer's name or
 * phone. The guidance's named anti-pattern is "testing only the happy tenant"; this test asserts
 * nothing but denials.
 *
 * The appointment is seeded straight into workshop B over SQL because a session scoped to
 * workshop A — the only session this test drives — cannot create it. Nothing else is faked:
 * real session, real routing, real RLS.
 */
import { test, expect } from "@playwright/test";
import { deleteCustomerByPhone, seedAppointment, workshopIdOf } from "./support/db";
import { waitForIslands } from "./support/hydration";
import { uniqueStamp } from "./support/unique";

// Workshop B's own window (see e2e/README.md §2) — it shares no bay with workshop A's specs.
const SLOT_TIME = "15:00";

test.describe("Risk #3 — workshop A's session cannot reach workshop B's data", () => {
  test("wizyta obcego warsztatu jest niedostępna i nie ujawnia danych klienta", async ({ page }, testInfo) => {
    const stamp = uniqueStamp(testInfo);
    const foreignCustomerName = `Obcy ${stamp}`;
    const foreignCustomerPhone = stamp;
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;

    try {
      // Setup: an appointment that belongs to workshop B, with a customer whose name and phone
      // workshop A must never see.
      const { appointmentId } = await seedAppointment({
        workshopId: await workshopIdOf(process.env.E2E_OWNER_B_EMAIL ?? ""),
        date,
        time: SLOT_TIME,
        customerFirstName: foreignCustomerName,
        customerPhone: foreignCustomerPhone,
      });

      // Reading it by its own id — the case where the attacker already knows the id, not merely one
      // they were shown. The app must answer not-found, and must not render the customer.
      await page.goto(`/wizyty/${appointmentId}`);
      await waitForIslands(page);
      await expect(page.getByText("Nie znaleziono strony.")).toBeVisible();
      await expect(page.getByText(foreignCustomerName)).toBeHidden();
      await expect(page.getByText(foreignCustomerPhone)).toBeHidden();

      // Reading it through the day plan — the same denial one route over. Workshop A's plan for the
      // same date must not carry workshop B's appointment.
      await page.goto(`/dashboard?data=${date}`);
      await expect(page.getByRole("link", { name: `Szczegóły wizyty — ${foreignCustomerName}` })).toBeHidden();
      await expect(page.getByText(foreignCustomerName)).toBeHidden();

      // The "or mutates" half of the risk: the same session, the same foreign id, a write. The
      // guard answers /api/* with JSON rather than a redirect, so a leak would surface as a 200
      // here — and the appointment would silently change hands.
      const write = await page.request.patch(`/api/appointment-status/${appointmentId}`, {
        data: { status: "in_progress", from: "waiting" },
      });
      expect(write.status()).not.toBe(200);
      expect(write.status()).toBe(404);
    } finally {
      await deleteCustomerByPhone(foreignCustomerPhone);
    }
  });
});
