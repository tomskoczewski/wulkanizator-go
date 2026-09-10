// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AppointmentStatus } from "@/types";
import { StatusPill } from "./StatusPill";

afterEach(cleanup);

// Labels written out literally rather than read back from APPOINTMENT_STATUS_PRESENTATION — a test
// that sources its expectations from the module under test asserts nothing. These are the strings
// locked in design-system.md:82-88. Completeness of the mapping is already a compile-time guarantee
// (`Record<AppointmentStatus, …>`), so this file's real value is one-time harness proof: render,
// query, per-file happy-dom environment, and cleanup all working end to end.
const EXPECTED_LABELS: readonly [AppointmentStatus, string][] = [
  ["waiting", "Oczekuje"],
  ["in_progress", "W trakcie"],
  ["done", "Gotowe"],
  ["no_show", "Nie przyjechał"],
  ["cancelled", "Anulowane"],
];

describe("StatusPill", () => {
  it.each(EXPECTED_LABELS)("shows %s as %s", (status, label) => {
    render(<StatusPill status={status} />);

    expect(screen.getByText(label).textContent).toBe(label);
  });

  // Depends on running after the cases above: if afterEach(cleanup) were missing, their markup would
  // still be in the document and the first assertion would fail.
  it("starts from an empty document, proving afterEach(cleanup) is wired", () => {
    expect(document.body.textContent).toBe("");

    render(<StatusPill status="waiting" />);

    expect(screen.getByText("Oczekuje").textContent).toBe("Oczekuje");
  });
});
