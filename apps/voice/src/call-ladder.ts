/**
 * The receptionist's default call order (see "HOW A CALL GOES" in the prompt):
 * 1 introduction, 2 reason for calling, 3 answering questions, 4 booking, 5 team member + close.
 * The step only moves forward, and only on tool results, so it can never be talked backwards
 * by a misheard word. The prompt alone still works; this is a short nudge after each step.
 */
export type LadderStep = 1 | 2 | 3 | 4 | 5;

function savedKeys(output: unknown): string[] {
  if (!output || typeof output !== "object" || !("updated" in output)) return [];
  const updated = (output as { updated: unknown }).updated;
  return Array.isArray(updated) ? updated.filter((key): key is string => typeof key === "string") : [];
}

function succeeded(output: unknown, key: string): boolean {
  return Boolean(output && typeof output === "object" && key in output && !("error" in output));
}

/** The furthest step reached once tool `name` returned `output`. */
export function ladderStepAfterTool(current: LadderStep, name: string, output: unknown): LadderStep {
  let reached: LadderStep = 1;
  if (name === "update_caller_profile") {
    const keys = savedKeys(output);
    if (keys.includes("enquiry")) reached = 3;
    else if (keys.includes("name")) reached = 2;
  } else if (name === "check_availability" && succeeded(output, "slots")) {
    reached = 4;
  } else if ((name === "create_booking" && succeeded(output, "bookingId")) || (name === "request_callback" && succeeded(output, "recorded"))) {
    reached = 5;
  }
  return Math.max(current, reached) as LadderStep;
}

/** One short line telling the model where the call is and what comes next. */
export function ladderNote(step: LadderStep, canTransfer: boolean): string | null {
  switch (step) {
    case 2:
      return "Call progress: you have their name. Next, find out what they are calling about, unless they already said.";
    case 3:
      return "Call progress: you know why they are calling. Answer their questions from the facts; when they are done, offer a consultation once (not if they already have a booking or are an existing client).";
    case 4:
      return "Call progress: booking. Mention that our team confirms payment and the booking with them; the price goes only in the read-back.";
    case 5:
      return canTransfer
        ? "Call progress: the main task is done. Ask once if they would like to speak with someone from the team right now; if not, recap in one sentence and ask if there is anything else."
        : "Call progress: the main task is done. Recap in one sentence and ask if there is anything else.";
    default:
      return null;
  }
}
