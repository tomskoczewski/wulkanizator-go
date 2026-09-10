import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "@/types";
import { resolveFailureStatus } from "./status-failure";

/**
 * One case per row of the server failure taxonomy in
 * `context/changes/testing-mutation-failure-ui/research.md` §2. Covering the whole taxonomy here, in
 * the node environment, is what lets the DOM suites prove only *wiring* rather than re-enumerating
 * status codes at the expensive layer.
 */
describe("resolveFailureStatus", () => {
  it("reverts on a 503 — Supabase unconfigured", () => {
    expect(resolveFailureStatus("waiting", { status: 503, body: { error: "Brak konfiguracji." } })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });

  it("reverts on a 400 carrying a single `error` — bad id param", () => {
    expect(resolveFailureStatus("waiting", { status: 400, body: { error: "Nieprawidłowy identyfikator." } })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });

  it("reverts on a 400 carrying zod `errors` — body validation", () => {
    expect(resolveFailureStatus("in_progress", { status: 400, body: { errors: { status: ["Wymagane."] } } })).toEqual({
      status: "in_progress",
      resynced: false,
    });
  });

  it("reverts on a 400 for an illegal transition — a same-status no-op", () => {
    expect(
      resolveFailureStatus("done", { status: 400, body: { errors: { status: ["Niedozwolona zmiana statusu."] } } }),
    ).toEqual({ status: "done", resynced: false });
  });

  it("reverts on a 404 — unknown id, or another workshop's row", () => {
    expect(resolveFailureStatus("waiting", { status: 404, body: { error: "Nie znaleziono wizyty." } })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });

  it("resyncs to `current` on a 409 that carries it — `stale`, the row moved underneath us", () => {
    expect(
      resolveFailureStatus("waiting", {
        status: 409,
        body: { error: "Ktoś inny zmienił status.", current: "in_progress" },
      }),
    ).toEqual({ status: "in_progress", resynced: true });
  });

  it("resyncs to a terminal `current` too — the DOM suites have no witness for this, so it is covered here", () => {
    expect(
      resolveFailureStatus("waiting", {
        status: 409,
        body: { error: "Ktoś inny zmienił status.", current: "no_show" },
      }),
    ).toEqual({
      status: "no_show",
      resynced: true,
    });
  });

  it("reverts on a 409 that carries no `current` — `slot_taken`, where the row never moved", () => {
    expect(resolveFailureStatus("no_show", { status: 409, body: { error: "Termin jest już zajęty." } })).toEqual({
      status: "no_show",
      resynced: false,
    });
  });

  it("reverts on a 500 — an unhandled throw", () => {
    expect(resolveFailureStatus("in_progress", { status: 500, body: { error: "Coś poszło nie tak." } })).toEqual({
      status: "in_progress",
      resynced: false,
    });
  });

  it("reverts on a network failure, which carries no status at all", () => {
    expect(resolveFailureStatus("waiting", {})).toEqual({ status: "waiting", resynced: false });
  });

  // Shapes the route does not produce today, pinned because the function reads `body` as `unknown`
  // and must not throw on one. Each still reverts.
  it("reverts rather than throwing when a 409 body is unparseable", () => {
    expect(resolveFailureStatus("waiting", { status: 409, body: null })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });

  it("reverts rather than throwing when a 409 body is not an object", () => {
    expect(resolveFailureStatus("waiting", { status: 409, body: "<!doctype html>" })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });

  it("keys the resync on the 409 status, not on a `current` that arrives with some other code", () => {
    const current: AppointmentStatus = "in_progress";

    expect(resolveFailureStatus("waiting", { status: 500, body: { current } })).toEqual({
      status: "waiting",
      resynced: false,
    });
  });
});
