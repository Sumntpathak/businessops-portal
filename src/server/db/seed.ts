/**
 * Seed script — run with: npm run db:seed
 * Timezone assumption: All dates stored as UTC. Follow-up dates use YYYY-MM-DD strings.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import bcrypt from "bcryptjs";
import * as schema from "./schema";
import { DEMO_ACCOUNTS } from "@/features/auth/demo-accounts";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const today = new Date();
const fmtDate = (d: Date) => d.toISOString().split("T")[0];
const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

function optionalEnv(name: string) {
  return process.env[name];
}

const seedPasswords = {
  admin: optionalEnv("SEED_ADMIN_PASSWORD") ?? DEMO_ACCOUNTS[0].password,
  manager: optionalEnv("SEED_MANAGER_PASSWORD") ?? DEMO_ACCOUNTS[1].password,
  agentOne: optionalEnv("SEED_AGENT_ONE_PASSWORD") ?? DEMO_ACCOUNTS[2].password,
  agentTwo: optionalEnv("SEED_AGENT_TWO_PASSWORD") ?? DEMO_ACCOUNTS[3].password,
  finance: optionalEnv("SEED_FINANCE_PASSWORD") ?? DEMO_ACCOUNTS[4].password,
};

async function seed() {
  console.log("🌱 Seeding database...\n");

  // ─── USERS ────────────────────────────────────────────────────────────────
  const hash = (p: string) => bcrypt.hash(p, 12);

  const [admin] = await db.insert(schema.users).values({
    name: "Admin User",
    email: "admin@businessops.dev",
    passwordHash: await hash(seedPasswords.admin),
    role: "admin",
    isActive: true,
  }).returning();

  const [manager] = await db.insert(schema.users).values({
    name: "Manager User",
    email: "manager@businessops.dev",
    passwordHash: await hash(seedPasswords.manager),
    role: "manager",
    isActive: true,
  }).returning();

  const [agent1] = await db.insert(schema.users).values({
    name: "Agent One",
    email: "agent1@businessops.dev",
    passwordHash: await hash(seedPasswords.agentOne),
    role: "agent",
    isActive: true,
  }).returning();

  const [agent2] = await db.insert(schema.users).values({
    name: "Agent Two",
    email: "agent2@businessops.dev",
    passwordHash: await hash(seedPasswords.agentTwo),
    role: "agent",
    isActive: true,
  }).returning();

  const [finance] = await db.insert(schema.users).values({
    name: "Finance User",
    email: "finance@businessops.dev",
    passwordHash: await hash(seedPasswords.finance),
    role: "finance",
    isActive: true,
  }).returning();

  console.log("✅ Users seeded (5)");

  // ─── LEADS (20) ───────────────────────────────────────────────────────────
  const leadData = [
    { name: "Rajesh Kumar", email: "rajesh@techcorp.in", phone: "9876543210", company: "TechCorp India", source: "Website", status: "New", assignedTo: agent1.id },
    { name: "Priya Sharma", email: "priya@greenfin.com", phone: "9123456789", company: "GreenFin Ltd", source: "Referral", status: "Contacted", assignedTo: agent1.id },
    { name: "Amit Patel", email: "amit@buildco.net", phone: "9988776655", company: "BuildCo", source: "Cold Call", status: "Follow-Up", assignedTo: agent1.id },
    { name: "Sneha Rao", email: "sneha@digitalwave.io", phone: "9765432100", company: "DigitalWave", source: "Social Media", status: "Converted", assignedTo: agent1.id },
    { name: "Vikram Singh", email: "vikram@logixpro.com", phone: "9654321098", company: "LogixPro", source: "Email Campaign", status: "Lost", assignedTo: agent1.id },
    { name: "Neha Gupta", email: "neha@smartretail.in", phone: "9543210987", company: "SmartRetail", source: "Website", status: "New", assignedTo: agent2.id },
    { name: "Karan Mehta", email: "karan@cloudsync.io", phone: "9432109876", company: "CloudSync", source: "Referral", status: "Contacted", assignedTo: agent2.id },
    { name: "Ananya Das", email: "ananya@edutech.co", phone: "9321098765", company: "EduTech Co", source: "Walk-In", status: "Follow-Up", assignedTo: agent2.id },
    { name: "Rohit Verma", email: "rohit@securebank.in", phone: "9210987654", company: "SecureBank", source: "Cold Call", status: "Converted", assignedTo: agent2.id },
    { name: "Pooja Nair", email: "pooja@freshfood.com", phone: "9109876543", company: "FreshFood", source: "Social Media", status: "Lost", assignedTo: agent2.id },
    { name: "Arjun Kapoor", email: "arjun@mobilefirst.in", phone: "9098765432", company: "MobileFirst", source: "Website", status: "New", assignedTo: agent1.id },
    { name: "Divya Menon", email: "divya@healthtech.co", phone: "8987654321", company: "HealthTech", source: "Referral", status: "Contacted", assignedTo: agent1.id },
    { name: "Suresh Pillai", email: "suresh@lawfirm.in", phone: "8876543210", company: "Law & Associates", source: "Email Campaign", status: "Follow-Up", assignedTo: agent2.id },
    { name: "Meera Joshi", email: "meera@autoparts.com", phone: "8765432109", company: "AutoParts Ltd", source: "Cold Call", status: "New", assignedTo: agent2.id },
    { name: "Nikhil Agarwal", email: "nikhil@fintech.io", phone: "8654321098", company: "FinTech Solutions", source: "Walk-In", status: "Contacted", assignedTo: agent1.id },
    { name: "Sana Khan", email: "sana@ecommerceX.in", phone: "8543210987", company: "EcommerceX", source: "Social Media", status: "Converted", assignedTo: agent2.id },
    { name: "Praveen Nambiar", email: "praveen@realtech.com", phone: "8432109876", company: "RealTech Corp", source: "Website", status: "Lost", assignedTo: agent1.id },
    { name: "Asha Thomas", email: "asha@greenenergy.in", phone: "8321098765", company: "GreenEnergy", source: "Referral", status: "New", assignedTo: agent2.id },
    { name: "Ravi Shankar", email: "ravi@consultpro.com", phone: "8210987654", company: "ConsultPro", source: "Email Campaign", status: "Follow-Up", assignedTo: agent1.id },
    { name: "Lakshmi Iyer", email: "lakshmi@ngoworld.org", phone: "8109876543", company: "NGO World", source: "Walk-In", status: "Contacted", assignedTo: agent2.id },
  ] as const;

  const insertedLeads = await db.insert(schema.leads).values(
    leadData.map((l) => ({
      ...l,
      createdBy: admin.id,
    }))
  ).returning();

  console.log("✅ Leads seeded (20)");

  // ─── FOLLOW-UPS (10) ──────────────────────────────────────────────────────
  // 3 due today, 2 overdue, 5 upcoming
  const followUpData = [
    { leadIndex: 0, date: fmtDate(today), message: "Call to discuss proposal", status: "Pending", createdBy: agent1.id },
    { leadIndex: 1, date: fmtDate(today), message: "Send pricing document", status: "Pending", createdBy: agent1.id },
    { leadIndex: 2, date: fmtDate(today), message: "Follow up on demo feedback", status: "Pending", createdBy: agent1.id },
    { leadIndex: 3, date: fmtDate(addDays(today, -3)), message: "Collect signed contract", status: "Pending", createdBy: agent1.id },
    { leadIndex: 4, date: fmtDate(addDays(today, -7)), message: "Final check-in", status: "Pending", createdBy: agent2.id },
    { leadIndex: 5, date: fmtDate(addDays(today, 2)), message: "Demo walkthrough scheduled", status: "Pending", createdBy: agent2.id },
    { leadIndex: 6, date: fmtDate(addDays(today, 4)), message: "Send onboarding docs", status: "Pending", createdBy: agent2.id },
    { leadIndex: 7, date: fmtDate(addDays(today, 7)), message: "Monthly review call", status: "Completed", createdBy: agent1.id },
    { leadIndex: 8, date: fmtDate(addDays(today, 10)), message: "Technical POC review", status: "Pending", createdBy: agent2.id },
    { leadIndex: 9, date: fmtDate(addDays(today, 14)), message: "Contract renewal discussion", status: "Cancelled", createdBy: agent1.id },
  ];

  await db.insert(schema.followups).values(
    followUpData.map((f) => ({
      leadId: insertedLeads[f.leadIndex].id,
      followUpDate: f.date,
      message: f.message,
      status: f.status as "Pending" | "Completed" | "Cancelled",
      createdBy: f.createdBy,
    }))
  );

  console.log("✅ Follow-ups seeded (10: 3 today, 2 overdue, 5 upcoming)");

  // ─── INVOICES (8) ─────────────────────────────────────────────────────────
  const makeInvNum = (n: number) => `INV-2025-${String(n).padStart(4, "0")}`;

  // Invoice 1: Draft, single item
  const [inv1] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(1),
    leadId: insertedLeads[3].id,
    clientName: "Sneha Rao / DigitalWave",
    subtotal: "15000.00",
    taxPercentage: "18.00",
    taxAmount: "2700.00",
    discount: "0.00",
    totalAmount: "17700.00",
    status: "Draft",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv1.id,
    description: "Business Consulting Services - Q1",
    quantity: 1,
    unitPrice: "15000.00",
    lineTotal: "15000.00",
  });

  // Invoice 2: Sent
  const [inv2] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(2),
    leadId: insertedLeads[8].id,
    clientName: "Rohit Verma / SecureBank",
    subtotal: "25000.00",
    taxPercentage: "18.00",
    taxAmount: "4500.00",
    discount: "2000.00",
    totalAmount: "27500.00",
    status: "Sent",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv2.id,
    description: "Security Audit & Compliance Review",
    quantity: 1,
    unitPrice: "25000.00",
    lineTotal: "25000.00",
  });

  // Invoice 3: Paid
  const [inv3] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(3),
    leadId: insertedLeads[15].id,
    clientName: "Sana Khan / EcommerceX",
    subtotal: "50000.00",
    taxPercentage: "18.00",
    taxAmount: "9000.00",
    discount: "5000.00",
    totalAmount: "54000.00",
    status: "Paid",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv3.id,
    description: "E-commerce Platform Setup",
    quantity: 1,
    unitPrice: "50000.00",
    lineTotal: "50000.00",
  });
  await db.insert(schema.paymentLogs).values({
    invoiceId: inv3.id,
    provider: "mock",
    transactionId: "MOCK-TXN-0001",
    amount: "54000.00",
    status: "Success",
    webhookPayload: JSON.stringify({ event: "payment.success", invoiceId: inv3.id }),
  });

  // Invoice 4: Cancelled
  const [inv4] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(4),
    leadId: insertedLeads[4].id,
    clientName: "Vikram Singh / LogixPro",
    subtotal: "8000.00",
    taxPercentage: "18.00",
    taxAmount: "1440.00",
    discount: "0.00",
    totalAmount: "9440.00",
    status: "Cancelled",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv4.id,
    description: "Logistics Optimization Consultation",
    quantity: 2,
    unitPrice: "4000.00",
    lineTotal: "8000.00",
  });

  // Invoice 5: Draft (another)
  const [inv5] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(5),
    leadId: insertedLeads[11].id,
    clientName: "Divya Menon / HealthTech",
    subtotal: "35000.00",
    taxPercentage: "5.00",
    taxAmount: "1750.00",
    discount: "3500.00",
    totalAmount: "33250.00",
    status: "Draft",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values([
    { invoiceId: inv5.id, description: "Healthcare IT Consulting", quantity: 2, unitPrice: "10000.00", lineTotal: "20000.00" },
    { invoiceId: inv5.id, description: "HIPAA Compliance Review", quantity: 1, unitPrice: "8000.00", lineTotal: "8000.00" },
    { invoiceId: inv5.id, description: "Staff Training Sessions", quantity: 7, unitPrice: "1000.00", lineTotal: "7000.00" },
  ]);

  // Invoice 6: Sent
  const [inv6] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(6),
    leadId: insertedLeads[18].id,
    clientName: "Ravi Shankar / ConsultPro",
    subtotal: "12000.00",
    taxPercentage: "18.00",
    taxAmount: "2160.00",
    discount: "1000.00",
    totalAmount: "13160.00",
    status: "Sent",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv6.id,
    description: "Strategy Consulting Retainer",
    quantity: 4,
    unitPrice: "3000.00",
    lineTotal: "12000.00",
  });

  // Invoice 7: Paid
  const [inv7] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(7),
    leadId: insertedLeads[0].id,
    clientName: "Rajesh Kumar / TechCorp India",
    subtotal: "75000.00",
    taxPercentage: "18.00",
    taxAmount: "13500.00",
    discount: "7500.00",
    totalAmount: "81000.00",
    status: "Paid",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values([
    { invoiceId: inv7.id, description: "Enterprise Software Implementation", quantity: 1, unitPrice: "50000.00", lineTotal: "50000.00" },
    { invoiceId: inv7.id, description: "Custom API Integration", quantity: 5, unitPrice: "5000.00", lineTotal: "25000.00" },
  ]);
  await db.insert(schema.paymentLogs).values({
    invoiceId: inv7.id,
    provider: "mock",
    transactionId: "MOCK-TXN-0002",
    amount: "81000.00",
    status: "Success",
    webhookPayload: JSON.stringify({ event: "payment.success", invoiceId: inv7.id }),
  });

  // Invoice 8: Cancelled (failed payment attempt logged)
  const [inv8] = await db.insert(schema.invoices).values({
    invoiceNumber: makeInvNum(8),
    leadId: insertedLeads[9].id,
    clientName: "Pooja Nair / FreshFood",
    subtotal: "6000.00",
    taxPercentage: "12.00",
    taxAmount: "720.00",
    discount: "0.00",
    totalAmount: "6720.00",
    status: "Cancelled",
    createdBy: finance.id,
  }).returning();
  await db.insert(schema.invoiceItems).values({
    invoiceId: inv8.id,
    description: "Market Entry Consulting",
    quantity: 3,
    unitPrice: "2000.00",
    lineTotal: "6000.00",
  });
  await db.insert(schema.paymentLogs).values({
    invoiceId: inv8.id,
    provider: "mock",
    transactionId: null,
    amount: "6720.00",
    status: "Failed",
    webhookPayload: JSON.stringify({ event: "payment.failed", reason: "insufficient_funds" }),
  });

  console.log("✅ Invoices seeded (8: 2 Draft, 2 Sent, 2 Paid, 2 Cancelled)");

  // ─── FILE ATTACHMENT ───────────────────────────────────────────────────────
  await db.insert(schema.fileAttachments).values({
    entityType: "lead",
    entityId: insertedLeads[3].id,
    fileName: "sneha-rao-proposal.pdf",
    fileUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf",
    fileType: "pdf",
    fileSizeBytes: 204800,
    uploadedBy: agent1.id,
  });

  console.log("✅ File attachments seeded (1)");

  // ─── AUDIT LOGS ────────────────────────────────────────────────────────────
  await db.insert(schema.auditLogs).values([
    { actorUserId: admin.id, action: "USER_CREATED", entityType: "user", entityId: agent1.id, metadata: JSON.stringify({ role: "agent" }) },
    { actorUserId: admin.id, action: "USER_CREATED", entityType: "user", entityId: agent2.id, metadata: JSON.stringify({ role: "agent" }) },
    { actorUserId: admin.id, action: "LEAD_CREATED", entityType: "lead", entityId: insertedLeads[0].id },
    { actorUserId: manager.id, action: "LEAD_ASSIGNED", entityType: "lead", entityId: insertedLeads[0].id, metadata: JSON.stringify({ assignedTo: agent1.id }) },
    { actorUserId: finance.id, action: "INVOICE_CREATED", entityType: "invoice", entityId: inv1.id },
    { actorUserId: finance.id, action: "INVOICE_STATUS_CHANGED", entityType: "invoice", entityId: inv3.id, metadata: JSON.stringify({ from: "Sent", to: "Paid" }) },
    { actorUserId: null, action: "PAYMENT_WEBHOOK_SUCCESS", entityType: "payment", entityId: inv3.id, metadata: JSON.stringify({ txn: "MOCK-TXN-0001" }) },
    { actorUserId: null, action: "PAYMENT_WEBHOOK_FAILED", entityType: "payment", entityId: inv8.id, metadata: JSON.stringify({ reason: "insufficient_funds" }) },
  ]);

  console.log("✅ Audit logs seeded");
  console.log("\n🎉 Seed complete!\n");
  console.log("Seed users created. Passwords were read from SEED_* environment variables.");
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
