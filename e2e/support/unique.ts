/**
 * A test-data stamp that is unique even under parallel workers.
 *
 * `Date.now()` alone is not: two specs starting in the same millisecond in different workers get
 * the same value, and since teardown deletes by phone, the first one to finish deletes the other
 * one's rows *mid-test*. That was observed here — `Seed <n>` and `Obcy <n>` sharing a stamp, and
 * the day-plan assertion in a third spec failing because its appointment had been swept away.
 *
 * Appending `parallelIndex` closes it deterministically, with no randomness to reproduce: two tests
 * in the same millisecond are, by definition, in different workers. Digits only, because the phone
 * built from this stamp goes through `normalize_phone` in Postgres.
 */
import type { TestInfo } from "@playwright/test";

export function uniqueStamp(testInfo: TestInfo): string {
  return `${Date.now()}${testInfo.parallelIndex}`;
}
