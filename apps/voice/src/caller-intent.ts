/**
 * Independent check of what the caller actually said before an action that can't be
 * undone (a live transfer). The realtime model decides from audio and can mishear:
 * on 2026-10-01 a caller answered "No, Gundeep" to "Shall I connect you with Gundeep?",
 * the model heard a request for Gundeep and transferred, while the transcript of the
 * same turn read "नो गंदगी" (it starts with "no").
 */

/** "No" in English, Hindi and Punjabi, in native script and romanised. */
const REFUSAL_WORDS = new Set([
  "no", "nope", "nah", "not", "don't", "dont", "never", "na", "nahi", "nahin", "nai", "naa",
  "नो", "ना", "नहीं", "नही", "मत",
  "ਨੋ", "ਨਾ", "ਨਹੀਂ", "ਨਹੀ"
]);

/** A short turn of this many words or fewer that contains a "no" anywhere is a refusal. */
const SHORT_TURN_WORDS = 4;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"“”‘’…।]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when the turn says no: it starts with a refusal word ("No, Gundeep", "नो गंदगी"),
 * or it is short and contains one ("I said no"). A longer request such as "connect me to
 * someone, not the bot" is not treated as a refusal.
 */
export function isRefusal(text: string): boolean {
  const list = words(text);
  if (list.length === 0) return false;
  if (REFUSAL_WORDS.has(list[0]!) || (list[0] === "i" && list[1] === "don't")) return true;
  return list.length <= SHORT_TURN_WORDS && list.some((word) => REFUSAL_WORDS.has(word));
}
