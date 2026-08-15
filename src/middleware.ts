import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth-guard";
import type { UserProfile } from "@/types";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = null;
  context.locals.profile = null;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("workshop_id, role, workshops(name)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profileRow) {
        // Structurally shouldn't happen — the on_auth_user_created trigger provisions a profile
        // atomically at signup. If it does (e.g. manual row deletion), the session is left
        // half-signed-in: signing out and clearing locals.user (not just locals.profile) keeps
        // Topbar.astro consistent with the redirect instead of rendering a signed-in header for a
        // user this middleware now treats as anonymous.
        console.error(`No profile found for authenticated user ${user.id}; signing out.`);
        await supabase.auth.signOut();
        return context.redirect(
          `/auth/signin?error=${encodeURIComponent(
            "Twoje konto nie ma przypisanego warsztatu. Zaloguj się ponownie lub skontaktuj się z administratorem.",
          )}`,
        );
      }

      context.locals.user = user;
      context.locals.profile = {
        workshopId: profileRow.workshop_id,
        workshopName: profileRow.workshops.name,
        role: profileRow.role,
      } satisfies UserProfile;
    }
  }

  const guard = requireRole(context.locals.profile, context.url.pathname);
  if (guard.type === "redirect") {
    return context.redirect(guard.to);
  }

  return next();
});
