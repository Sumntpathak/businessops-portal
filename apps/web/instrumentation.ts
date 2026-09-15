import { validateCoreEnv } from "@recepto/shared/env";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    validateCoreEnv(process.env);
  }
}
