import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { integrationConfigs } from "@/server/db/schema";

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Single SMTP source: the admin-configured email integration in Settings.
 * Env vars (SMTP_*) are a fallback for local dev only.
 * No special yopmail routing — one config handles all recipients.
 */
async function resolveSmtp(): Promise<{ cfg: SmtpConfig; source: string } | null> {
  // 1. Admin integration config from DB (Settings → Integrations → Email)
  try {
    const [row] = await db
      .select({ config: integrationConfigs.config })
      .from(integrationConfigs)
      .where(and(eq(integrationConfigs.type, "email"), eq(integrationConfigs.isEnabled, true)))
      .limit(1);

    if (row) {
      const cfg = JSON.parse(row.config) as Record<string, unknown>;
      const host = cfg.host as string | undefined;
      const user = (cfg.senderEmail ?? cfg.user ?? cfg.username) as string | undefined;
      const pass = (cfg.smtpPassword ?? cfg.pass ?? cfg.password) as string | undefined;
      if (host && user && pass) {
        const senderName = cfg.senderName as string | undefined;
        const from = senderName ? `${senderName} <${user}>` : user;
        return { cfg: { host, port: Number(cfg.port ?? 587), user, pass, from }, source: "integration" };
      }
    }
  } catch {
    // DB unavailable — fall through to env vars
  }

  // 2. Env var fallback (local dev)
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && user && pass) {
    const from = process.env.SMTP_FROM ?? user;
    return { cfg: { host, port: Number(process.env.SMTP_PORT ?? "587"), user, pass, from }, source: "env" };
  }

  return null;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const resolved = await resolveSmtp();

  if (!resolved) {
    console.warn(`[mailer] No SMTP configured. To enable: Settings → Integrations → Email (enable + set SMTP password).`);
    return { sent: false, reason: "SMTP not configured" };
  }

  const { cfg, source } = resolved;
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  try {
    const info = await transport.sendMail({ from: cfg.from, to: opts.to, subject: opts.subject, html: opts.html });
    console.log(`[mailer] ✅ Sent to ${opts.to} via ${source} | messageId: ${info.messageId}`);
    return { sent: true };
  } catch (e) {
    console.error(`[mailer] ❌ Failed to send to ${opts.to} via ${source}:`, e);
    return { sent: false, reason: e instanceof Error ? e.message : "Unknown SMTP error" };
  }
}

export function passwordResetHtml(opts: {
  name: string;
  resetUrl: string;
  expiryMinutes: number;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 16px;color:#1a1a1a;">
  <h2 style="font-size:20px;margin-bottom:8px;">Reset your BusinessOps password</h2>
  <p style="color:#555;margin-bottom:24px;">Hi ${opts.name},</p>
  <p style="color:#555;">We received a request to reset your password. Click the button below — the link expires in <strong>${opts.expiryMinutes} minutes</strong>.</p>
  <a href="${opts.resetUrl}"
     style="display:inline-block;margin:24px 0;padding:12px 28px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
    Reset password
  </a>
  <p style="color:#888;font-size:12px;">If you didn't request this, ignore this email — your password won't change.</p>
  <p style="color:#888;font-size:12px;margin-top:24px;">Or paste this link into your browser:<br>
    <span style="word-break:break-all;">${opts.resetUrl}</span>
  </p>
</body>
</html>`;
}
