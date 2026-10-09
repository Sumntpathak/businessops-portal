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
  staff,
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
  staffGundeep: "70000000-0000-4000-8000-000000000001",
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
  "# Holistic Migration Solutions",
  "",
  "## Business Overview",
  "- Practice: Holistic Migration Solutions is an Australian migration advisory practice with 15+ years of experience.",
  "- Accreditation: MARA registered (Migration Agents Registration Authority).",
  "- Leadership: Led by Gagandeep Singh (Director & Registered Migration Agent).",
  "- Team: Consulting team includes Gundeep Malhotra (handles visa consultations and client enquiries).",
  "- Website: https://holisticmigrationsolutions.com.au/",
  "- Email: enquiry@holisticgroup.com.au",
  "",
  "## Receptionist Guidelines: Tone & Consultations",
  "- Talk normally and helpfully like a front-desk receptionist.",
  "- Provide general visa information and requirements directly from this document.",
  "- Never aggressively push or pitch a consultation for basic questions.",
  "- Only suggest booking a consultation if the caller's case is serious or complex (such as a visa refusal, cancellation, Section 48 bar, tribunal appeal, or calculating personal points).",
  "",
  "## General Australian Visa Information",
  "- Student Visa (Subclass 500): For studying full-time in Australia. Requires Confirmation of Enrolment (CoE), meeting English requirements (IELTS/PTE), and Genuine Student assessment.",
  "- Temporary Graduate Visa (Subclass 485): Allows international students who completed eligible Australian degrees to live and work temporarily in Australia.",
  "- General Skilled Migration (189, 190, 491): Points-tested visas. Subclass 189 is skilled independent permanent visa; 190 is state-nominated permanent visa; 491 is regional provisional visa. Minimum 65 points and skills assessment required.",
  "- Employer Sponsored Visas (TSS 482, ENS 186): For skilled workers sponsored by an Australian employer to fill labor shortages.",
  "- Partner Visas (820/801 Onshore, 309/100 Offshore): For married or de facto partners of Australian citizens or permanent residents. Requires proof of a genuine relationship.",
  "- Visitor Visa (Subclass 600): For short tourism, visiting family, or business visitor activities.",
  "- English Tests: Most Australian visas accept IELTS, PTE Academic, and TOEFL iBT. Required test scores depend on the specific visa subclass.",
  "",
  "## Locations & Consultations",
  "- Carnegie Office: Level 1, 23 Koornang Road, Carnegie VIC 3163. Phone: +61 3 9999 7994.",
  "- Point Cook Office: 29/22-30 Wallace Ave, Point Cook VIC 3030. Phone: +61 3 9999 7994.",
  "- Adelaide Office: Level 8, 115 King William Street, Adelaide SA 5000. Phone: +61 8 7078 9389.",
  "- Consultation Options: Both in-person office visits and remote consultations (phone or video) are available for clients across Australia and overseas.",
  "",
  "## Operating Hours",
  "- Monday to Friday: 09:00 to 17:00 Australian local time.",
  "- Saturday & Sunday: Closed.",
  "- International / Indian Callers: Australian business hours correspond to morning hours in India (typically 09:00 to 11:30 AM IST daytime overlap).",
  "",
  "## Consultation Services & Pricing",
  "- Initial Consultation Fee: 110 AUD per session (up to 45 minutes of detailed case assessment with a migration specialist).",
  "- Corporate & Skilled Migration: Employer sponsorship, skilled points visas, business sponsorship, and compliance.",
  "- Individual & Family Migration: Partner visas, parent visas, child visas, and family pathways.",
  "- Student & Graduate Services: Student visas, Graduate 485 visas, university admissions, and enrollment guidance.",
  "- Advisory & Complex Matters: Case assessment, visa refusals, cancellations (NOICC), tribunal appeals, and waiver assistance.",
  "",
  "## Common Questions & Policies",
  "- Visa Approval Guarantee: No agent or firm can guarantee a visa outcome. The team prepares and submits compliant, high-quality applications to maximize success.",
  "- Processing Times: Visa processing times are determined solely by the Australian Department of Home Affairs based on case complexity and global volumes.",
  "- Serious & Complex Matters: For previous visa refusals, cancellations, or appeals, a formal consultation ($110 AUD) is recommended to review documents and formulate a strategy.",
  "- Documents to Prepare: Passport, current visa grant notice (if inside Australia), updated resume/CV, and relevant education or employment records."
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

      const businessInfo = {
        receptionistName: "Riya",
        receptionistGender: "female" as const,
        about: "Holistic Migration Solutions is an Australian migration advisory practice with 15+ years experience. MARA registered, led by Gagandeep Singh.",
        email: "enquiry@holisticgroup.com.au",
        website: "https://holisticmigrationsolutions.com.au/",
        offices: [
          { name: "Carnegie, VIC", address: "Level 1, 23 Koornang Road, Carnegie VIC 3163", phone: "+61 3 9999 7994", notes: "" },
          { name: "Point Cook, VIC", address: "29/22-30 Wallace Ave, Point Cook VIC 3030", phone: "+61 3 9999 7994", notes: "" },
          { name: "Adelaide, SA", address: "Level 8, 115 King William Street, Adelaide SA 5000", phone: "+61 8 7078 9389", notes: "" }
        ],
        faqs: [
          { question: "Do you guarantee visa approval?", answer: "No one can guarantee a visa outcome; our team prepares the strongest possible compliant application." },
          { question: "How much is an initial consultation?", answer: "An initial consultation is 110 dollars for up to 45 minutes of detailed case assessment." },
          { question: "Can consultations be held remotely?", answer: "Yes, consultations are available via phone, video call, or in person at our offices." }
        ],
        outOfScope: "binding legal advice, guaranteed visa outcomes, medical or financial advice"
      };

      await tx
        .insert(agentProfiles)
        .values(
          tenant.values({
            id: IDS.profile,
            agentMd,
            voiceGreeting,
            languageMode: "english",
            languages: ["English", "Hindi", "Punjabi"],
            businessInfo,
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
            languages: ["English", "Hindi", "Punjabi"],
            businessInfo,
            version: 1,
            source: "manual",
            updatedBy: IDS.user,
            updatedAt: now
          }
        });

      await tx
        .insert(staff)
        .values(
          tenant.values({
            id: IDS.staffGundeep,
            name: "Gundeep Malhotra",
            phoneE164: "+61413130084",
            isRegisteredAgent: false,
            credentialLabel: "",
            handles: "visa consultations and general enquiries",
            active: true,
            updatedAt: now
          })
        )
        .onConflictDoUpdate({
          target: [staff.tenantId, staff.name],
          set: {
            phoneE164: "+61413130084",
            handles: "visa consultations and general enquiries",
            active: true,
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
          price: "110.00",
          description: "Employer-sponsored visas, visa extensions, business sponsorship, compliance.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.individualMigration,
          name: "Individual / Family Migration Consultation",
          durationMinutes: 45,
          price: "110.00",
          description: "Partner and parent visas, business migration, work permits, family pathways.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.studentServices,
          name: "Student Services Consultation",
          durationMinutes: 30,
          price: "110.00",
          description: "Student/graduate visas, enrolment support, IELTS/PTE and loan advice.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.advisory,
          name: "General Advisory Consultation",
          durationMinutes: 30,
          price: "110.00",
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
