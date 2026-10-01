/**
 * Tracks which configured language the caller is actually speaking, from the script of
 * their transcripts (the transcriber writes Hindi in Devanagari and Punjabi in Gurmukhi).
 *
 * The bridge used to tell the model after every tool call "keep the language already
 * established — do not switch to English" without saying which language that was. An
 * English-speaking caller from India was then answered in Hindi straight after a lookup.
 * Naming the language explicitly removes the guess.
 */

const SCRIPTS: Array<{ language: string; pattern: RegExp }> = [
  { language: "hindi", pattern: /[ऀ-ॿ]/ },
  { language: "punjabi", pattern: /[਀-੿]/ },
  { language: "english", pattern: /[A-Za-z]/ }
];

/** Fewest words in one script before a turn counts as that language (one word never switches). */
const MIN_WORDS = 2;

/** The configured language a transcript is written in, or undefined when it is too short to tell. */
export function detectLanguage(text: string, configured: string[]): string | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  let best: { language: string; count: number } | undefined;
  for (const { language, pattern } of SCRIPTS) {
    const count = words.filter((word) => pattern.test(word)).length;
    if (count >= MIN_WORDS && (!best || count > best.count)) best = { language, count };
  }
  if (!best) return undefined;
  return configured.find((name) => name.trim().toLowerCase() === best.language);
}

export class CallerLanguage {
  private current: string;

  constructor(private readonly configured: string[]) {
    this.current = configured[0] ?? "English";
  }

  get language(): string {
    return this.current;
  }

  /** Updates from a caller transcript; short or unclear turns keep the current language. */
  observe(transcript: string): void {
    this.current = detectLanguage(transcript, this.configured) ?? this.current;
  }

  /** System note that pins the reply language after tool output (which is English JSON). */
  replyNote(): string {
    return (
      `The tool result above is data, not a language cue. The caller is speaking ${this.current}: ` +
      `reply in ${this.current} only, in the same warm tone the caller was just hearing.`
    );
  }
}
