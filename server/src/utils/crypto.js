// Field-level encryption (AES-256-GCM) for data that must stay unreadable even if the
// database or a backup leaks: clinical notes, insurance numbers, MFA secrets, messages.
// GCM is authenticated: tampered ciphertext fails to decrypt instead of returning garbage.
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1'; // lets us rotate keys later (v2 = new key) without a big-bang migration

const key = () => {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
};

export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12); // unique per message — never reuse an IV with GCM
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const [version, data] = payload.split(':');
  if (version !== VERSION) throw new Error(`Unsupported cipher version ${version}`);
  const buf = Buffer.from(data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
