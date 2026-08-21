import { describe, expect, it } from "vitest";
import { suggestSlots, type Interval, type SlotBay } from "./slot-suggestions";

// Naive Date helper: UTC fields hold workshop-local wall-clock values, matching workshop-clock.ts.
function local(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

function window(year: number, month: number, day: number, opensHour: number, closesHour: number): Interval {
  return { start: local(year, month, day, opensHour), end: local(year, month, day, closesHour) };
}

const BAY_A: SlotBay = { id: "bay-a", name: "Stanowisko 1" };
const BAY_B: SlotBay = { id: "bay-b", name: "Stanowisko 2" };

describe("suggestSlots", () => {
  it("starts slots at the window open, spaced by stepMin, on an empty day", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 45,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 3,
    });

    expect(slots.map((s) => [s.start.getUTCHours(), s.start.getUTCMinutes()])).toEqual([
      [7, 0],
      [7, 15],
      [7, 30],
    ]);
  });

  it("offers no slot before `earliest`, snapping the first slot up to the grid", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 30,
      earliest: local(2026, 9, 1, 9, 7),
      stepMin: 15,
      limit: 1,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].start).toEqual(local(2026, 9, 1, 9, 15));
  });

  it("resumes the cursor on the grid at or after a busy block's end, never inside it", () => {
    const busyByBay = new Map<string, Interval[]>([
      [BAY_A.id, [{ start: local(2026, 9, 1, 9, 0), end: local(2026, 9, 1, 9, 40) }]],
    ]);

    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay,
      durationMin: 30,
      earliest: local(2026, 9, 1, 8, 45),
      stepMin: 15,
      limit: 1,
    });

    expect(slots).toHaveLength(1);
    // Busy block ends 9:40 -> next grid point is 9:45, not 9:00 or inside [9:00, 9:40).
    expect(slots[0].start).toEqual(local(2026, 9, 1, 9, 45));
  });

  it("offers a slot ending exactly when a busy block starts (back-to-back legality)", () => {
    const busyByBay = new Map<string, Interval[]>([
      [BAY_A.id, [{ start: local(2026, 9, 1, 10, 0), end: local(2026, 9, 1, 11, 0) }]],
    ]);

    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay,
      durationMin: 60,
      earliest: local(2026, 9, 1, 9, 0),
      stepMin: 15,
      limit: 5,
    });

    expect(slots.some((s) => s.start.getTime() === local(2026, 9, 1, 9, 0).getTime())).toBe(true);
  });

  it("offers no slot when the service is longer than the remaining window", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 30,
      earliest: local(2026, 9, 1, 17, 45),
      stepMin: 15,
      limit: 5,
    });

    expect(slots).toEqual([]);
  });

  it("never offers a slot ending after the window closes", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 45,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 100,
    });

    for (const slot of slots) {
      expect(+slot.end).toBeLessThanOrEqual(+local(2026, 9, 1, 18));
    }
  });

  it("returns empty, not a partial or negative-length slot, when the service exceeds the entire window", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 8)], // 1-hour window
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 90,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 5,
    });

    expect(slots).toEqual([]);
  });

  it("contributes nothing and raises no error for a closed day (no window supplied)", () => {
    const slots = suggestSlots({
      dayWindows: [],
      bays: [BAY_A],
      busyByBay: new Map(),
      durationMin: 45,
      earliest: local(2026, 9, 1, 0),
    });

    expect(slots).toEqual([]);
  });

  it("interleaves results from multiple bays by time, ranked by start then bay name", () => {
    const busyByBay = new Map<string, Interval[]>([
      [BAY_A.id, [{ start: local(2026, 9, 1, 7, 0), end: local(2026, 9, 1, 7, 15) }]],
    ]);

    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_B, BAY_A],
      busyByBay,
      durationMin: 15,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 3,
    });

    // Bay A is busy 7:00-7:15, so 7:00 has only Bay B; 7:15 has both, Bay A sorting before Bay B by name.
    expect(slots.map((s) => [s.start.getUTCHours(), s.start.getUTCMinutes(), s.bayName])).toEqual([
      [7, 0, "Stanowisko 2"],
      [7, 15, "Stanowisko 1"],
      [7, 15, "Stanowisko 2"],
    ]);
  });

  it("spills into the next supplied day window when today is full", () => {
    const busyByBay = new Map<string, Interval[]>([
      [BAY_A.id, [{ start: local(2026, 9, 1, 7, 0), end: local(2026, 9, 1, 18, 0) }]],
    ]);

    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18), window(2026, 9, 2, 7, 18)],
      bays: [BAY_A],
      busyByBay,
      durationMin: 30,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 2,
    });

    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.start.getUTCDate()).toBe(2);
    }
  });

  it("returns exactly `limit` results when more are available", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [BAY_A, BAY_B],
      busyByBay: new Map(),
      durationMin: 15,
      earliest: local(2026, 9, 1, 0),
      stepMin: 15,
      limit: 6,
    });

    expect(slots).toHaveLength(6);
  });

  it("returns an empty result when there are zero active bays", () => {
    const slots = suggestSlots({
      dayWindows: [window(2026, 9, 1, 7, 18)],
      bays: [],
      busyByBay: new Map(),
      durationMin: 45,
      earliest: local(2026, 9, 1, 0),
    });

    expect(slots).toEqual([]);
  });
});
