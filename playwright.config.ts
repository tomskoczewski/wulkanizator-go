import { defineConfig, devices } from "@playwright/test";

// Local-stack credentials for the fixture accounts and the cleanup client (see .env.e2e.example).
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // Absent file is fine when the values already come from the environment (CI).
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";
const IS_LOCAL_TARGET = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE_URL);

/**
 * E2E suite — see context/foundation/test-plan.md §3 Phase 4 for the risks it protects
 * and e2e/README.md for the conventions every spec follows.
 *
 * Auth is never performed through the UI inside a test: the `setup` project signs in once
 * per role and persists the session to playwright/.auth/<role>.json (gitignored).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    testIdAttribute: "data-testid",
  },
  // `npm run test:e2e` boots the app itself, so the whole suite is one command (`npm run test:all`).
  // An already-running `npm run dev` is reused. The decision keys on the host, not on whether
  // E2E_BASE_URL is set: .env.e2e sets it to localhost by default, so "is the var present" would
  // never start anything. A remote base URL (staging, a preview deployment) is somebody else's app.
  webServer: IS_LOCAL_TARGET
    ? {
        // `--ignore-lock` and ASTRO_DEV_BACKGROUND together keep `astro dev` in the FOREGROUND,
        // which is the only shape Playwright can supervise. Astro 7 forks itself into a background
        // daemon whenever it detects an agentic environment (Claude Code, Cursor — see
        // `am-i-vibing`), and the parent then exits: Playwright reports "Process from
        // config.webServer exited early" while an orphan keeps holding the port. Setting
        // ASTRO_DEV_BACKGROUND suppresses that auto-detection; `--ignore-lock` stops a stale
        // .astro lock file from aborting the start.
        command: "npm run dev -- --ignore-lock",
        env: { ASTRO_DEV_BACKGROUND: "1" },
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner-a.json" },
      dependencies: ["setup"],
    },
  ],
});
