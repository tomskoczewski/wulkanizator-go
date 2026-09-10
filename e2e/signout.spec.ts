/**
 * risk: signing out must really end the session, not just repaint the header.
 *
 * This one cuts across every layer at once — the UserMenu island, the POST to
 * /api/auth/signout, the Supabase auth cookies, and the route guard in
 * src/lib/auth-guard.ts that middleware.ts consults on the *next* request. No unit test can
 * see that seam: auth-guard.ts unit-tests prove the table's decisions against a `profile`
 * object handed to it, and they stay green even if signOut() never clears the cookie. Only a
 * real browser against the real stack can prove that after clicking "Wyloguj" the cookie jar
 * no longer buys access to /dashboard.
 *
 * Uses owner-B's session on purpose. `supabase.auth.signOut()` revokes the account's refresh
 * token server-side, so a spec that signs out owner-A would invalidate the shared
 * playwright/.auth/owner-a.json session every other spec runs on — a green test here would
 * turn seed.spec.ts red in a parallel worker. Owner B owns a separate workshop and no other
 * spec drives its session, so the blast radius stays inside this file. No wall-clock window is
 * reserved (see e2e/README.md §2): this spec books nothing.
 */
import { test, expect } from "@playwright/test";
import { waitForIslands } from "./support/hydration";

test.use({ storageState: "playwright/.auth/owner-b.json" });

test.describe("Wylogowanie naprawdę kończy sesję", () => {
  test("po wylogowaniu chroniona strona nie jest już dostępna", async ({ page }) => {
    // Given: an authenticated session that the guard lets through to the day plan.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dzisiaj" })).toBeVisible();

    // The account menu is a React island; opening it before hydration does nothing.
    await waitForIslands(page);
    await page.getByRole("button", { name: "Menu konta" }).click();

    // When: the user signs out. The button submits a real form, so the browser follows
    // signout's redirect to "/", which the guard bounces on to sign-in — waiting for that URL
    // is waiting for the round trip to finish, not for a duration.
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await page.waitForURL("**/auth/signin");
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();

    // Then: the protected route is closed. Asking for it directly is the assertion that
    // matters — a session that only *looks* ended would serve the day plan here.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/signin$/);
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dzisiaj" })).toBeHidden();

    // And the same holds one layer down: the cookies left in the jar no longer authenticate an
    // API call. The guard answers /api/* with 401 JSON rather than a redirect, so a stale
    // session would show up here as any other status.
    const apiResponse = await page.request.get("/api/appointments/slots");
    expect(apiResponse.status()).toBe(401);
  });
});
