import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./useJsonMutation";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("surfaces a 409's status and body alongside the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { error: "Ktoś inny zmienił status.", current: "in_progress" })),
    );

    const result = await requestJson("/api/appointment-status/1", "PATCH", { status: "done", from: "waiting" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(409);
    expect(result.failure.message).toBe("Ktoś inny zmienił status.");
    expect((result.failure.body as { current: string }).current).toBe("in_progress");
  });

  it("keeps fieldErrors and message behavior unchanged for a 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { errors: { status: ["Wymagane."] } })));

    const result = await requestJson("/api/appointment-status/1", "PATCH", {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.fieldErrors).toEqual({ status: ["Wymagane."] });
    expect(result.failure.message).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });

  it("still yields the default message with status set when the body is unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 500 })));

    const result = await requestJson("/api/appointment-status/1", "PATCH", {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBe(500);
    expect(result.failure.message).toBe("Coś poszło nie tak. Spróbuj ponownie.");
  });

  it("yields the network-failure message with no status when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await requestJson("/api/appointment-status/1", "PATCH", {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.status).toBeUndefined();
    expect(result.failure.message).toBe("Nie udało się połączyć z serwerem.");
  });
});
