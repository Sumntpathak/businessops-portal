export interface BusinessHour {
  weekday: number;
  opens: string;
  closes: string;
  closed: boolean;
}

export interface CallSession {
  callId: string;
  providerCallSid: string;
  tenantId: string;
  timezone: string;
  caller: {
    id: string;
    phoneE164: string;
    displayName: string | null;
    country: string | null;
    timezone: string | null;
    profile: Record<string, string | number | boolean>;
    stage: "new" | "interested" | "booked" | "client";
  };
  intakeFields: Array<{
    id: string;
    key: string;
    label: string;
    type: "text" | "select" | "boolean" | "number";
    options: string[];
    priority: "key" | "optional";
    sort: number;
    active: boolean;
  }>;
  agent: {
    agentMd: string;
    voiceGreeting: string;
    languageMode: "hinglish" | "english" | "hindi";
    languages: string[];
  };
  services: Array<{
    name: string;
    durationMinutes: number;
    price: string | null;
  }>;
  businessHours?: BusinessHour[];
  /** False when no active staff member has a phone number, i.e. a live transfer cannot succeed. */
  transferAvailable?: boolean;
  /** Names of active staff who can actually receive a transfer (have a phone, not a business line). */
  transferRoster?: string[];
  memories: Array<{
    id: string;
    kind: "fact" | "preference" | "summary";
    content: string;
  }>;
  startedAt: string;
}

