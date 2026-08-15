import type { Database } from "@/db/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Workshop = Database["public"]["Tables"]["workshops"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export interface UserProfile {
  workshopId: string;
  workshopName: string;
  role: UserRole;
}
