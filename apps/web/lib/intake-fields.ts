import { z } from "zod";

export const intakeFieldTypeSchema = z.enum(["text", "select", "boolean", "number"]);
export const intakeFieldPrioritySchema = z.enum(["key", "optional"]);

export const intakeFieldMutationSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  type: intakeFieldTypeSchema,
  options: z.string().max(4_000).default(""),
  priority: intakeFieldPrioritySchema
});

export function slugifyIntakeKey(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  if (!key) throw new Error("Field label must produce a valid key");
  if (key === "name") throw new Error("Name is a reserved field");
  return key;
}

export function normalizeSelectOptions(value: string): string[] {
  const options = value
    .split(/\r?\n|,/)
    .map((option) => option.trim())
    .filter(Boolean);
  return [...new Set(options)].slice(0, 50);
}

export function canManageIntakeFields(role: "owner" | "staff"): boolean {
  return role === "owner";
}

export function resolveDisplayedCountry(
  profile: Record<string, string | number | boolean>,
  activeKeys: readonly string[],
  phoneDerivedCountry: string | null
): string | null {
  const stated = activeKeys.includes("country") ? profile.country : undefined;
  return typeof stated === "string" && stated.trim() ? stated : phoneDerivedCountry;
}
