import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
const { encrypt, decrypt } = await import('../src/utils/crypto.js');

test('round-trips and uses a fresh IV each time', () => {
  const a = encrypt('BP 150/95, start losartan');
  const b = encrypt('BP 150/95, start losartan');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'BP 150/95, start losartan');
});

test('tampered ciphertext is rejected', () => {
  const enc = encrypt('secret');
  const buf = Buffer.from(enc.slice(3), 'base64');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => decrypt(`v1:${buf.toString('base64')}`));
});
