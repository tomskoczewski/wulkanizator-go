/**
 * Every interactive control in this app lives inside an Astro island that is server-rendered first
 * and hydrated afterwards. Typing into a controlled React input before its island hydrates is
 * silently lost — the DOM takes the value, React's state does not, and the form submits empty.
 *
 * Astro's client runtime drops the `ssr` attribute from `<astro-island>` the moment that island is
 * hydrated, so "no island is still marked ssr" is the page's own readiness signal. Waiting on it is
 * waiting for state, not for time.
 */
import { expect, type Page } from "@playwright/test";

export async function waitForIslands(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}
