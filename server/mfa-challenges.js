const crypto = require('node:crypto');
const {
  createOtpAuthUri,
  decryptSecret,
  encryptSecret,
  generateSecret,
  verifyTotp
} = require('./mfa');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 1000;

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(value) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex');
}

function recoveryCode() {
  const compact = crypto.randomBytes(8).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(10, 'X').slice(0, 10);
  return `${compact.slice(0, 5)}-${compact.slice(5)}`;
}

function equalHash(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function createMfaChallengeService(options = {}) {
  const required = options.required === true;
  const encryptionKey = options.encryptionKey;
  const issuer = options.issuer || 'Vibes Dashboard';
  const clock = options.clock || Date.now;
  const saveUser = options.saveUser || (() => {});
  const challenges = new Map();

  if (required && (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32)) {
    throw new Error('MFA requires a valid 32-byte encryption key');
  }

  function prune() {
    const now = clock();
    for (const [id, challenge] of challenges) {
      if (challenge.expiresAt <= now) challenges.delete(id);
    }
    while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
  }

  function begin(user) {
    if (!required) return { mfaRequired: false };
    prune();
    const enrollmentRequired = !user.mfa?.secretEncrypted;
    const secret = enrollmentRequired ? generateSecret() : null;
    const challengeId = crypto.randomBytes(32).toString('base64url');
    challenges.set(challengeId, {
      userId: user.id,
      secret,
      enrollmentRequired,
      expiresAt: clock() + CHALLENGE_TTL_MS
    });
    return {
      mfaRequired: true,
      challengeId,
      enrollmentRequired,
      ...(enrollmentRequired ? {
        secret,
        otpauthUri: createOtpAuthUri({ secret, issuer, account: user.username })
      } : {})
    };
  }

  function verify(user, challengeId, token) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || challenge.userId !== user.id || challenge.expiresAt <= clock()) {
      if (challenge?.expiresAt <= clock()) challenges.delete(String(challengeId || ''));
      return { ok: false };
    }

    let secret;
    try {
      secret = challenge.enrollmentRequired
        ? challenge.secret
        : decryptSecret(user.mfa.secretEncrypted, encryptionKey);
    } catch {
      return { ok: false };
    }

    if (verifyTotp(token, secret, { time: clock(), window: 1 })) {
      challenges.delete(challengeId);
      if (!challenge.enrollmentRequired) return { ok: true, enrolled: false };

      const recoveryCodes = Array.from({ length: 8 }, recoveryCode);
      user.mfa = {
        secretEncrypted: encryptSecret(secret, encryptionKey),
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        enabledAt: new Date(clock()).toISOString()
      };
      saveUser(user);
      return { ok: true, enrolled: true, recoveryCodes };
    }

    if (!challenge.enrollmentRequired && user.mfa?.recoveryCodeHashes?.length) {
      const suppliedHash = hashRecoveryCode(token);
      const index = user.mfa.recoveryCodeHashes.findIndex(hash => equalHash(hash, suppliedHash));
      if (index !== -1) {
        challenges.delete(challengeId);
        user.mfa.recoveryCodeHashes.splice(index, 1);
        saveUser(user);
        return { ok: true, enrolled: false, recoveryCodeUsed: true };
      }
    }

    return { ok: false };
  }

  function reset(user) {
    for (const [id, challenge] of challenges) {
      if (challenge.userId === user.id) challenges.delete(id);
    }
    delete user.mfa;
    saveUser(user);
  }

  return { required, begin, verify, reset };
}

module.exports = { createMfaChallengeService, hashRecoveryCode, normalizeRecoveryCode };
