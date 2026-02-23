import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(secret: string): Buffer {
  if (!secret) {
    throw new Error("APP_ENCRYPTION_KEY is required");
  }
  let key: Buffer;
  if (secret.length >= 64 && /^[0-9a-fA-F]+$/.test(secret)) {
    key = Buffer.from(secret.slice(0, 64), "hex");
  } else {
    key = Buffer.from(secret, "utf8").subarray(0, KEY_LENGTH);
  }
  if (key.length < KEY_LENGTH) {
    throw new Error("APP_ENCRYPTION_KEY must be at least 32 bytes (or 64 hex characters)");
  }
  return key;
}

export function encrypt(plaintext: string, secret: string): string {
  const key = getKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(ciphertext: string, secret: string): string {
  const key = getKey(secret);
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final("utf8");
}
