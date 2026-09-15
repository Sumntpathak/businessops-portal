import {
  AvailabilityService,
  CalendarService
} from "@recepto/calendar";
import { validateCoreEnv } from "@recepto/shared/env";
import { db } from "@/lib/db";

const env = validateCoreEnv(process.env);
const redirectUri = env.GOOGLE_REDIRECT_URI?.includes("/api/integrations/google/callback")
  ? env.GOOGLE_REDIRECT_URI
  : `${env.PUBLIC_WEB_URL.replace(/\/+$/, "")}/api/integrations/google/callback`;

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
    redirectUri,
    sessionSecret: env.SESSION_SECRET
  });

export const availabilityService =
  globalCalendar.availabilityService ??
  new AvailabilityService(db, calendarService);

if (process.env.NODE_ENV !== "production") {
  globalCalendar.calendarService = calendarService;
  globalCalendar.availabilityService = availabilityService;
}
