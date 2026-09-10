/**
 * Signs in each fixture account once per run and persists its session to playwright/.auth/.
 *
 * This is the only place the sign-in form is ever driven: individual specs start already
 * authenticated via storageState, so a UI change to the login form can never turn every other
 * spec red (and no spec pays the sign-in round trip).
 */
import { test as setup, expect } from "@playwright/test";
import { waitForIslands } from "./support/hydration";

const ACCOUNTS = [
  { role: "owner-a", email: process.env.E2E_OWNER_A_EMAIL, password: process.env.E2E_OWNER_A_PASSWORD },
  { role: "owner-b", email: process.env.E2E_OWNER_B_EMAIL, password: process.env.E2E_OWNER_B_PASSWORD },
];

for (const account of ACCOUNTS) {
  setup(`authenticate as ${account.role}`, async ({ page }) => {
    if (!account.email || !account.password) {
      throw new Error(`missing credentials for ${account.role} — copy .env.e2e.example to .env.e2e`);
    }

    await page.goto("/auth/signin");
    // The form is a React island: fill only once it can hear the input events.
    await waitForIslands(page);
    await page.getByRole("textbox", { name: "E-mail" }).fill(account.email);
    await page.getByRole("textbox", { name: "Hasło" }).fill(account.password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();

    // Wait for the guard to hand us the app, not for a timeout.
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: "Dzisiaj" })).toBeVisible();

    await page.context().storageState({ path: `playwright/.auth/${account.role}.json` });
  });
}
