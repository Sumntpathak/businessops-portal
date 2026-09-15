import { config } from "dotenv";

config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  agentProfileRevisions,
  agentProfiles,
  businessHours,
  phoneNumbers,
  services,
  tenantMembers,
  tenants,
  users
} from "./schema.js";
import { withTenant } from "./tenant.js";

const IDS = {
  user: "10000000-0000-4000-8000-000000000002",
  tenant: "20000000-0000-4000-8000-000000000002",
  membership: "30000000-0000-4000-8000-000000000002",
  profile: "40000000-0000-4000-8000-000000000002",
  revision: "41000000-0000-4000-8000-000000000002",
  phoneNumber: "90000000-0000-4000-8000-000000000002",
  corporateMigration: "50000000-0000-4000-8000-000000000010",
  individualMigration: "50000000-0000-4000-8000-000000000011",
  studentServices: "50000000-0000-4000-8000-000000000012",
  advisory: "50000000-0000-4000-8000-000000000013"
} as const;

const OWNER_EMAIL = "gd@gmail.com";
const DASHBOARD_PASSWORD = "Holistic2026!Demo";
// Precomputed with bcryptjs (cost 12) for the password above.
const DASHBOARD_PASSWORD_HASH =
  "$2b$12$P8vsHeMpXQqwVXQS6n.EzON/FOAlreZVo4JXOCgtykci0nuYOcHBe";

const agentMd = [
  "# Holistic Migration Solutions Reception Agent",
  "",
  "## Identity",
  "- You are Riya, the warm and professional receptionist for Holistic Migration Solutions.",
  "- Speak naturally and never claim to be a registered migration agent (MARA agent) yourself.",
  "- You can share general information from this document, but you must never give personal migration advice",
  "  or interpret visa rules for a caller's specific situation — that requires a registered agent.",
  "",
  "## Business",
  "- Name: Holistic Migration Solutions",
  "- Tagline: Guiding You To A Safe, Secure, and Premium Life in Australia.",
  "- 15+ years of experience in Australian migration advisory. MARA registered (Migration Agents",
  "  Registration Authority). Led by Gagandeep Singh.",
  "- Website: https://holisticmigrationsolutions.com.au/",
  "- Email: enquiry@holisticgroup.com.au",
  "- Timezone: Australia/Melbourne (Carnegie and Point Cook offices); Adelaide office is",
  "  Australia/Adelaide — confirm which office a caller means before quoting a time.",
  "",
  "## Locations",
  "- Carnegie, VIC: Level 1, 23 Koornang Road, Carnegie VIC 3163. Phone: +61 3 9999 7994.",
  "- Point Cook, VIC: 29/22-30 Wallace Ave, Point Cook VIC 3030. Phone: +61 3 9999 7994.",
  "- Adelaide, SA: Level 8, 115 King William Street, Adelaide SA 5000. Phone: +61 8 7078 9389.",
  "",
  "## Hours (UNVERIFIED PLACEHOLDER — see Booking Rules)",
  "- Monday to Friday: 09:00 to 17:00, local time for each office.",
  "- Saturday and Sunday: closed.",
  "- These hours have not been confirmed directly with the business. Do not state them as certain.",
  "",
  "## Services",
  "- Corporate / Skilled Migration: employer-sponsored visas, visa extensions, business sponsorship,",
  "  post-visa compliance.",
  "- Individual / Family Migration: partner and parent visas, business migration, work permits,",
  "  family pathways.",
  "- Student Services: student and graduate visas, enrolment support, IELTS/PTE coaching guidance,",
  "  education loan advice.",
  "- Advisory Services: case consultation, application/submission preparation, mentoring, waiver",
  "  assistance.",
  "- No public pricing is published for any service. Never quote a price — always say pricing depends",
  "  on the case and will be discussed during consultation.",
  "",
  "## Process",
  "- Their standard four-step approach: initial consultation, personalized planning, application",
  "  guidance, ongoing assistance.",
  "",
  "## Booking Rules",
  "- Ask for the caller's name, the best contact number, and which office or visa topic they're",
  "  calling about.",
  "- If asked for exact opening hours, say: \"Let me have someone confirm our current hours and",
  "  follow up with you\" — do not assert the placeholder hours with confidence.",
  "- Never diagnose visa eligibility, quote timelines, or promise outcomes. These are legal",
  "  migration matters that only a registered MARA agent can advise on.",
  "- Repeat back the date, time, and office location before confirming any booked consultation.",
  "- Never double-book a calendar slot.",
  "",
  "## Common Questions",
  "- \"Do you guarantee visa approval?\" — No one can guarantee a visa outcome; explain that the team",
  "  provides guidance and prepares the strongest possible application.",
  "- \"How much does it cost?\" — Pricing depends on the visa type and complexity; offer a consultation",
  "  to get an accurate quote.",
  "- \"Which office should I go to?\" — Ask where the caller is located and offer the nearest of the",
  "  three offices, or note that consultations may be available remotely.",
  "",
  "## Privacy",
  "- Collect only the information needed to answer the caller's question or book a consultation.",
  "- Never repeat one caller's details to another caller.",
  "- If unsure about a legal/visa question, take a message for the team rather than guessing."
].join("\n");

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the database.");
  }

  const twilioNumber = process.env.TWILIO_NUMBER;
  if (!twilioNumber) {
    throw new Error("TWILIO_NUMBER is required to seed the phone number mapping.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const passwordHash = DASHBOARD_PASSWORD_HASH;

    await db.transaction(async (tx) => {
      const now = new Date();
      const tenant = withTenant(tx, IDS.tenant);

      await tx
        .insert(users)
        .values({
          id: IDS.user,
          email: OWNER_EMAIL,
          passwordHash,
          name: "Gagandeep Singh",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { passwordHash, name: "Gagandeep Singh", updatedAt: now }
        });

      await tx
        .insert(tenants)
        .values({
          id: IDS.tenant,
          name: "Holistic Migration Solutions",
          slug: "holistic-migration-solutions",
          status: "live",
          businessPhone: "+61399997994",
          websiteUrl: "https://holisticmigrationsolutions.com.au/",
          timezone: "Australia/Melbourne",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: tenants.id,
          set: {
            name: "Holistic Migration Solutions",
            slug: "holistic-migration-solutions",
            status: "live",
            businessPhone: "+61399997994",
            websiteUrl: "https://holisticmigrationsolutions.com.au/",
            timezone: "Australia/Melbourne",
            deletedAt: null,
            updatedAt: now
          }
        });

      await tx
        .insert(tenantMembers)
        .values(
          tenant.values({
            id: IDS.membership,
            userId: IDS.user,
            role: "owner",
            updatedAt: now
          })
        )
        .onConflictDoUpdate({
          target: [tenantMembers.tenantId, tenantMembers.userId],
          set: { role: "owner", updatedAt: now }
        });

      const voiceGreeting =
        "Thanks for calling Holistic Migration Solutions, this is Riya — how can I help you today?";

      await tx
        .insert(agentProfiles)
        .values(
          tenant.values({
            id: IDS.profile,
            agentMd,
            voiceGreeting,
            languageMode: "english",
            version: 1,
            source: "manual",
            updatedBy: IDS.user,
            updatedAt: now
          })
        )
        .onConflictDoUpdate({
          target: agentProfiles.tenantId,
          set: {
            agentMd,
            voiceGreeting,
            languageMode: "english",
            version: 1,
            source: "manual",
            updatedBy: IDS.user,
            updatedAt: now
          }
        });

      await tx
        .insert(agentProfileRevisions)
        .values(
          tenant.values({
            id: IDS.revision,
            agentMd,
            version: 1,
            updatedAt: now
          })
        )
        .onConflictDoNothing();

      const demoServices = [
        tenant.values({
          id: IDS.corporateMigration,
          name: "Corporate / Skilled Migration Consultation",
          durationMinutes: 45,
          price: null,
          description: "Employer-sponsored visas, visa extensions, business sponsorship, compliance.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.individualMigration,
          name: "Individual / Family Migration Consultation",
          durationMinutes: 45,
          price: null,
          description: "Partner and parent visas, business migration, work permits, family pathways.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.studentServices,
          name: "Student Services Consultation",
          durationMinutes: 30,
          price: null,
          description: "Student/graduate visas, enrolment support, IELTS/PTE and loan advice.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.advisory,
          name: "General Advisory Consultation",
          durationMinutes: 30,
          price: null,
          description: "Case consultation, submission preparation, mentoring, waiver assistance.",
          active: true,
          updatedAt: now
        })
      ];

      for (const demoService of demoServices) {
        await tx
          .insert(services)
          .values(demoService)
          .onConflictDoUpdate({
            target: [services.tenantId, services.name],
            set: {
              durationMinutes: demoService.durationMinutes,
              price: demoService.price,
              description: demoService.description,
              active: demoService.active,
              updatedAt: now
            }
          });
      }

      const hours = [
        ["81000000-0000-4000-8000-000000000000", 0, "00:00:00", "00:00:00", true],
        ["81000000-0000-4000-8000-000000000001", 1, "09:00:00", "17:00:00", false],
        ["81000000-0000-4000-8000-000000000002", 2, "09:00:00", "17:00:00", false],
        ["81000000-0000-4000-8000-000000000003", 3, "09:00:00", "17:00:00", false],
        ["81000000-0000-4000-8000-000000000004", 4, "09:00:00", "17:00:00", false],
        ["81000000-0000-4000-8000-000000000005", 5, "09:00:00", "17:00:00", false],
        ["81000000-0000-4000-8000-000000000006", 6, "00:00:00", "00:00:00", true]
      ] as const;

      for (const [id, weekday, opens, closes, closed] of hours) {
        await tx
          .insert(businessHours)
          .values(
            tenant.values({
              id,
              weekday,
              opens,
              closes,
              closed,
              updatedAt: now
            })
          )
          .onConflictDoUpdate({
            target: [businessHours.tenantId, businessHours.weekday],
            set: { opens, closes, closed, updatedAt: now }
          });
      }

      await tx
        .insert(phoneNumbers)
        .values({
          id: IDS.phoneNumber,
          tenantId: IDS.tenant,
          e164: twilioNumber,
          channel: "twilio",
          status: "active",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: phoneNumbers.e164,
          set: { tenantId: IDS.tenant, channel: "twilio", status: "active", updatedAt: now }
        });
    });

    console.log("Seeded Holistic Migration Solutions tenant.");
    console.log("Dashboard login:", OWNER_EMAIL, "/", DASHBOARD_PASSWORD);
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error("Database seed failed:", error);
  process.exitCode = 1;
});
