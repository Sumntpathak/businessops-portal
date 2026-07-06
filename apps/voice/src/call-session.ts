export interface CallSession {
  callId: string;
  providerCallSid: string;
  tenantId: string;
  timezone: string;
  caller: {
    id: string;
    phoneE164: string;
    displayName: string | null;
  };
  agent: {
    agentMd: string;
    voiceGreeting: string;
    languageMode: "hinglish" | "english" | "hindi";
  };
  memories: Array<{
    id: string;
    kind: "fact" | "preference" | "summary";
    content: string;
  }>;
  startedAt: string;
}

