import { Queue } from "bullmq";
import { validateEnv } from "@recepto/shared/env";

export interface OnboardCrawlJob {
  tenantId: string;
  url: string;
  hint: string;
}

type OnboardingQueue = Queue<OnboardCrawlJob, void, "onboard:crawl">;
const globalQueues = globalThis as unknown as {
  onboardingQueue?: OnboardingQueue;
};

export function getOnboardingQueue(): OnboardingQueue {
  if (globalQueues.onboardingQueue) {
    return globalQueues.onboardingQueue;
  }

  const env = validateEnv(process.env);
  const queue = new Queue<OnboardCrawlJob, void, "onboard:crawl">("onboarding", {
    connection: { url: env.REDIS_URL },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  if (process.env.NODE_ENV !== "production") {
    globalQueues.onboardingQueue = queue;
  }

  return queue;
}
