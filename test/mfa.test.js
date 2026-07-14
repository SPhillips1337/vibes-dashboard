const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  decodeBase32,
  encodeBase32,
  generateSecret,
  generateTotp,
  verifyTotp,
  createOtpAuthUri,
  encryptSecret,
  decryptSecret,
  parseEncryptionKey
} = require('../server/mfa');

test('base32 encoding round-trips arbitrary secret bytes', () => {
  const bytes = Buffer.from('12345678901234567890', 'ascii');
  assert.deepEqual(decodeBase32(encodeBase32(bytes)), bytes);
});

test('TOTP matches the RFC 6238 SHA-1 test vector', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));
  assert.equal(generateTotp(secret, { time: 59_000, digits: 8 }), '94287082');
});

test('TOTP verification accepts one adjacent time step and rejects malformed or distant values', () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const previous = generateTotp(secret, { time: now - 30_000 });
  assert.equal(verifyTotp(previous, secret, { time: now, window: 1 }), true);
  assert.equal(verifyTotp(previous, secret, { time: now + 90_000, window: 1 }), false);
  assert.equal(verifyTotp('12ab56', secret, { time: now }), false);
  assert.equal(verifyTotp('12345', secret, { time: now }), false);
});

test('otpauth URI is Google Authenticator compatible and safely encoded', () => {
  const uri = createOtpAuthUri({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'Vibes Dashboard', account: 'admin@example.com' });
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, 'otpauth:');
  assert.equal(parsed.hostname, 'totp');
  assert.equal(decodeURIComponent(parsed.pathname), '/Vibes Dashboard:admin@example.com');
  assert.equal(parsed.searchParams.get('secret'), 'JBSWY3DPEHPK3PXP');
  assert.equal(parsed.searchParams.get('issuer'), 'Vibes Dashboard');
  assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
  assert.equal(parsed.searchParams.get('digits'), '6');
  assert.equal(parsed.searchParams.get('period'), '30');
});

test('AES-GCM encrypted secrets round-trip and reject the wrong key or tampering', () => {
  const key = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', key);
  assert.notEqual(encrypted.includes('JBSWY3DPEHPK3PXP'), true);
  assert.equal(decryptSecret(encrypted, key), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decryptSecret(encrypted, wrongKey));

  const parts = encrypted.split('.');
  parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
  const tampered = parts.join('.');
  assert.throws(() => decryptSecret(tampered, key));
});

test('encryption keys must be base64-encoded 32-byte values', () => {
  const raw = crypto.randomBytes(32);
  assert.deepEqual(parseEncryptionKey(raw.toString('base64')), raw);
  assert.throws(() => parseEncryptionKey('short'), /32-byte/);
  assert.throws(() => parseEncryptionKey(''), /required/);
});
