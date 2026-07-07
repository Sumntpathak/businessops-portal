import { z } from "zod";
import type { CrawledPage, StubDraft } from "./crawler.js";

export interface DistillInput {
  businessName: string;
  hint: string;
  timezone: string;
  pages: readonly CrawledPage[];
}

export interface DistilledDraft extends StubDraft {
  voiceGreeting: string;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DISTILL_MODEL = "claude-sonnet-5";
const MAX_PAGE_CHARS = 12_000;

const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .transform((value) => (value.length === 5 ? value + ":00" : value));

const draftSchema = z.object({
  agent_md: z.string().min(200),
  voice_greeting: z.string().min(10).max(300),
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        duration_minutes: z.number().int().min(5).max(480),
        price: z.string().trim().max(60).nullable(),
        description: z.string().trim().max(500)
      })
    )
    .min(1)
    .max(25),
  business_hours: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        opens: timeSchema,
        closes: timeSchema,
        closed: z.boolean()
      })
    )
    .length(7)
});

const SUBMIT_TOOL = {
  name: "submit_agent_profile",
  description: "Submit the finished receptionist profile for this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      agent_md: {
        type: "string",
        description: "The complete agent.md markdown document."
      },
      voice_greeting: {
        type: "string",
        description:
          "One short spoken sentence the agent uses to answer the phone, mentioning the business name."
      },
      services: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            duration_minutes: { type: "integer", description: "Appointment length in minutes." },
            price: {
              type: ["string", "null"],
              description: "Display price like '₹500' or 'From ₹1,200', or null if unknown."
            },
            description: { type: "string", description: "One sentence, caller-friendly." }
          },
          required: ["name", "duration_minutes", "price", "description"]
        }
      },
      business_hours: {
        type: "array",
        description: "Exactly 7 entries, weekday 0 (Sunday) through 6 (Saturday).",
        items: {
          type: "object",
          properties: {
            weekday: { type: "integer", minimum: 0, maximum: 6 },
            opens: { type: "string", description: "HH:MM:SS 24h local time." },
            closes: { type: "string", description: "HH:MM:SS 24h local time." },
            closed: { type: "boolean" }
          },
          required: ["weekday", "opens", "closes", "closed"]
        }
      }
    },
    required: ["agent_md", "voice_greeting", "services", "business_hours"]
  }
};

function buildPrompt(input: DistillInput): string {
  const pages = input.pages
    .map(
      (page) =>
        `<page url=${JSON.stringify(page.url)} title=${JSON.stringify(page.title)}>\n` +
        page.text.slice(0, MAX_PAGE_CHARS) +
        "\n</page>"
    )
    .join("\n\n");

  return [
    `Business name: ${input.businessName}`,
    `Owner's one-line description: ${input.hint || "(none provided)"}`,
    `Timezone: ${input.timezone}`,
    "",
    "Below is text crawled from the business's website. Distill it into a receptionist profile.",
    "",
    "== AGENT.MD REQUIREMENTS ==",
    "Write agent_md as a markdown document with EXACTLY these sections, in order:",
    "# <Business Name> Reception Agent",
    "## Identity — one paragraph: who the agent is, personality (warm, efficient, professional).",
    "## Business summary — what the business does, location/address, phone, and anything a caller commonly asks.",
    "## Services — bulleted list with duration and price where known.",
    "## Business hours — human-readable weekly schedule.",
    "## Booking rules — confirm name + service + date + time; never promise a slot before availability is checked.",
    "## Frequently asked questions — 4 to 8 real Q&As grounded in the crawled content (parking, payment methods, cancellation policy, what to bring, etc.).",
    "## Escalation — when to take a message for staff; emergencies go to local emergency services.",
    "## Privacy — collect only what is needed; never disclose one caller's information to another.",
    "",
    "== HARD RULES ==",
    "- Ground EVERY fact in the crawled text or the owner's hint. If a fact (like an address or price) is not present, write 'not listed — take a message if asked' rather than inventing it.",
    "- Never invent prices, addresses, staff names, or phone numbers.",
    "- services must be actual bookable services of this business, with realistic durations.",
    "- business_hours: if the site states hours, use them; otherwise use sensible defaults for this business type and note in agent_md that hours are unconfirmed.",
    "- voice_greeting: one natural spoken sentence, e.g. 'Namaste, thank you for calling <name> — how may I help you today?'",
    "- Keep agent_md under 900 words: it is read on every phone call.",
    "",
    "== CRAWLED WEBSITE CONTENT ==",
    pages || "(crawl returned no readable pages — build a minimal profile from the name and hint, flagging every section as needing owner review)",
    "",
    "Call submit_agent_profile with the finished profile."
  ].join("\n");
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

/**
 * Distills crawled website content into a reviewed-ready agent profile using Claude.
 * Throws on API or validation failure — callers decide whether to fall back to the stub.
 */
export async function claudeDistill(
  input: DistillInput,
  apiKey: string
): Promise<DistilledDraft> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: DISTILL_MODEL,
        max_tokens: 8_000,
        tools: [SUBMIT_TOOL],
        tool_choice: { type: "tool", name: "submit_agent_profile" },
        messages: [{ role: "user", content: buildPrompt(input) }]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Claude distill failed with HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }

    const payload = (await response.json()) as { content?: Array<{ type: string }> };
    const toolUse = (payload.content ?? []).find(
      (block): block is AnthropicToolUseBlock =>
        block.type === "tool_use" &&
        (block as AnthropicToolUseBlock).name === "submit_agent_profile"
    );
    if (!toolUse) {
      throw new Error("Claude distill returned no submit_agent_profile tool call");
    }

    const draft = draftSchema.parse(toolUse.input);
    const weekdays = new Set(draft.business_hours.map((hours) => hours.weekday));
    if (weekdays.size !== 7) {
      throw new Error("Claude distill returned duplicate or missing weekdays");
    }

    return {
      agentMd: draft.agent_md,
      voiceGreeting: draft.voice_greeting,
      services: draft.services.map((service) => ({
        name: service.name,
        durationMinutes: service.duration_minutes,
        price: service.price,
        description: service.description
      })),
      businessHours: [...draft.business_hours].sort(
        (left, right) => left.weekday - right.weekday
      )
    };
  } finally {
    clearTimeout(timeout);
  }
}
