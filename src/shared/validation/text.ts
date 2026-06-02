import { z } from "zod";

const LETTERS_AND_SPACES = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const DIGITS_ONLY = /^\d+$/;

function blankToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export function lettersOnlySchema(field: string, max = 255) {
  return z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} cannot exceed ${max} characters`)
    .regex(LETTERS_AND_SPACES, `${field} can contain letters and spaces only`);
}

export function optionalLettersOnlySchema(field: string, max = 255) {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(max, `${field} cannot exceed ${max} characters`)
      .regex(LETTERS_AND_SPACES, `${field} can contain letters and spaces only`)
      .optional(),
  );
}

export function optionalDigitsOnlySchema(field: string, max = 20) {
  return z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(7, `${field} must contain at least 7 digits`)
      .max(max, `${field} cannot exceed ${max} digits`)
      .regex(DIGITS_ONLY, `${field} can contain digits only`)
      .optional(),
  );
}
