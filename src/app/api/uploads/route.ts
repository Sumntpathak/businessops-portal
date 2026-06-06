import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { fileAttachments } from "@/server/db/schema";
import { withAuth } from "@/server/http/with-auth";
import { err, ok } from "@/server/http/response";
import { leadService } from "@/features/leads/server/lead.service";
import { invoiceService } from "@/features/invoices/server/invoice.service";
import type { JWTPayload } from "@/server/auth/jwt";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "application/pdf"]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "pdf"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const entitySchema = z.object({
  entityType: z.enum(["lead", "invoice"]),
  entityId: z.string().uuid(),
});

async function assertTargetAccess(entityType: "lead" | "invoice", entityId: string, ctx: JWTPayload) {
  if (entityType === "lead") {
    await leadService.getById(entityId, ctx);
    return;
  }

  await invoiceService.getById(entityId, ctx);
}

async function uploadToCloudinary(file: File): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary not configured");

  const timestamp = Math.round(Date.now() / 1000);
  const signature = await generateSignature(timestamp, apiSecret);

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", "businessops");

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json() as { secure_url: string };
  return data.secure_url;
}

async function generateSignature(timestamp: number, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = `folder=businessops&timestamp=${timestamp}${secret}`;
  const sig = await crypto.subtle.digest("SHA-1", enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const entityType = formData.get("entityType") as string | null;
  const entityId = formData.get("entityId") as string | null;

  if (!file) return err("No file provided", 400);
  const parsed = entitySchema.safeParse({ entityType, entityId });
  if (!parsed.success) return err("Invalid upload target", 400, parsed.error.flatten().fieldErrors);
  await assertTargetAccess(parsed.data.entityType, parsed.data.entityId, ctx);

  // Backend type validation — never trust client MIME type alone
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return err("File type not allowed. Accepted: PDF, PNG, JPG, JPEG", 400);
  if (!ALLOWED_TYPES.has(file.type)) return err("File MIME type not allowed", 400);
  if (file.size > MAX_BYTES) return err("File exceeds 2 MB limit", 400);

  let fileUrl: string;
  try {
    fileUrl = await uploadToCloudinary(file);
  } catch (error) {
    const message = error instanceof Error && error.message === "Cloudinary not configured"
      ? "File uploads are not configured yet. Add Cloudinary credentials to enable attachments."
      : "File upload failed. Check Cloudinary configuration.";
    return err(message, error instanceof Error && error.message === "Cloudinary not configured" ? 503 : 500);
  }

  const [attachment] = await db.insert(fileAttachments).values({
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
    fileName: file.name,
    fileUrl,
    fileType: ext,
    fileSizeBytes: file.size,
    uploadedBy: ctx.sub,
  }).returning();

  return ok(attachment, 201);
});

// GET /api/uploads?entityType=lead&entityId=xxx
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const entityType = req.nextUrl.searchParams.get("entityType");
  const entityId = req.nextUrl.searchParams.get("entityId");
  const parsed = entitySchema.safeParse({ entityType, entityId });
  if (!parsed.success) return err("Invalid upload target", 400, parsed.error.flatten().fieldErrors);
  await assertTargetAccess(parsed.data.entityType, parsed.data.entityId, ctx);

  const rows = await db.select().from(fileAttachments)
    .where(and(eq(fileAttachments.entityType, parsed.data.entityType), eq(fileAttachments.entityId, parsed.data.entityId)));

  return ok(rows);
});
