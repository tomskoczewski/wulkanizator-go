import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/types";
import { isTransitionAllowed, nextStatus } from "./appointment-transitions";

const ALL_STATUSES: AppointmentStatus[] = ["waiting", "in_progress", "done", "no_show", "cancelled"];

describe("nextStatus", () => {
  it("advances waiting to in_progress", () => {
    expect(nextStatus("waiting")).toBe("in_progress");
  });

  it("advances in_progress to done", () => {
    expect(nextStatus("in_progress")).toBe("done");
  });

  it("has no forward step from done, no_show, or cancelled", () => {
    expect(nextStatus("done")).toBeNull();
    expect(nextStatus("no_show")).toBeNull();
    expect(nextStatus("cancelled")).toBeNull();
  });
});

describe("isTransitionAllowed", () => {
  it("rejects every self-transition", () => {
    for (const status of ALL_STATUSES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });

  it("rejects every pair touching cancelled in either direction", () => {
    for (const status of ALL_STATUSES) {
      if (status === "cancelled") continue;
      expect(isTransitionAllowed("cancelled", status)).toBe(false);
      expect(isTransitionAllowed(status, "cancelled")).toBe(false);
    }
  });

  it("accepts the backward moves the detail page depends on", () => {
    expect(isTransitionAllowed("done", "waiting")).toBe(true);
    expect(isTransitionAllowed("no_show", "waiting")).toBe(true);
    expect(isTransitionAllowed("in_progress", "waiting")).toBe(true);
  });

  it("accepts the forward moves the day plan depends on", () => {
    expect(isTransitionAllowed("waiting", "in_progress")).toBe(true);
    expect(isTransitionAllowed("in_progress", "done")).toBe(true);
  });
});
