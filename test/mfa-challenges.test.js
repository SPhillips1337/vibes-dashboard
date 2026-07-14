const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createMfaChallengeService } = require('../server/mfa-challenges');
const { generateTotp, parseEncryptionKey } = require('../server/mfa');

const KEY = parseEncryptionKey(crypto.randomBytes(32).toString('base64'));

function fixture(options = {}) {
  let now = 1_700_000_000_000;
  const saved = [];
  const service = createMfaChallengeService({
    required: true,
    encryptionKey: KEY,
    issuer: 'Vibes Dashboard',
    clock: () => now,
    saveUser: user => saved.push(structuredClone(user)),
    ...options
  });
  const user = { id: 'u_1', username: 'admin', role: 'admin' };
  return { service, user, saved, setNow: value => { now = value; }, getNow: () => now };
}

test('first login begins enrollment without authenticating and only verification enables MFA', () => {
  const { service, user, saved, getNow } = fixture();
  const challenge = service.begin(user);
  assert.equal(challenge.mfaRequired, true);
  assert.equal(challenge.enrollmentRequired, true);
  assert.match(challenge.secret, /^[A-Z2-7]+$/);
  assert.match(challenge.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal(user.mfa, undefined);

  const result = service.verify(user, challenge.challengeId, generateTotp(challenge.secret, { time: getNow() }));
  assert.equal(result.ok, true);
  assert.equal(result.enrolled, true);
  assert.equal(result.recoveryCodes.length, 8);
  assert.equal(saved.length, 1);
  assert.equal(typeof user.mfa.secretEncrypted, 'string');
  assert.equal(user.mfa.secretEncrypted.includes(challenge.secret), false);
  assert.equal(Object.hasOwn(user.mfa, 'recoveryCodes'), false);
});

test('enrolled users receive no secret and must supply a valid TOTP', () => {
  const { service, user, getNow } = fixture();
  const enrollment = service.begin(user);
  service.verify(user, enrollment.challengeId, generateTotp(enrollment.secret, { time: getNow() }));

  const challenge = service.begin(user);
  assert.equal(challenge.enrollmentRequired, false);
  assert.equal(challenge.secret, undefined);
  assert.equal(service.verify(user, challenge.challengeId, '000000').ok, false);
  assert.equal(service.verify(user, challenge.challengeId, generateTotp(enrollment.secret, { time: getNow() })).ok, true);
  assert.equal(service.verify(user, challenge.challengeId, generateTotp(enrollment.secret, { time: getNow() })).ok, false);
});

test('challenges are bound to one user and expire after five minutes', () => {
  const { service, user, setNow, getNow } = fixture();
  const challenge = service.begin(user);
  const token = generateTotp(challenge.secret, { time: getNow() });
  assert.equal(service.verify({ ...user, id: 'u_2' }, challenge.challengeId, token).ok, false);
  setNow(getNow() + 5 * 60 * 1000 + 1);
  assert.equal(service.verify(user, challenge.challengeId, token).ok, false);
});

test('a recovery code works once and is removed from persistent state', () => {
  const { service, user, getNow, saved } = fixture();
  const enrollment = service.begin(user);
  const enrolled = service.verify(user, enrollment.challengeId, generateTotp(enrollment.secret, { time: getNow() }));
  const recoveryCode = enrolled.recoveryCodes[0];
  const originalCount = user.mfa.recoveryCodeHashes.length;

  const challenge = service.begin(user);
  assert.equal(service.verify(user, challenge.challengeId, recoveryCode).ok, true);
  assert.equal(user.mfa.recoveryCodeHashes.length, originalCount - 1);
  assert.equal(saved.length, 2);

  const replay = service.begin(user);
  assert.equal(service.verify(user, replay.challengeId, recoveryCode).ok, false);
});

test('reset removes enrollment and disabled service does not create challenges', () => {
  const { service, user, getNow } = fixture();
  const enrollment = service.begin(user);
  service.verify(user, enrollment.challengeId, generateTotp(enrollment.secret, { time: getNow() }));
  service.reset(user);
  assert.equal(user.mfa, undefined);
  assert.equal(service.begin(user).enrollmentRequired, true);

  const disabled = createMfaChallengeService({ required: false });
  assert.deepEqual(disabled.begin(user), { mfaRequired: false });
});
