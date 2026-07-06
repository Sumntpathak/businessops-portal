export type ProfileValue = string | number | boolean;
export type CallerStage = "new" | "interested" | "booked" | "client";

export interface IntakeFieldDefinition {
  key: string;
  type: "text" | "select" | "boolean" | "number";
  options: unknown;
  active?: boolean;
}

export interface RejectedProfileField {
  key: string;
  code: "unknown_key" | "inactive" | "wrong_type" | "invalid_option";
}

const COUNTRY_PREFIXES = [
  ["+971", "United Arab Emirates", "Asia/Dubai"], ["+977", "Nepal", "Asia/Kathmandu"],
  ["+880", "Bangladesh", "Asia/Dhaka"], ["+966", "Saudi Arabia", "Asia/Riyadh"],
  ["+974", "Qatar", "Asia/Qatar"], ["+965", "Kuwait", "Asia/Kuwait"],
  ["+968", "Oman", "Asia/Muscat"], ["+960", "Maldives", "Indian/Maldives"],
  ["+852", "Hong Kong", "Asia/Hong_Kong"], ["+886", "Taiwan", "Asia/Taipei"],
  ["+64", "New Zealand", "Pacific/Auckland"], ["+61", "Australia", "Australia/Sydney"],
  ["+65", "Singapore", "Asia/Singapore"], ["+60", "Malaysia", "Asia/Kuala_Lumpur"],
  ["+63", "Philippines", "Asia/Manila"], ["+62", "Indonesia", "Asia/Jakarta"],
  ["+66", "Thailand", "Asia/Bangkok"], ["+84", "Vietnam", "Asia/Ho_Chi_Minh"],
  ["+82", "South Korea", "Asia/Seoul"], ["+81", "Japan", "Asia/Tokyo"],
  ["+86", "China", "Asia/Shanghai"], ["+92", "Pakistan", "Asia/Karachi"],
  ["+94", "Sri Lanka", "Asia/Colombo"], ["+91", "India", "Asia/Kolkata"],
  ["+44", "United Kingdom", "Europe/London"], ["+49", "Germany", "Europe/Berlin"],
  ["+33", "France", "Europe/Paris"], ["+39", "Italy", "Europe/Rome"],
  ["+34", "Spain", "Europe/Madrid"], ["+31", "Netherlands", "Europe/Amsterdam"],
  ["+41", "Switzerland", "Europe/Zurich"], ["+27", "South Africa", "Africa/Johannesburg"],
  ["+1", "United States/Canada", "America/New_York"]
] as const;

export function deriveCallerGeo(phoneE164: string): { country: string | null; timezone: string | null } {
  const match = COUNTRY_PREFIXES.find(([prefix]) => phoneE164.startsWith(prefix));
  return match ? { country: match[1], timezone: match[2] } : { country: null, timezone: null };
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 500;
}

export function validateProfileFields(values: Record<string, unknown>, definitions: readonly IntakeFieldDefinition[]): {
  accepted: Record<string, ProfileValue>;
  rejected: RejectedProfileField[];
} {
  const byKey = new Map(definitions.map((field) => [field.key, field]));
  const accepted: Record<string, ProfileValue> = {};
  const rejected: RejectedProfileField[] = [];
  for (const [key, rawValue] of Object.entries(values).slice(0, 25)) {
    if (key === "name") {
      if (isText(rawValue) && rawValue.trim().length <= 120) accepted.name = rawValue.trim();
      else rejected.push({ key, code: "wrong_type" });
      continue;
    }
    const field = byKey.get(key);
    if (!field) {
      rejected.push({ key, code: "unknown_key" });
      continue;
    }
    if (field.active === false) {
      rejected.push({ key, code: "inactive" });
      continue;
    }
    if (field.type === "text") {
      if (isText(rawValue)) accepted[key] = rawValue.trim();
      else rejected.push({ key, code: "wrong_type" });
    } else if (field.type === "select") {
      if (typeof rawValue !== "string") rejected.push({ key, code: "wrong_type" });
      else if (!Array.isArray(field.options) || !field.options.includes(rawValue)) rejected.push({ key, code: "invalid_option" });
      else accepted[key] = rawValue;
    } else if (field.type === "boolean") {
      if (typeof rawValue === "boolean") accepted[key] = rawValue;
      else rejected.push({ key, code: "wrong_type" });
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      accepted[key] = rawValue;
    } else {
      rejected.push({ key, code: "wrong_type" });
    }
  }
  return { accepted, rejected };
}

function hasValue(value: ProfileValue | undefined): boolean {
  return value !== undefined && !(typeof value === "string" && value.trim() === "");
}

export function mergeMissingProfile(current: Record<string, ProfileValue>, updates: Record<string, ProfileValue>): Record<string, ProfileValue> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(updates)) if (!hasValue(merged[key])) merged[key] = value;
  return merged;
}

const STAGE_ORDER: CallerStage[] = ["new", "interested", "booked", "client"];

export function promoteStage(current: CallerStage, proposed: CallerStage, hasConfirmedBooking: boolean): CallerStage {
  const minimum = hasConfirmedBooking ? "booked" : "new";
  return ([current, proposed, minimum] as CallerStage[]).reduce((highest, value) =>
    STAGE_ORDER.indexOf(value) > STAGE_ORDER.indexOf(highest) ? value : highest
  );
}

export function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return value("year") + "-" + value("month") + "-" + value("day");
}

export function formatCallerLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function adjacentIsoDates(date: string): string[] {
  const base = new Date(date + "T12:00:00.000Z");
  return [-1, 0, 1].map((offset) => {
    const candidate = new Date(base);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    return candidate.toISOString().slice(0, 10);
  });
}
