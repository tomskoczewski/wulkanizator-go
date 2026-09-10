import { defineConfig, devices } from "@playwright/test";

// Local-stack credentials for the fixture accounts and the cleanup client (see .env.e2e.example).
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // Absent file is fine when the values already come from the environment (CI).
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

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
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner-a.json" },
      dependencies: ["setup"],
    },
  ],
});
