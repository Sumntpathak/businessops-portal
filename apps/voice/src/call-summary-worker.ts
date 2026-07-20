import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createDatabase, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import { mergeMissingProfile, promoteStage, validateProfileFields } from "./caller-profile.js";
import { parseToolCallArguments } from "./cloudflare-tool-call.js";

const summaryJobSchema = z.object({
  callId: z.string().uuid(),
  tenantId: z.string().uuid(),
  callerId: z.string().uuid()
});

export type SummaryJobData = z.infer<typeof summaryJobSchema>;

export interface SummaryLogger {
  info(values: Record<string, unknown>, message: string): void;
  error(values: Record<string, unknown>, message: string): void;
}

const SUMMARY_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_TRANSCRIPT_CHARS = 60_000;

function cloudflareChatUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
}

function isConfigured(apiKey: string): boolean {
  return apiKey.length > 0 && apiKey !== "change-me";
}

const resultSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  caller_name: z.string().trim().min(1).max(120).nullable(),
  memories: z
    .array(
      z.object({
        kind: z.enum(["fact", "preference"]),
        content: z.string().trim().min(1).max(500)
      })
    )
    .max(5),
  profile_updates: z.record(z.union([z.string(), z.number().finite(), z.boolean()])),
  stage: z.enum(["new", "interested", "booked", "client"])
});

const SUBMIT_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_call_summary",
    description: "Submit the summary and durable memories extracted from this call.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "2-4 sentences: why the caller called, what was discussed, and the outcome (booked/cancelled/message taken/nothing)."
        },
        caller_name: {
          type: ["string", "null"],
          description: "The caller's name if they stated it during the call, else null."
        },
        memories: {
          type: "array",
          description:
            "0-5 durable facts or preferences about the CALLER worth remembering on future calls. Never include one-off details like a specific slot time already captured by the booking.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["fact", "preference"] },
              content: { type: "string", description: "One short sentence." }
            },
            required: ["kind", "content"]
          }
        },
        profile_updates: {
          type: "object",
          description: "Structured caller fields learned in this call. Use only keys listed in the prompt.",
          additionalProperties: { type: ["string", "number", "boolean"] }
        },
        stage: {
          type: "string",
          enum: ["new", "interested", "booked", "client"],
          description: "new=no clear need, interested=qualified interest, booked=confirmed booking, client=active or completed customer"
        }
      },
      required: ["summary", "caller_name", "memories", "profile_updates", "stage"]
    }
  }
};

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

async function summarizeWithClaude(
  apiKey: string,
  accountId: string,
  transcript: string,
  existingMemories: readonly string[],
  intakeFields: ReadonlyArray<{ key: string; label: string; type: string; options: string[] }>
): Promise<z.infer<typeof resultSchema>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(cloudflareChatUrl(accountId), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        tools: [SUBMIT_TOOL],
        tool_choice: { type: "function", function: { name: "submit_call_summary" } },
        messages: [
          {
            role: "user",
            content: [
              "Below is the transcript of a phone call between a business's AI receptionist and a caller.",
              "Summarize it and extract durable caller memories.",
              "",
              "Already-saved memories about this caller (do NOT repeat these):",
              existingMemories.length
                ? existingMemories.map((memory) => `- ${memory}`).join("\n")
                : "- (none)",
              "",
              "== VALID STRUCTURED PROFILE FIELDS ==",
              intakeFields.length
                ? intakeFields.map((field) =>
                    `- ${field.key}: ${field.label} (${field.type})${field.options.length ? ` options=[${field.options.join(", ")}]` : ""}`
                  ).join("\n")
                : "- (none)",
              "Only emit profile_updates for these keys. Use stage definitions exactly and never infer client without evidence.",
              "",
              "== TRANSCRIPT ==",
              transcript,
              "",
              "Call submit_call_summary."
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Call summary model failed with HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { tool_calls?: OpenAiToolCall[] } }>;
    };
    const toolCall = payload.choices?.[0]?.message?.tool_calls?.find(
      (call) => call.function.name === "submit_call_summary"
    );
    if (!toolCall) throw new Error("Call summary model returned no submit_call_summary tool call");
    return resultSchema.parse(parseToolCallArguments(toolCall.function.arguments));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs call summarization directly in-process (no queue). Returns a function
 * that summarizes one finished call; callers should fire-and-forget it so call
 * finalization is never blocked on the summary model.
 */
export function createCallSummarizer(logger: SummaryLogger) {
  const env = validateEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);

  return async (input: SummaryJobData): Promise<void> => {
      const data = summaryJobSchema.parse(input);

      if (!isConfigured(env.ANTHROPIC_API_KEY) || !isConfigured(env.CLOUDFLARE_ACCOUNT_ID)) {
        logger.info(
          { callId: data.callId, tenantId: data.tenantId },
          "ANTHROPIC_API_KEY / CLOUDFLARE_ACCOUNT_ID not configured; skipping call summary"
        );
        return;
      }

      const scoped = withTenant(db, data.tenantId);

      const [rows, existing, intakeFields] = await Promise.all([
        db
          .select({
            role: schema.callTranscripts.role,
            content: schema.callTranscripts.content
          })
          .from(schema.callTranscripts)
          .where(
            scoped.where(
              schema.callTranscripts,
              eq(schema.callTranscripts.callId, data.callId)
            )
          )
          .orderBy(asc(schema.callTranscripts.seq)),
        db
          .select({ content: schema.callerMemories.content })
          .from(schema.callerMemories)
          .where(
            scoped.where(
              schema.callerMemories,
              eq(schema.callerMemories.callerId, data.callerId)
            )
          )
          .orderBy(desc(schema.callerMemories.createdAt))
          .limit(10),
        db
          .select({
            key: schema.intakeFields.key,
            label: schema.intakeFields.label,
            type: schema.intakeFields.type,
            options: schema.intakeFields.options,
            active: schema.intakeFields.active
          })
          .from(schema.intakeFields)
          .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.active, true)))
          .orderBy(asc(schema.intakeFields.sort))
      ]);

      const spoken = rows.filter(
        (row) => row.role === "caller" || row.role === "agent"
      );
      if (spoken.length < 2) {
        logger.info(
          { callId: data.callId, tenantId: data.tenantId, lines: rows.length },
          "Call too short to summarize; skipping"
        );
        return;
      }

      const transcript = rows
        .map((row) => `${row.role.toUpperCase()}: ${row.content}`)
        .join("\n")
        .slice(0, MAX_TRANSCRIPT_CHARS);

      const result = await summarizeWithClaude(
        env.ANTHROPIC_API_KEY,
        env.CLOUDFLARE_ACCOUNT_ID,
        transcript,
        existing.map((memory) => memory.content),
        intakeFields
      );

      await db.transaction(async (tx) => {
        const transactionScope = withTenant(tx, data.tenantId);

        await tx.insert(schema.callerMemories).values(
          transactionScope.values({
            callerId: data.callerId,
            sourceCallId: data.callId,
            kind: "summary" as const,
            content: result.summary
          })
        );

        for (const memory of result.memories) {
          await tx.insert(schema.callerMemories).values(
            transactionScope.values({
              callerId: data.callerId,
              sourceCallId: data.callId,
              kind: memory.kind,
              content: memory.content
            })
          );
        }

        const [currentCaller] = await tx
          .select({
            displayName: schema.callers.displayName,
            profile: schema.callers.profile,
            stage: schema.callers.stage
          })
          .from(schema.callers)
          .where(transactionScope.where(schema.callers, eq(schema.callers.id, data.callerId)))
          .limit(1);
        if (!currentCaller) throw new Error("Caller not found during summary");

        const [confirmedBooking] = await tx
          .select({ id: schema.bookings.id })
          .from(schema.bookings)
          .where(
            transactionScope.where(
              schema.bookings,
              and(
                eq(schema.bookings.callerId, data.callerId),
                eq(schema.bookings.status, "confirmed"),
                isNull(schema.bookings.deletedAt)
              )
            )
          )
          .limit(1);

        const validated = validateProfileFields(result.profile_updates, intakeFields);
        const profileUpdates = Object.fromEntries(
          Object.entries(validated.accepted).filter(([key]) => key !== "name")
        );
        const profile = mergeMissingProfile(currentCaller.profile, profileUpdates);
        const stage = promoteStage(
          currentCaller.stage,
          result.stage,
          Boolean(confirmedBooking)
        );

        await tx
          .update(schema.callers)
          .set({
            displayName: currentCaller.displayName ?? result.caller_name,
            profile,
            stage,
            updatedAt: new Date()
          })
          .where(transactionScope.where(schema.callers, eq(schema.callers.id, data.callerId)));
      });

      logger.info(
        {
          callId: data.callId,
          tenantId: data.tenantId,
          memories: result.memories.length,
          namedCaller: Boolean(result.caller_name),
          profileUpdates: Object.keys(result.profile_updates).length,
          stage: result.stage
        },
        "Call summarized into durable memory"
      );
  };
}
