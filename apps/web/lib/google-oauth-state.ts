import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "recepto_google_oauth_state";

interface StatePayload {
  nonce: string;
  userId: string;
  tenantId: string;
  expiresAt: number;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createGoogleOAuthState(
  userId: string,
  tenantId: string,
  secret: string
): { state: string; cookieValue: string } {
  const payload: StatePayload = {
    nonce: randomBytes(24).toString("base64url"),
    userId,
    tenantId,
    expiresAt: Date.now() + 10 * 60 * 1_000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    state: payload.nonce,
    cookieValue: encoded + "." + signature(encoded, secret)
  };
}

export function verifyGoogleOAuthState(
  state: string,
  cookieValue: string,
  secret: string
): StatePayload | null {
  const [encoded, suppliedSignature] = cookieValue.split(".");
  if (!encoded || !suppliedSignature) return null;

  const expected = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    supplied.length !== expectedBuffer.length ||
    !timingSafeEqual(supplied, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as StatePayload;
    if (
      payload.nonce !== state ||
      payload.expiresAt < Date.now() ||
      !payload.userId ||
      !payload.tenantId
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
