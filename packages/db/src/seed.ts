import { config } from "dotenv";

config({ path: "../../.env" });
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  agentProfileRevisions,
  agentProfiles,
  bookings,
  businessHours,
  callers,
  services,
  tenantMembers,
  tenants,
  users
} from "./schema.js";
import { withTenant } from "./tenant.js";

const IDS = {
  user: "10000000-0000-4000-8000-000000000001",
  tenant: "20000000-0000-4000-8000-000000000001",
  membership: "30000000-0000-4000-8000-000000000001",
  profile: "40000000-0000-4000-8000-000000000001",
  revision: "41000000-0000-4000-8000-000000000001",
  consultation: "50000000-0000-4000-8000-000000000001",
  cleaning: "50000000-0000-4000-8000-000000000002",
  whitening: "50000000-0000-4000-8000-000000000003",
  caller: "60000000-0000-4000-8000-000000000001",
  booking: "70000000-0000-4000-8000-000000000001"
} as const;

const agentMd = [
  "# BrightSmile Dental Reception Agent",
  "",
  "## Identity",
  "- You are Riya, the warm and efficient receptionist for BrightSmile Dental.",
  "- Speak naturally and never claim to be a dentist.",
  "- Use concise, reassuring language suitable for a phone conversation.",
  "",
  "## Clinic",
  "- Name: BrightSmile Dental",
  "- Address: 18 Residency Road, Bengaluru, Karnataka 560025.",
  "- Phone: +91 80 4567 8900.",
  "- Website: https://brightsmile.example.com.",
  "- Timezone: Asia/Kolkata.",
  "",
  "## Language",
  "- Begin in friendly Hinglish.",
  "- Continue in English, Hindi, or Hinglish based on the caller's preference.",
  "- Keep clinical terms in English when that makes them clearer.",
  "",
  "## Hours",
  "- Monday to Friday: 09:00 to 18:00.",
  "- Saturday: 09:00 to 14:00.",
  "- Sunday: closed.",
  "",
  "## Services",
  "- New-patient consultation: 30 minutes, ₹500.",
  "- Dental cleaning: 45 minutes, ₹1,500.",
  "- Teeth whitening consultation: 30 minutes, ₹750.",
  "",
  "## Booking Rules",
  "- Ask for the caller's name and confirm their phone number.",
  "- Ask which service they need before offering appointment times.",
  "- Repeat the date, time, service, and price before confirming.",
  "- Never double-book a calendar slot.",
  "- Mention that treatment prices may change after the dentist examines them.",
  "",
  "## Urgent Calls",
  "- For severe bleeding, facial trauma, breathing trouble, or swelling affecting swallowing,",
  "  advise the caller to seek emergency medical care immediately.",
  "- For significant dental pain, offer the earliest available consultation.",
  "- Do not diagnose conditions or recommend prescription medication.",
  "",
  "## Common Questions",
  "- Walk-ins are accepted only when a dentist is available.",
  "- UPI, cards, and cash are accepted.",
  "- Patients should arrive 10 minutes early for their first appointment.",
  "- Cancellation is free until 4 hours before the appointment.",
  "",
  "## Privacy",
  "- Collect only information needed to answer or book.",
  "- Never repeat one caller's details to another caller.",
  "- If unsure, take a message for clinic staff rather than inventing an answer."
].join("\n");

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the database.");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      const tenant = withTenant(tx, IDS.tenant);

      await tx
        .insert(users)
        .values({
          id: IDS.user,
          email: "owner@brightsmile.example.com",
          passwordHash: null,
          name: "Dr. Ananya Rao",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { name: "Dr. Ananya Rao", updatedAt: now }
        });

      await tx
        .insert(tenants)
        .values({
          id: IDS.tenant,
          name: "BrightSmile Dental",
          slug: "brightsmile-dental",
          status: "live",
          businessPhone: "+918045678900",
          websiteUrl: "https://brightsmile.example.com",
          timezone: "Asia/Kolkata",
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: tenants.slug,
          set: {
            name: "BrightSmile Dental",
            status: "live",
            businessPhone: "+918045678900",
            websiteUrl: "https://brightsmile.example.com",
            timezone: "Asia/Kolkata",
            deletedAt: null,
            updatedAt: now
          },
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

      await tx
        .insert(agentProfiles)
        .values(
          tenant.values({
            id: IDS.profile,
            agentMd,
            voiceGreeting:
              "Namaste! BrightSmile Dental mein aapka swagat hai. Main Riya hoon—main aapki kaise madad kar sakti hoon?",
            languageMode: "hinglish",
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
            voiceGreeting:
              "Namaste! BrightSmile Dental mein aapka swagat hai. Main Riya hoon—main aapki kaise madad kar sakti hoon?",
            languageMode: "hinglish",
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
          id: IDS.consultation,
          name: "New-patient consultation",
          durationMinutes: 30,
          price: "500.00",
          description: "Initial examination and treatment discussion.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.cleaning,
          name: "Dental cleaning",
          durationMinutes: 45,
          price: "1500.00",
          description: "Routine scaling, polishing, and oral-hygiene guidance.",
          active: true,
          updatedAt: now
        }),
        tenant.values({
          id: IDS.whitening,
          name: "Teeth whitening consultation",
          durationMinutes: 30,
          price: "750.00",
          description: "Suitability assessment and whitening plan.",
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
        ["80000000-0000-4000-8000-000000000000", 0, "00:00:00", "00:00:00", true],
        ["80000000-0000-4000-8000-000000000001", 1, "09:00:00", "18:00:00", false],
        ["80000000-0000-4000-8000-000000000002", 2, "09:00:00", "18:00:00", false],
        ["80000000-0000-4000-8000-000000000003", 3, "09:00:00", "18:00:00", false],
        ["80000000-0000-4000-8000-000000000004", 4, "09:00:00", "18:00:00", false],
        ["80000000-0000-4000-8000-000000000005", 5, "09:00:00", "18:00:00", false],
        ["80000000-0000-4000-8000-000000000006", 6, "09:00:00", "14:00:00", false]
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
        .insert(callers)
        .values(
          tenant.values({
            id: IDS.caller,
            phoneE164: "+919876543210",
            displayName: "Meera Sharma",
            updatedAt: now
          })
        )
        .onConflictDoUpdate({
          target: [callers.tenantId, callers.phoneE164],
          set: { displayName: "Meera Sharma", updatedAt: now }
        });

      await tx
        .insert(bookings)
        .values(
          tenant.values({
            id: IDS.booking,
            callerId: IDS.caller,
            serviceId: IDS.cleaning,
            startsAt: new Date("2030-01-15T04:30:00.000Z"),
            endsAt: new Date("2030-01-15T05:15:00.000Z"),
            status: "confirmed",
            notes: "Demo cleaning appointment.",
            updatedAt: now
          })
        )
        .onConflictDoUpdate({
          target: bookings.id,
          set: {
            startsAt: new Date("2030-01-15T04:30:00.000Z"),
            endsAt: new Date("2030-01-15T05:15:00.000Z"),
            status: "confirmed",
            deletedAt: null,
            updatedAt: now
          },
          setWhere: tenant.where(bookings)
        });
    });

    console.log("Seeded BrightSmile Dental demo tenant.");
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error("Database seed failed:", error);
  process.exitCode = 1;
});
