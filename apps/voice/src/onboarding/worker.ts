import { Worker, type Job } from "bullmq";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { createDatabase, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import {
  braveSearch,
  crawlWebsite,
  stubDistill,
  type CrawledPage
} from "./crawler.js";
import { claudeDistill, type DistilledDraft } from "./distill.js";

const jobDataSchema = z.object({
  tenantId: z.string().uuid(),
  url: z.string().url(),
  hint: z.string().max(240)
});

export interface WorkerLogger {
  info(values: Record<string, unknown>, message: string): void;
  error(values: Record<string, unknown>, message: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 4_000) : "Unknown onboarding error";
}

export function startOnboardingWorker(logger: WorkerLogger) {
  const env = validateEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);

  const worker = new Worker(
    "onboarding",
    async (bullJob: Job) => {
      const data = jobDataSchema.parse(bullJob.data);
      const scoped = withTenant(db, data.tenantId);
      let onboardingJobId: string | undefined;

      try {
        const [tenant] = await db
          .select({
            id: schema.tenants.id,
            name: schema.tenants.name,
            timezone: schema.tenants.timezone
          })
          .from(schema.tenants)
          .where(
            and(
              eq(schema.tenants.id, data.tenantId),
              isNull(schema.tenants.deletedAt)
            )
          )
          .limit(1);

        if (!tenant) {
          throw new Error("Onboarding tenant was not found");
        }

        const [onboardingJob] = await db
          .select({
            id: schema.onboardingJobs.id
          })
          .from(schema.onboardingJobs)
          .where(scoped.where(schema.onboardingJobs))
          .orderBy(desc(schema.onboardingJobs.createdAt))
          .limit(1);

        if (!onboardingJob) {
          throw new Error("Onboarding database job was not found");
        }

        onboardingJobId = onboardingJob.id;

        await db
          .update(schema.onboardingJobs)
          .set({ status: "crawling", error: null, updatedAt: new Date() })
          .where(
            scoped.where(
              schema.onboardingJobs,
              eq(schema.onboardingJobs.id, onboardingJob.id)
            )
          );

        const city = tenant.timezone.split("/").at(-1)?.replaceAll("_", " ") ?? "";
        let searchUrls: string[] = [];
        try {
          searchUrls = await braveSearch(
            [tenant.name, city].filter(Boolean).join(" "),
            env.BRAVE_SEARCH_API_KEY
          );
        } catch (searchError) {
          logger.error(
            { err: searchError, tenantId: data.tenantId },
            "Brave search failed; continuing with only the provided URL"
          );
        }
        const pages = await crawlWebsite(data.url, searchUrls);

        await db
          .update(schema.onboardingJobs)
          .set({
            status: "distilling",
            crawlResult: pages,
            updatedAt: new Date()
          })
          .where(
            scoped.where(
              schema.onboardingJobs,
              eq(schema.onboardingJobs.id, onboardingJob.id)
            )
          );

        let draft: DistilledDraft;
        try {
          draft = await claudeDistill(
            {
              businessName: tenant.name,
              hint: data.hint,
              timezone: tenant.timezone,
              pages
            },
            env.ANTHROPIC_API_KEY,
            env.CLOUDFLARE_ACCOUNT_ID
          );
        } catch (distillError) {
          // Claude failure must not dead-end onboarding: fall back to the
          // placeholder template so the owner can still review and fill it in.
          logger.error(
            {
              tenantId: data.tenantId,
              onboardingJobId,
              error: errorMessage(distillError)
            },
            "Claude distill failed; falling back to template draft"
          );
          draft = {
            ...stubDistill(tenant.name),
            voiceGreeting: `Hello! Thank you for calling ${tenant.name}. How can I help?`
          };
        }

        await db.transaction(async (tx) => {
          const transactionScope = withTenant(tx, data.tenantId);
          const [owner] = await tx
            .select({ userId: schema.tenantMembers.userId })
            .from(schema.tenantMembers)
            .where(
              transactionScope.where(
                schema.tenantMembers,
                eq(schema.tenantMembers.role, "owner")
              )
            )
            .limit(1);

          if (!owner) {
            throw new Error("Onboarding tenant has no owner");
          }

          const [existingProfile] = await tx
            .select({
              version: schema.agentProfiles.version,
              source: schema.agentProfiles.source
            })
            .from(schema.agentProfiles)
            .where(transactionScope.where(schema.agentProfiles))
            .limit(1);
          const version = existingProfile?.version ?? 1;

          if (!existingProfile) {
            await tx.insert(schema.agentProfiles).values(
              transactionScope.values({
                agentMd: draft.agentMd,
                voiceGreeting: draft.voiceGreeting,
                languageMode: "hinglish",
                version,
                source: "auto",
                updatedBy: owner.userId
              })
            );
          } else if (existingProfile.source === "auto") {
            await tx
              .update(schema.agentProfiles)
              .set({
                agentMd: draft.agentMd,
                voiceGreeting: draft.voiceGreeting,
                updatedBy: owner.userId,
                updatedAt: new Date()
              })
              .where(transactionScope.where(schema.agentProfiles));
          }

          await tx
            .insert(schema.agentProfileRevisions)
            .values(
              transactionScope.values({
                agentMd: draft.agentMd,
                version
              })
            )
            .onConflictDoNothing();

          for (const service of draft.services) {
            await tx
              .insert(schema.services)
              .values(transactionScope.values({ ...service, active: true }))
              .onConflictDoUpdate({
                target: [schema.services.tenantId, schema.services.name],
                set: {
                  durationMinutes: service.durationMinutes,
                  price: service.price,
                  description: service.description,
                  active: true,
                  updatedAt: new Date()
                }
              });
          }

          for (const hours of draft.businessHours) {
            await tx
              .insert(schema.businessHours)
              .values(
                transactionScope.values({
                  weekday: hours.weekday,
                  opens: hours.opens,
                  closes: hours.closes,
                  closed: hours.closed
                })
              )
              .onConflictDoUpdate({
                target: [
                  schema.businessHours.tenantId,
                  schema.businessHours.weekday
                ],
                set: {
                  opens: hours.opens,
                  closes: hours.closes,
                  closed: hours.closed,
                  updatedAt: new Date()
                }
              });
          }

          await tx
            .update(schema.onboardingJobs)
            .set({
              status: "ready_for_review",
              error: null,
              updatedAt: new Date()
            })
            .where(
              transactionScope.where(
                schema.onboardingJobs,
                eq(schema.onboardingJobs.id, onboardingJob.id)
              )
            );
        });

        logger.info(
          {
            tenantId: data.tenantId,
            onboardingJobId,
            pages: pages.length
          },
          "Onboarding crawl completed"
        );
      } catch (error) {
        if (onboardingJobId) {
          await db
            .update(schema.onboardingJobs)
            .set({
              status: "failed",
              error: errorMessage(error),
              updatedAt: new Date()
            })
            .where(
              scoped.where(
                schema.onboardingJobs,
                eq(schema.onboardingJobs.id, onboardingJobId)
              )
            )
            .catch((statusError: unknown) => {
              logger.error(
                {
                  tenantId: data.tenantId,
                  onboardingJobId,
                  error: errorMessage(statusError)
                },
                "Failed to persist onboarding error status"
              );
            });
        }

        logger.error(
          {
            tenantId: data.tenantId,
            onboardingJobId,
            error: errorMessage(error)
          },
          "Onboarding crawl failed"
        );
        throw error;
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2
    }
  );

  worker.on("error", (error) => {
    logger.error({ error: errorMessage(error) }, "Onboarding worker error");
  });

  return worker;
}

export type { CrawledPage };
