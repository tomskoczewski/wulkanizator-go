// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DayPlanEntry } from "@/lib/services/day-plan";
import DayPlanBoard from "./DayPlanBoard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

/** No active filter, so nothing can unmount a row mid-assertion (see the plan's Open Risks). */
function renderBoard(entries: DayPlanEntry[]) {
  return render(
    <DayPlanBoard
      entries={entries}
      workingHours={null}
      date="2026-09-01"
      prevDate="2026-08-31"
      nextDate="2026-09-02"
      today="2026-09-01"
    />,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Every Polish status label is permanently on screen as a filter button, so a document-scope
 * `getByText("Oczekuje")` matches the filter pill rather than a row. Reach the row through its
 * detail link — the one accessible name unique to it — and query inside it.
 */
function row(firstName: string): HTMLElement {
  const link = screen.getByLabelText(`Szczegóły wizyty — ${firstName}`);
  const container = link.parentElement;
  if (!container) throw new Error(`row for ${firstName} has no container element`);
  return container;
}

/**
 * The advance button is the only `<button>` inside a row. Its accessible name encodes the *target*
 * status, which makes it an unambiguous witness of the row's *current* one: a `waiting` row's button
 * is named "W trakcie — Jan, 09:00"; once the row is `in_progress` it is named "Gotowe — Jan, 09:00".
 */
function advanceButtonName(firstName: string): string | null {
  return within(row(firstName)).getByRole("button").getAttribute("aria-label");
}

function advanceButton(firstName: string): HTMLElement {
  return within(row(firstName)).getByRole("button");
}

function rowMessage(firstName: string): string | null {
  return within(row(firstName)).getByRole("status").textContent;
}

describe("DayPlanBoard — a failed status write", () => {
  it("puts the row back and tells the worker the server was unreachable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderBoard([entry({ status: "waiting" })]);

    expect(advanceButtonName("Jan")).toBe("W trakcie — Jan, 09:00");

    await user.click(advanceButton("Jan"));

    await waitFor(() => {
      expect(rowMessage("Jan")).toBe("Nie udało się połączyć z serwerem.");
    });
    expect(advanceButtonName("Jan")).toBe("W trakcie — Jan, 09:00");
  });

  it("puts the row back and shows the server's own message on a 500", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "Coś poszło nie tak." })));
    renderBoard([entry({ status: "waiting" })]);

    await user.click(advanceButton("Jan"));

    await waitFor(() => {
      expect(rowMessage("Jan")).toBe("Coś poszło nie tak.");
    });
    expect(advanceButtonName("Jan")).toBe("W trakcie — Jan, 09:00");
  });

  it("keeps the row at the server's status on a 409 that carries `current`, and still shows the message", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Ktoś inny zmienił status.", current: "in_progress" })),
    );
    renderBoard([entry({ status: "waiting" })]);

    await user.click(advanceButton("Jan"));

    await waitFor(() => {
      expect(rowMessage("Jan")).toBe("Ktoś inny zmienił status.");
    });
    // `in_progress`, not back to `waiting` — the 409 is the row's true state, so the rollback is
    // suppressed rather than applied.
    expect(advanceButtonName("Jan")).toBe("Gotowe — Jan, 09:00");
  });

  it("moves the row to a `current` that is neither where it started nor where the tap aimed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Ktoś inny zmienił status.", current: "waiting" })),
    );
    // Tapping `in_progress → done` while the server says the row is back at `waiting`. All three
    // statuses differ, so this fails both if the row reverts to `from` and if the 409 branch merely
    // suppresses the rollback without reading `current`.
    renderBoard([entry({ status: "in_progress" })]);

    expect(advanceButtonName("Jan")).toBe("Gotowe — Jan, 09:00");

    await user.click(advanceButton("Jan"));

    await waitFor(() => {
      expect(advanceButtonName("Jan")).toBe("W trakcie — Jan, 09:00");
    });
    expect(rowMessage("Jan")).toBe("Ktoś inny zmienił status.");
  });

  it("puts the row back on a 409 that carries no `current` — the slot was retaken, the row never moved", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: "Termin jest już zajęty." })));
    renderBoard([entry({ status: "waiting" })]);

    await user.click(advanceButton("Jan"));

    await waitFor(() => {
      expect(rowMessage("Jan")).toBe("Termin jest już zajęty.");
    });
    // Reverted to `waiting`, unlike the 409 above — the pair is what separates correct code from
    // "any 409 resyncs".
    expect(advanceButtonName("Jan")).toBe("W trakcie — Jan, 09:00");
  });

  it("re-enables the button after the failure so the worker can retry", async () => {
    const user = userEvent.setup();
    let settle!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(inFlight));
    renderBoard([entry({ status: "waiting" })]);

    await user.click(advanceButton("Jan"));

    // Observed while the stubbed fetch is still unresolved: the optimistic update has already moved
    // the row to `in_progress`, so the button is now named for `done`.
    const pendingButton = advanceButton("Jan");
    expect(pendingButton.getAttribute("aria-label")).toBe("Gotowe — Jan, 09:00");
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      settle(jsonResponse(500, { error: "Coś poszło nie tak." }));
      await inFlight;
    });

    await waitFor(() => {
      expect(rowMessage("Jan")).toBe("Coś poszło nie tak.");
    });
    const settledButton = advanceButton("Jan");
    expect(settledButton.getAttribute("aria-label")).toBe("W trakcie — Jan, 09:00");
    expect(settledButton.getAttribute("aria-busy")).toBe("false");
    expect((settledButton as HTMLButtonElement).disabled).toBe(false);
  });
});
