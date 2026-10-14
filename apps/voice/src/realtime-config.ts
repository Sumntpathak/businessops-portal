import type { RealtimeTuning } from "./azure-realtime-bridge.js";

/** The env keys this reads: provider-neutral REALTIME_* first, then the older AZURE_* names. */
export interface RealtimeEnv {
  REALTIME_URL?: string;
  REALTIME_API_KEY?: string;
  REALTIME_MODEL?: string;
  REALTIME_VOICE?: string;
  REALTIME_REASONING_EFFORT?: RealtimeTuning["reasoningEffort"];
  REALTIME_TRANSCRIBE_MODEL?: string;
  AZURE_REALTIME_URL?: string;
  AZURE_REALTIME_KEY?: string;
  AZURE_REALTIME_MODEL: string;
  AZURE_REALTIME_VOICE: string;
  AZURE_REALTIME_REASONING_EFFORT?: RealtimeTuning["reasoningEffort"];
  AZURE_TRANSCRIBE_MODEL: string;
}

export interface RealtimeConfig {
  url: string;
  apiKey: string;
  model: string;
  voice: string;
  tuning: RealtimeTuning;
}

/**
 * Where the voice model lives: OpenAI directly (REALTIME_URL=https://api.openai.com/v1/realtime)
 * or an Azure OpenAI resource. Throws at startup when no URL or key is set.
 */
export function resolveRealtimeConfig(env: RealtimeEnv): RealtimeConfig {
  const url = env.REALTIME_URL ?? env.AZURE_REALTIME_URL;
  const apiKey = env.REALTIME_API_KEY ?? env.AZURE_REALTIME_KEY;
  if (!url || !apiKey) {
    throw new Error("REALTIME_URL and REALTIME_API_KEY (or AZURE_REALTIME_URL and AZURE_REALTIME_KEY) are required");
  }
  return {
    url,
    apiKey,
    model: env.REALTIME_MODEL ?? env.AZURE_REALTIME_MODEL,
    voice: env.REALTIME_VOICE ?? env.AZURE_REALTIME_VOICE,
    tuning: {
      reasoningEffort: env.REALTIME_REASONING_EFFORT ?? env.AZURE_REALTIME_REASONING_EFFORT,
      transcribeModel: env.REALTIME_TRANSCRIBE_MODEL ?? env.AZURE_TRANSCRIBE_MODEL
    }
  };
}
