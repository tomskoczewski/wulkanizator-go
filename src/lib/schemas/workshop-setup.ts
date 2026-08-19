import { z } from "zod";

export const workshopDetailsSchema = z.object({
  name: z.string().trim().min(1, "Nazwa warsztatu jest wymagana"),
  phone: z.string().trim().min(1).nullish(),
  address: z.string().trim().min(1).nullish(),
});

export const bayCreateSchema = z.object({
  name: z.string().trim().min(1, "Nazwa stanowiska jest wymagana"),
  vehicle_type: z.string().trim().min(1).nullish(),
});

export const bayUpdateSchema = z.object({
  name: z.string().trim().min(1, "Nazwa stanowiska jest wymagana").optional(),
  vehicle_type: z.string().trim().min(1).nullish(),
  is_active: z.boolean().optional(),
});

export const serviceCreateSchema = z.object({
  name: z.string().trim().min(1, "Nazwa usługi jest wymagana"),
  duration_min: z.number().int("Czas trwania musi być liczbą całkowitą").positive("Czas trwania musi być dodatni"),
});

export const serviceUpdateSchema = z.object({
  name: z.string().trim().min(1, "Nazwa usługi jest wymagana").optional(),
  duration_min: z
    .number()
    .int("Czas trwania musi być liczbą całkowitą")
    .positive("Czas trwania musi być dodatni")
    .optional(),
  is_active: z.boolean().optional(),
});

export const workingHoursUpdateSchema = z
  .object({
    opens_at: z.string().trim().min(1).nullish(),
    closes_at: z.string().trim().min(1).nullish(),
    is_closed: z.boolean(),
  })
  .refine((val) => val.is_closed || (val.opens_at && val.closes_at && val.opens_at < val.closes_at), {
    message: "Godzina otwarcia musi być wcześniejsza niż godzina zamknięcia",
    path: ["opens_at"],
  });

export type WorkshopDetailsInput = z.infer<typeof workshopDetailsSchema>;
export type BayCreateInput = z.infer<typeof bayCreateSchema>;
export type BayUpdateInput = z.infer<typeof bayUpdateSchema>;
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;
export type WorkingHoursUpdateInput = z.infer<typeof workingHoursUpdateSchema>;
