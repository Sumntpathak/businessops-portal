export type TenantId = string;

export interface TenantSummary {
  id: TenantId;
  name: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export const APP_NAME = "Recepto";
export * from "./voice-channel.js";
