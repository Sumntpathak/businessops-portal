import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function deriveKey(sessionSecret: string, purpose: string): Buffer {
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  return createHash("sha256")
    .update("recepto:" + purpose + ":")
    .update(sessionSecret)
    .digest();
}

/** Encrypts a secret at rest. `purpose` domain-separates keys derived from the same SESSION_SECRET. */
export function encryptSecret(
  plaintext: string,
  sessionSecret: string,
  purpose: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(sessionSecret, purpose), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptSecret(
  payload: string,
  sessionSecret: string,
  purpose: string
): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");

  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("Invalid encrypted secret");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(sessionSecret, purpose),
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function encryptRefreshToken(refreshToken: string, sessionSecret: string): string {
  return encryptSecret(refreshToken, sessionSecret, "google-refresh-token");
}

export function decryptRefreshToken(payload: string, sessionSecret: string): string {
  return decryptSecret(payload, sessionSecret, "google-refresh-token");
}

export function encryptTwilioAuthToken(authToken: string, sessionSecret: string): string {
  return encryptSecret(authToken, sessionSecret, "twilio-auth-token");
}

export function decryptTwilioAuthToken(payload: string, sessionSecret: string): string {
  return decryptSecret(payload, sessionSecret, "twilio-auth-token");
}
