const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(value) {
  const input = Buffer.from(value);
  let bits = 0;
  let bitCount = 0;
  let output = '';
  for (const byte of input) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) output += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
  return output;
}

function decodeBase32(value) {
  const normalized = String(value || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('Invalid base32 secret');
  let bits = 0;
  let bitCount = 0;
  const output = [];
  for (const character of normalized) {
    bits = (bits << 5) | BASE32_ALPHABET.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      output.push((bits >>> (bitCount - 8)) & 255);
      bitCount -= 8;
    }
  }
  return Buffer.from(output);
}

function generateSecret(bytes = 20) {
  return encodeBase32(crypto.randomBytes(bytes));
}

function generateTotp(secret, options = {}) {
  const time = options.time ?? Date.now();
  const period = options.period ?? 30;
  const digits = options.digits ?? 6;
  const counter = BigInt(Math.floor(time / 1000 / period));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

function verifyTotp(token, secret, options = {}) {
  const digits = options.digits ?? 6;
  const normalized = String(token || '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return false;
  const window = options.window ?? 1;
  const period = options.period ?? 30;
  const time = options.time ?? Date.now();
  const supplied = Buffer.from(normalized);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(generateTotp(secret, { ...options, time: time + offset * period * 1000 }));
    if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

function createOtpAuthUri({ secret, issuer, account }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query.toString()}`;
}

function parseEncryptionKey(value) {
  if (!value) throw new Error('MFA_ENCRYPTION_KEY is required');
  const key = Buffer.from(String(value), 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== String(value).replace(/=+$/, '')) {
    throw new Error('MFA_ENCRYPTION_KEY must be a base64-encoded 32-byte value');
  }
  return key;
}

function encryptSecret(secret, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte encryption key is required');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte encryption key is required');
  const [version, ivValue, tagValue, ciphertextValue, extra] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) throw new Error('Invalid encrypted MFA secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = {
  encodeBase32,
  decodeBase32,
  generateSecret,
  generateTotp,
  verifyTotp,
  createOtpAuthUri,
  parseEncryptionKey,
  encryptSecret,
  decryptSecret
};
