// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppointmentStatus } from "@/types";
import { AppointmentStatusPanel } from "./AppointmentStatusPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderPanel(status: AppointmentStatus) {
  return render(<AppointmentStatusPanel id="apt-1" status={status} customerPhone="500600700" />);
}

/**
 * Step buttons live inside the `role="group"` / `aria-label="Status wizyty"` container — the panel
 * has no `StatusPill`, so `aria-current="step"` on a step button is the only current-status witness,
 * and it exists only for `FORWARD_STEPS` (`waiting`, `in_progress`, `done`) — never for `no_show`.
 */
function stepGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Status wizyty" });
}

const STEP_LABELS = ["Oczekuje", "W trakcie", "Gotowe"] as const;
type StepLabel = (typeof STEP_LABELS)[number];

// Accessible names concatenate label and note (e.g. "Oczekuje Klient zapisany") — match the label
// prefix via textContent rather than an exact accessible-name string.
function stepButton(label: StepLabel): HTMLElement {
  const match = within(stepGroup())
    .getAllByRole("button")
    .find((button) => button.textContent.startsWith(label));
  if (!match) throw new Error(`no step button starting with "${label}"`);
  return match;
}

function activeStepLabel(): StepLabel | null {
  return STEP_LABELS.find((label) => stepButton(label).getAttribute("aria-current") === "step") ?? null;
}

function noShowButton(): HTMLElement {
  return screen.getByRole("button", { name: /Nie przyjechał/ });
}

function message(): string | null {
  return screen.queryByRole("status")?.textContent ?? null;
}

describe("AppointmentStatusPanel — a failed status write", () => {
  it("reverts the active step and tells the worker the server was unreachable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderPanel("waiting");

    expect(activeStepLabel()).toBe("Oczekuje");

    await user.click(stepButton("W trakcie"));

    await waitFor(() => {
      expect(message()).toBe("Nie udało się połączyć z serwerem.");
    });
    expect(activeStepLabel()).toBe("Oczekuje");
  });

  it("reverts the active step and shows the server's own message on a 500", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "Coś poszło nie tak." })));
    renderPanel("waiting");

    await user.click(stepButton("W trakcie"));

    await waitFor(() => {
      expect(message()).toBe("Coś poszło nie tak.");
    });
    expect(activeStepLabel()).toBe("Oczekuje");
  });

  it("resyncs to the server's status on a 409 that carries `current`, and still shows the message", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Ktoś inny zmienił status.", current: "in_progress" })),
    );
    renderPanel("waiting");

    await user.click(stepButton("W trakcie"));

    await waitFor(() => {
      expect(message()).toBe("Ktoś inny zmienił status.");
    });
    // `in_progress`, not back to `waiting` — the 409 is the row's true state, so the revert is
    // suppressed rather than applied.
    expect(activeStepLabel()).toBe("W trakcie");
  });

  it("resyncs to a `current` that is neither where it started nor where the tap aimed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Ktoś inny zmienił status.", current: "waiting" })),
    );
    // Tapping in_progress → done while the server says the row is back at waiting. All three differ,
    // so this fails both if the panel blindly reverts to `from` and if it merely keeps the
    // optimistic `target` — the same vacuity gap the plan's own `current: "in_progress"` case leaves
    // open when `current` happens to equal `target`.
    renderPanel("in_progress");

    expect(activeStepLabel()).toBe("W trakcie");

    await user.click(stepButton("Gotowe"));

    await waitFor(() => {
      expect(activeStepLabel()).toBe("Oczekuje");
    });
    expect(message()).toBe("Ktoś inny zmienił status.");
  });

  it("reverts on a 409 that carries no `current`", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: "Termin jest już zajęty." })));
    renderPanel("waiting");

    await user.click(stepButton("W trakcie"));

    await waitFor(() => {
      expect(message()).toBe("Termin jest już zajęty.");
    });
    // Reverted to `waiting`, unlike the case above — the pair is what separates correct code from
    // "any 409 resyncs".
    expect(activeStepLabel()).toBe("Oczekuje");
  });

  it("busies only the tapped step while in flight, disables every control panel-wide, then re-enables all of them", async () => {
    const user = userEvent.setup();
    let settle!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(inFlight));
    renderPanel("waiting");

    await user.click(stepButton("W trakcie"));

    // Observed while the stubbed fetch is still unresolved (`pendingTarget` is cleared only after
    // `changeStatus` returns, so this cannot be checked after awaiting the click).
    const tapped = stepButton("W trakcie");
    const untouchedStep = stepButton("Gotowe");
    const sidebarButton = noShowButton();

    expect(tapped.getAttribute("aria-busy")).toBe("true");
    expect((tapped as HTMLButtonElement).disabled).toBe(true);
    // `isPending` is panel-wide: every other control disables too, but only the tapped step is
    // marked busy — a single shared flag, not a copy per button.
    expect(untouchedStep.getAttribute("aria-busy")).toBe("false");
    expect((untouchedStep as HTMLButtonElement).disabled).toBe(true);
    expect((sidebarButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      settle(jsonResponse(500, { error: "Coś poszło nie tak." }));
      await inFlight;
    });

    await waitFor(() => {
      expect(message()).toBe("Coś poszło nie tak.");
    });

    // The panel-wide re-enable: a button other than the one tapped comes back too, not only the
    // tapped one — the detail this surface adds beyond the board's per-row pending state.
    expect(stepButton("W trakcie").getAttribute("aria-busy")).toBe("false");
    expect((stepButton("W trakcie") as HTMLButtonElement).disabled).toBe(false);
    expect((stepButton("Gotowe") as HTMLButtonElement).disabled).toBe(false);
    expect((noShowButton() as HTMLButtonElement).disabled).toBe(false);
  });
});
