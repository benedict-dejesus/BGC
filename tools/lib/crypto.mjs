// Must stay in step with docs/assets/app.js, which does the same work in the browser.
import { argon2, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 48;

/**
 * One slow, memory-heavy Argon2id derivation gives the AES key and the record's file name.
 * kdf: { memoryKiB, passes }. The browser uses the same settings from data/manifest.json.
 */
export async function deriveRecordKeys(number, saltBase64, kdf) {
  const bits = await derive('argon2id', {
    message: Buffer.from(number, 'utf8'),
    nonce: Buffer.from(saltBase64, 'base64'),
    parallelism: 1,
    tagLength: KEY_BYTES,
    memory: kdf.memoryKiB,
    passes: kdf.passes,
  });
  return { key: bits.subarray(0, 32), id: bits.subarray(32, KEY_BYTES).toString('hex') };
}

export function encryptRecord(payload, key, id) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function decryptRecord(file, key, id) {
  const iv = file.subarray(0, IV_BYTES);
  const body = file.subarray(IV_BYTES, file.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(id, 'utf8'));
  decipher.setAuthTag(file.subarray(file.length - TAG_BYTES));
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}
