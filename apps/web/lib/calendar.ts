import {
  AvailabilityService,
  CalendarService
} from "@recepto/calendar";
import { validateEnv } from "@recepto/shared/env";
import { db } from "@/lib/db";

const env = validateEnv(process.env);
const globalCalendar = globalThis as unknown as {
  calendarService?: CalendarService;
  availabilityService?: AvailabilityService;
};

export const calendarService =
  globalCalendar.calendarService ??
  new CalendarService({
    db,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    sessionSecret: env.SESSION_SECRET
  });

export const availabilityService =
  globalCalendar.availabilityService ??
  new AvailabilityService(db, calendarService);

if (process.env.NODE_ENV !== "production") {
  globalCalendar.calendarService = calendarService;
  globalCalendar.availabilityService = availabilityService;
}
