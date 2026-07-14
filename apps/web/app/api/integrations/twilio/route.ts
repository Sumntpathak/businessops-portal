import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import twilio from "twilio";
import { z } from "zod";
import { encryptTwilioAuthToken, schema, withTenant } from "@recepto/db";
import { validateEnv } from "@recepto/shared/env";
import { apiError } from "@/lib/api";
import { getApiTenantContext } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const connectSchema = z.object({
  accountSid: z.string().trim().regex(/^AC[a-f0-9]{32}$/i, "Invalid Account SID."),
  authToken: z.string().trim().min(32, "Invalid Auth Token."),
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +14155550100.")
});

function voiceWebhookUrl(): string {
  const env = validateEnv(process.env);
  const base = env.PUBLIC_VOICE_URL.endsWith("/")
    ? env.PUBLIC_VOICE_URL
    : env.PUBLIC_VOICE_URL + "/";
  return new URL("twilio/incoming", base).toString();
}

export async function GET() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;

  const scoped = withTenant(db, auth.context.tenantId);
  const [credentials] = await db
    .select({
      accountSid: schema.tenantTwilioCredentials.accountSid,
      webhookConfiguredAt: schema.tenantTwilioCredentials.webhookConfiguredAt,
      updatedAt: schema.tenantTwilioCredentials.updatedAt
    })
    .from(schema.tenantTwilioCredentials)
    .where(scoped.where(schema.tenantTwilioCredentials))
    .limit(1);

  const [phoneNumber] = await db
    .select({ e164: schema.phoneNumbers.e164, status: schema.phoneNumbers.status })
    .from(schema.phoneNumbers)
    .where(scoped.where(schema.phoneNumbers))
    .limit(1);

  return NextResponse.json({
    data: {
      connected: Boolean(credentials),
      accountSid: credentials?.accountSid ?? null,
      phoneNumber: phoneNumber?.e164 ?? null,
      webhookConfigured: Boolean(credentials?.webhookConfiguredAt),
      updatedAt: credentials?.updatedAt?.toISOString() ?? null
    }
  });
}

export async function POST(request: Request) {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;
  if (auth.context.tenant.role !== "owner") {
    return apiError("FORBIDDEN", "Only the business owner can connect Twilio.", 403);
  }

  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "Invalid Twilio details.",
      400
    );
  }
  const { accountSid, authToken, phoneNumber } = parsed.data;

  const client = twilio(accountSid, authToken);

  // Verify the credentials actually work and that this number belongs to this account
  // before saving anything — a bad token here should never write to the database.
  let numberSid: string;
  try {
    const numbers = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    const match = numbers[0];
    if (!match) {
      return apiError(
        "NUMBER_NOT_FOUND",
        "That number was not found on this Twilio account.",
        422
      );
    }
    numberSid = match.sid;
  } catch (error) {
    const message =
      error instanceof Error && "code" in error && (error as { code?: number }).code === 20003
        ? "Invalid Account SID or Auth Token."
        : "Could not reach Twilio with these credentials.";
    return apiError("TWILIO_AUTH_FAILED", message, 422);
  }

  // Reject numbers already routed to a different tenant.
  const [existingOwner] = await db
    .select({ tenantId: schema.phoneNumbers.tenantId })
    .from(schema.phoneNumbers)
    .where(eq(schema.phoneNumbers.e164, phoneNumber))
    .limit(1);
  if (existingOwner && existingOwner.tenantId !== auth.context.tenantId) {
    return apiError(
      "NUMBER_ALREADY_CONNECTED",
      "This number is already connected to a different Recepto business.",
      409
    );
  }

  // Point the number's voice webhook at this deployment before saving, so a save
  // never leaves us with stored credentials for a number that isn't actually wired up.
  try {
    await client.incomingPhoneNumbers(numberSid).update({
      voiceUrl: voiceWebhookUrl(),
      voiceMethod: "POST"
    });
  } catch {
    return apiError(
      "WEBHOOK_CONFIG_FAILED",
      "Connected, but could not configure the voice webhook on this number. Check the number supports Voice.",
      502
    );
  }

  const env = validateEnv(process.env);
  const now = new Date();

  await db.transaction(async (tx) => {
    const txScoped = withTenant(tx, auth.context!.tenantId);
    await tx
      .insert(schema.tenantTwilioCredentials)
      .values(
        txScoped.values({
          accountSid,
          authTokenCiphertext: encryptTwilioAuthToken(authToken, env.SESSION_SECRET),
          phoneNumberSid: numberSid,
          webhookConfiguredAt: now,
          updatedAt: now
        })
      )
      .onConflictDoUpdate({
        target: schema.tenantTwilioCredentials.tenantId,
        set: {
          accountSid,
          authTokenCiphertext: encryptTwilioAuthToken(authToken, env.SESSION_SECRET),
          phoneNumberSid: numberSid,
          webhookConfiguredAt: now,
          updatedAt: now
        }
      });

    await tx
      .insert(schema.phoneNumbers)
      .values({
        tenantId: auth.context!.tenantId,
        e164: phoneNumber,
        channel: "twilio",
        status: "active",
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: schema.phoneNumbers.e164,
        set: { tenantId: auth.context!.tenantId, channel: "twilio", status: "active", updatedAt: now }
      });
  });

  return NextResponse.json({ data: { connected: true, phoneNumber } });
}

export async function DELETE() {
  const auth = await getApiTenantContext();
  if (!auth.context) return auth.response;
  if (auth.context.tenant.role !== "owner") {
    return apiError("FORBIDDEN", "Only the business owner can disconnect Twilio.", 403);
  }

  const scoped = withTenant(db, auth.context.tenantId);
  await db
    .delete(schema.tenantTwilioCredentials)
    .where(scoped.where(schema.tenantTwilioCredentials));
  await db
    .update(schema.phoneNumbers)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(scoped.where(schema.phoneNumbers));

  return NextResponse.json({ data: { connected: false } });
}
