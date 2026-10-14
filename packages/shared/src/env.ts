import { z } from "zod";

/**
 * Fields both apps/web and apps/voice actually read. Kept minimal on purpose:
 * every field added here becomes a hard requirement for BOTH apps to boot,
 * even though most config is app-specific. This schema previously required
 * every voice-only field (Twilio, Azure, Anthropic, Cloudflare, Brave) just
 * to start the web app, which crashed apps/web at Next.js's instrumentation
 * hook (runs on every cold start, before any route handles a request) the
 * moment Vercel's project was missing one of those unrelated variables —
 * surfacing as a bare 503 with no useful error visible to a caller.
 */
export const coreEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  PUBLIC_WEB_URL: z.string().url(),
  // Used by apps/web to build a tenant's Twilio webhook URL when they
  // self-onboard their own Twilio account (see app/api/integrations/twilio).
  PUBLIC_VOICE_URL: z.string().url()
});

/** Additional fields only apps/voice reads. */
export const voiceEnvSchema = z.object({
  REDIS_URL: z.string().url(),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_NUMBER: z.string().min(1),
  // Realtime voice model, on OpenAI (https://api.openai.com/v1/realtime) or an Azure
  // OpenAI resource. The REALTIME_* names win; the older AZURE_REALTIME_* names still work.
  REALTIME_URL: z.string().url().optional(),
  REALTIME_API_KEY: z.string().min(1).optional(),
  REALTIME_MODEL: z.string().min(1).optional(),
  REALTIME_VOICE: z.string().min(1).optional(),
  REALTIME_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  REALTIME_TRANSCRIBE_MODEL: z.string().min(1).optional(),
  AZURE_REALTIME_URL: z.string().url().optional(),
  AZURE_REALTIME_KEY: z.string().min(1).optional(),
  AZURE_REALTIME_MODEL: z.string().default("gpt-realtime-mini"),
  AZURE_REALTIME_VOICE: z.string().default("shimmer"),
  // gpt-realtime-2.x only. Leave unset for older deployments, which reject the field.
  AZURE_REALTIME_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).optional(),
  // Input transcription model. whisper-1 is the safe default; the newer
  // gpt-4o-mini-transcribe hallucinates far less on silence and noise.
  AZURE_TRANSCRIBE_MODEL: z.string().default("whisper-1"),
  // Repurposed to hold a Cloudflare Workers AI API token (used for both the
  // call-summary worker and the onboarding distiller, via GLM-4.7-Flash).
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v : undefined)),
  BRAVE_SEARCH_API_KEY: z.string().optional().transform((v) => (v && v.trim().length > 0 ? v : undefined))
});

/** Full schema (core + voice) — used by apps/voice, which needs both. */
export const envSchema = coreEnvSchema.merge(voiceEnvSchema);

export type CoreEnv = z.infer<typeof coreEnvSchema>;
export type AppEnv = z.infer<typeof envSchema>;

function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const variable = issue.path.join(".") || "environment";
    return `  - ${variable}: ${issue.message}`;
  });
  return ["Invalid environment configuration:", ...lines, "Copy .env.example to .env and fill in every value."].join("\n");
}

/** For apps/voice: validates the full env surface (core + voice-only fields). */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) throw new Error(formatIssues(result.error));
  return result.data;
}

/** For apps/web: validates only the fields the web app actually reads. */
export function validateCoreEnv(source: NodeJS.ProcessEnv = process.env): CoreEnv {
  const result = coreEnvSchema.safeParse(source);
  if (!result.success) {
    if (source.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-production-build") {
      return {
        DATABASE_URL: source.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy",
        SESSION_SECRET: source.SESSION_SECRET || "01234567890123456789012345678901",
        GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID || "dummy",
        GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET || "dummy",
        GOOGLE_REDIRECT_URI: source.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/callback/google",
        PUBLIC_WEB_URL: source.PUBLIC_WEB_URL || "http://localhost:3000",
        PUBLIC_VOICE_URL: source.PUBLIC_VOICE_URL || "http://localhost:3001"
      };
    }
    throw new Error(formatIssues(result.error));
  }
  return result.data;
}
