/**
 * Independent check of the caller's words before a live transfer, which can't be undone.
 * The model passes the caller's latest words with the tool call; a "no" there blocks the
 * transfer even if the model decided to go ahead ("not now" heard as a yes, 2026-10-03).
 */

/** "No" in English, Hindi and Punjabi, in native script and romanised. */
const REFUSAL_WORDS = new Set([
  "no", "nope", "nah", "not", "don't", "dont", "never", "na", "nahi", "nahin", "nai", "naa", "later",
  "नो", "ना", "नहीं", "नही", "मत",
  "ਨੋ", "ਨਾ", "ਨਹੀਂ", "ਨਹੀ"
]);

/** Phrases that put the caller off for now, anywhere in the turn. */
const NOT_NOW = /\b(not now|not yet|maybe later|some other time|abhi nahi|baad m(e|ei)n|rehne do|ruko)\b|अभी नहीं|बाद में|रहने दो|रुको|ਹਾਲੇ ਨਹੀਂ|ਬਾਅਦ ਵਿੱਚ/i;

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
 * True when the turn says no: it starts with a refusal word ("No, Gundeep"), puts it off
 * ("not now", "abhi nahi"), or is short and contains a "no" ("I said no"). A longer request
 * such as "connect me to someone, not the bot" is not a refusal.
 */
export function isRefusal(text: string): boolean {
  const list = words(text);
  if (list.length === 0) return false;
  if (NOT_NOW.test(text)) return true;
  if (REFUSAL_WORDS.has(list[0]!) || (list[0] === "i" && list[1] === "don't")) return true;
  return list.length <= SHORT_TURN_WORDS && list.some((word) => REFUSAL_WORDS.has(word));
}
