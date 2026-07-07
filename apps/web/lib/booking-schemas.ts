import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  date: dateSchema
});

export const weekQuerySchema = z.object({
  weekStart: dateSchema
});

export const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  callerName: z.string().trim().min(1).max(120),
  callerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  notes: z.string().trim().max(1000).default("")
});
