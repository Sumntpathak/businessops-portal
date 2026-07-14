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
  ANTHROPIC_API_KEY: z.string().min(1),
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
