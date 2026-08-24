import { describe, expect, it } from "vitest";
import { requireRole } from "@/lib/auth-guard";
import type { UserProfile } from "@/types";

const owner: UserProfile = { workshopId: "w1", workshopName: "Warsztat A", role: "owner" };
const worker: UserProfile = { workshopId: "w1", workshopName: "Warsztat A", role: "worker" };
const detailPath = "/wizyty/11111111-1111-1111-1111-111111111111";

describe("requireRole — /wizyty split", () => {
  it("allows a worker on a visit detail path", () => {
    expect(requireRole(worker, detailPath)).toEqual({ type: "allow" });
  });

  it("redirects a worker away from /wizyty/nowa", () => {
    expect(requireRole(worker, "/wizyty/nowa")).toEqual({ type: "redirect", to: "/dashboard" });
  });

  it("allows an owner on a visit detail path", () => {
    expect(requireRole(owner, detailPath)).toEqual({ type: "allow" });
  });

  it("allows an owner on /wizyty/nowa", () => {
    expect(requireRole(owner, "/wizyty/nowa")).toEqual({ type: "allow" });
  });

  it("redirects an unauthenticated caller to sign-in from a visit detail path", () => {
    expect(requireRole(null, detailPath)).toEqual({ type: "redirect", to: "/auth/signin" });
  });

  it("redirects an unauthenticated caller to sign-in from /wizyty/nowa", () => {
    expect(requireRole(null, "/wizyty/nowa")).toEqual({ type: "redirect", to: "/auth/signin" });
  });

  it("does not treat /wizyty/nowabc as the /wizyty/nowa segment — a worker is allowed", () => {
    expect(requireRole(worker, "/wizyty/nowabc")).toEqual({ type: "allow" });
  });
});

describe("requireRole — /api/appointment-status split", () => {
  const statusPath = "/api/appointment-status/11111111-1111-1111-1111-111111111111";

  it("allows a worker on the status-change route", () => {
    expect(requireRole(worker, statusPath)).toEqual({ type: "allow" });
  });

  it("allows an owner on the status-change route", () => {
    expect(requireRole(owner, statusPath)).toEqual({ type: "allow" });
  });

  it("redirects an unauthenticated caller to sign-in from the status-change route", () => {
    expect(requireRole(null, statusPath)).toEqual({ type: "redirect", to: "/auth/signin" });
  });

  it("still redirects a worker away from the owner-only booking API", () => {
    expect(requireRole(worker, "/api/appointments")).toEqual({ type: "redirect", to: "/dashboard" });
  });
});
