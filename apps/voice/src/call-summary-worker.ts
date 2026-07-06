import { Worker, type Job } from "bullmq";
import { z } from "zod";

const summaryJobSchema = z.object({
  callId: z.string().uuid(),
  tenantId: z.string().uuid(),
  callerId: z.string().uuid()
});

export interface SummaryLogger {
  info(values: Record<string, unknown>, message: string): void;
  error(values: Record<string, unknown>, message: string): void;
}

export function startCallSummaryWorker(redisUrl: string, logger: SummaryLogger) {
  const worker = new Worker(
    "call-summarize",
    async (job: Job) => {
      const data = summaryJobSchema.parse(job.data);
      // FABLE-TODO: Summarize the transcript and extract durable caller memories with an AI model.
      logger.info(
        { callId: data.callId, tenantId: data.tenantId },
        "Call summarization stub received"
      );
    },
    { connection: { url: redisUrl }, concurrency: 2 }
  );

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "Call summary worker error");
  });
  return worker;
}
