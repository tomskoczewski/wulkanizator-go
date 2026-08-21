import { describe, expect, it } from "vitest";
import { shiftDateString, workshopTodayDateString } from "@/lib/workshop-clock";
import { countByStatus, filterByStatus, sortDayPlan, type DayPlanEntry } from "./day-plan";

function entry(overrides: Partial<DayPlanEntry> = {}): DayPlanEntry {
  return {
    id: "id-1",
    status: "waiting",
    startsAt: "2026-09-01T09:00:00",
    endsAt: "2026-09-01T09:30:00",
    customerFirstName: "Jan",
    customerPhone: "500600700",
    serviceName: "Wymiana opon",
    durationMin: 30,
    bayName: "Stanowisko 1",
    ...overrides,
  };
}

describe("sortDayPlan", () => {
  it("orders same-start appointments on different bays by bay name", () => {
    const entries = [
      entry({ id: "b", startsAt: "2026-09-01T09:00:00", bayName: "Stanowisko 2" }),
      entry({ id: "a", startsAt: "2026-09-01T09:00:00", bayName: "Stanowisko 1" }),
    ];

    expect(sortDayPlan(entries).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("leaves already-sorted input unchanged", () => {
    const entries = [
      entry({ id: "first", startsAt: "2026-09-01T08:00:00" }),
      entry({ id: "second", startsAt: "2026-09-01T09:00:00" }),
    ];

    expect(sortDayPlan(entries).map((e) => e.id)).toEqual(["first", "second"]);
  });
});

describe("countByStatus", () => {
  it("returns all zeros for an empty day", () => {
    expect(countByStatus([])).toEqual({ total: 0, waiting: 0, done: 0, noShow: 0 });
  });

  it("counts in_progress and cancelled-like rows toward the total with no tile of their own", () => {
    const entries = [entry({ status: "waiting" }), entry({ status: "in_progress" }), entry({ status: "done" })];

    expect(countByStatus(entries)).toEqual({ total: 3, waiting: 1, done: 1, noShow: 0 });
  });
});

describe("filterByStatus", () => {
  it("returns every entry unchanged when status is null", () => {
    const entries = [entry({ id: "w", status: "waiting" }), entry({ id: "d", status: "done" })];

    expect(filterByStatus(entries, null)).toEqual(entries);
  });

  it("returns only entries matching the given status", () => {
    const entries = [entry({ id: "w", status: "waiting" }), entry({ id: "d", status: "done" })];

    expect(filterByStatus(entries, "waiting").map((e) => e.id)).toEqual(["w"]);
  });
});

describe("shiftDateString", () => {
  it("crosses a month boundary", () => {
    expect(shiftDateString("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses a year boundary", () => {
    expect(shiftDateString("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("crosses a leap day", () => {
    expect(shiftDateString("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateString("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("shifts backwards across a month boundary", () => {
    expect(shiftDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("workshopTodayDateString", () => {
  it("returns the Warsaw date when UTC and Warsaw disagree (23:30 UTC in summer)", () => {
    const instant = new Date("2026-06-15T23:30:00Z");

    expect(workshopTodayDateString(instant)).toBe("2026-06-16");
  });
});
