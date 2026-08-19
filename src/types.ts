import type { Database } from "@/db/database.types";
import type {
  BayCreateInput,
  BayUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  WorkingHoursUpdateInput,
  WorkshopDetailsInput,
} from "@/lib/schemas/workshop-setup";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Workshop = Database["public"]["Tables"]["workshops"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Bay = Database["public"]["Tables"]["bays"]["Row"];
export type Service = Database["public"]["Tables"]["services"]["Row"];
export type WorkingHours = Database["public"]["Tables"]["working_hours"]["Row"];

export interface UserProfile {
  workshopId: string;
  workshopName: string;
  role: UserRole;
}

export interface WorkshopConfiguration {
  workshop: Workshop;
  bays: Bay[];
  services: Service[];
  workingHours: WorkingHours[];
}

export type {
  BayCreateInput,
  BayUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  WorkingHoursUpdateInput,
  WorkshopDetailsInput,
};
