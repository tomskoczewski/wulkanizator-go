declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    profile: import("@/types").UserProfile | null;
    supabase: import("@/lib/supabase").TypedSupabaseClient | null;
  }
}
