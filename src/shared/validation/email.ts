import { z } from "zod";

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_PART_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9-]+$/i;

const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "guerrillamail.com",
  "mailinator.com",
  "tempmail.com",
  "throwawaymail.com",
  "yopmail.com",
]);

const ROLE_BASED_PREFIXES = new Set([
  "admin",
  "billing",
  "contact",
  "hello",
  "help",
  "info",
  "marketing",
  "no-reply",
  "noreply",
  "sales",
  "security",
  "support",
  "team",
  "webmaster",
]);

const COMMON_DOMAIN_FIXES: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
};

interface EmailOptions {
  blockDisposable?: boolean;
  blockRoleBased?: boolean;
}

export function buildEmailSchema(options: EmailOptions = {}) {
  return z
    .string()
    .trim()
    .min(1, "Email is required")
    .max(254, "Email cannot exceed 254 characters")
    .transform((value) => value.toLowerCase())
    .superRefine((email, ctx) => {
      const addIssue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });

      if (/\s/.test(email)) {
        addIssue("Email cannot contain spaces, tabs, or line breaks");
        return;
      }

      const atCount = email.split("@").length - 1;
      if (atCount !== 1) {
        addIssue("Email must contain exactly one @ symbol");
        return;
      }

      if (!BASIC_EMAIL_PATTERN.test(email)) {
        addIssue("Enter a valid email in the format name@domain.com");
        return;
      }

      if (email.includes("..")) {
        addIssue("Email cannot contain consecutive dots");
        return;
      }

      const [localPart, domainPart] = email.split("@");
      if (!localPart || !domainPart) {
        addIssue("Enter a valid email in the format name@domain.com");
        return;
      }

      if (localPart.length > 64) {
        addIssue("Email username cannot exceed 64 characters");
      }

      if (domainPart.length > 255) {
        addIssue("Email domain cannot exceed 255 characters");
      }

      if (localPart.startsWith(".") || localPart.endsWith(".")) {
        addIssue("Email username cannot start or end with a dot");
      }

      if (!LOCAL_PART_PATTERN.test(localPart)) {
        addIssue("Email username contains unsupported characters");
      }

      const labels = domainPart.split(".");
      if (labels.some((label) => label.length === 0)) {
        addIssue("Email domain cannot contain empty labels");
      }

      if (labels.some((label) => label.startsWith("-") || label.endsWith("-"))) {
        addIssue("Email domain labels cannot start or end with a hyphen");
      }

      if (labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) {
        addIssue("Email domain contains unsupported characters");
      }

      const topLevelDomain = labels.at(-1);
      if (!topLevelDomain || topLevelDomain.length < 2) {
        addIssue("Email domain must include a valid extension");
      }

      const suggestion = COMMON_DOMAIN_FIXES[domainPart];
      if (suggestion) {
        addIssue(`Did you mean ${localPart}@${suggestion}?`);
      }

      if (options.blockDisposable && DISPOSABLE_DOMAINS.has(domainPart)) {
        addIssue("Disposable email addresses are not allowed");
      }

      if (options.blockRoleBased && ROLE_BASED_PREFIXES.has(localPart)) {
        addIssue("Use a personal work email, not a shared role-based address");
      }
    });
}
