import type { UserProfile, UserRole } from "@/types";

type AccessLevel = "any" | UserRole;

/**
 * Every access rule for every protected route, in one auditable place. Add downstream entries
 * here — never gate a route ad hoc inside a page or API route. Longest-prefix wins, so a more
 * specific rule nested under a broader one resolves predictably.
 */
const ROUTE_ACCESS: readonly [prefix: string, access: AccessLevel][] = [
  ["/dashboard", "any"],
  ["/ustawienia", "owner"],
  ["/wizyty", "any"],
  ["/wizyty/nowa", "owner"],
  ["/api/workshop", "owner"],
  ["/api/bays", "owner"],
  ["/api/services", "owner"],
  ["/api/working-hours", "owner"],
  ["/api/appointments", "owner"],
  ["/api/appointment-status", "any"],
];

export type GuardResult = { readonly type: "allow" } | { readonly type: "redirect"; readonly to: string };

function matchRoute(pathname: string): AccessLevel | null {
  const matches = ROUTE_ACCESS.filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (matches.length === 0) {
    return null;
  }
  const [, access] = matches.reduce((longest, current) => (current[0].length > longest[0].length ? current : longest));
  return access;
}

/**
 * Resolves access for a request. Assumes the caller has already handled the "authenticated but no
 * profile row" anomaly (see src/middleware.ts) — a `null` profile reaching here means simply
 * unauthenticated, so it redirects to sign-in like the flat PROTECTED_ROUTES check it replaces.
 */
export function requireRole(profile: UserProfile | null, pathname: string): GuardResult {
  // Root has no page of its own: it is the app's front door, forwarding a signed-in user to the
  // day plan and everyone else to sign-in. Kept here rather than in an index page because that
  // is the same decision the table below makes, and it belongs in one auditable place.
  if (pathname === "/") {
    return { type: "redirect", to: profile ? "/dashboard" : "/auth/signin" };
  }

  const access = matchRoute(pathname);

  if (access === null) {
    return { type: "allow" };
  }

  if (!profile) {
    return { type: "redirect", to: "/auth/signin" };
  }

  if (access === "any" || access === profile.role) {
    return { type: "allow" };
  }

  return { type: "redirect", to: "/dashboard" };
}
