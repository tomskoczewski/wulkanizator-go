import type { Database } from "@/db/database.types";
import type {
  BayCreateInput,
  BayUpdateInput,
  ServiceCreateInput,
  ServiceUpdateInput,
  WorkingHoursUpdateInput,
  WorkshopDetailsInput,
} from "@/lib/schemas/workshop-setup";
import type { AppointmentBookingRequestInput, SlotSuggestionRequestInput } from "@/lib/schemas/appointment";
import type { EmptyReason, WireSlot } from "@/lib/services/appointments";
import type { DayPlanEntry } from "@/lib/services/day-plan";

export type UserRole = Database["public"]["Enums"]["user_role"];
export type Workshop = Database["public"]["Tables"]["workshops"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Bay = Database["public"]["Tables"]["bays"]["Row"];
export type Service = Database["public"]["Tables"]["services"]["Row"];
export type WorkingHours = Database["public"]["Tables"]["working_hours"]["Row"];
export type Appointment = Database["public"]["Tables"]["appointments"]["Row"];
export type Customer = Database["public"]["Tables"]["customers"]["Row"];
export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

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
  AppointmentBookingRequestInput,
  SlotSuggestionRequestInput,
  EmptyReason,
  WireSlot,
  DayPlanEntry,
};
