import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_NUMBER: z.string().min(1),
  AZURE_REALTIME_URL: z.string().url(),
  AZURE_REALTIME_KEY: z.string().min(1),
  AZURE_REALTIME_MODEL: z.string().default("gpt-realtime-mini"),
  // Present only once the Azure SIP connector is configured; the /azure/incoming
  // webhook route stays disabled until both are set.
  AZURE_WEBHOOK_SECRET: z.string().min(1).optional(),
  AZURE_SIP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Selects which AI bridge the Twilio call handler uses. "azure" (default)
  // preserves current behavior; "gemini-live" requires the GOOGLE_CLOUD_*
  // vars below. Kept flag-switchable so a bad Gemini Live call can be
  // reverted to Azure instantly without a deploy of logic changes.
  VOICE_PROVIDER: z.enum(["azure", "gemini-live"]).default("azure"),
  // Vertex AI auth for Gemini Live — a GCP service account (not an AI Studio
  // API key) so usage draws from Vertex billing/credit. Optional at the
  // schema level so Azure-only deployments don't need them; enforced at the
  // VOICE_PROVIDER=gemini-live construction site instead.
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  // "global" is required for the Live API today — confirmed empirically:
  // us-central1/us-east4 both 404 on every Live model tried, while
  // gemini-live-2.5-flash only resolves under location=global.
  GOOGLE_CLOUD_LOCATION: z.string().default("global"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  // Confirmed via a live smoke test (audio streamed, turnComplete fired) against
  // this project on 2026-07-23. Vertex's Live model catalog is preview-stage and
  // moves fast — re-verify if this starts 404ing.
  GEMINI_LIVE_MODEL: z.string().default("gemini-live-2.5-flash"),
  // Repurposed to hold a Cloudflare Workers AI API token (used for both the
  // call-summary worker and the onboarding distiller, via GLM-4.7-Flash).
  ANTHROPIC_API_KEY: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  BRAVE_SEARCH_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  PUBLIC_WEB_URL: z.string().url(),
  PUBLIC_VOICE_URL: z.string().url()
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const variable = issue.path.join(".") || "environment";
      return `  - ${variable}: ${issue.message}`;
    });

    throw new Error(
      ["Invalid environment configuration:", ...lines, "Copy .env.example to .env and fill in every value."].join("\n")
    );
  }

  return result.data;
}
