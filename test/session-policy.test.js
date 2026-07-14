const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isSessionValid } = require('../server/session-policy');

const now = 1_700_000_000_000;
const activeSession = { expiresAt: new Date(now + 60_000).toISOString() };

test('active legacy sessions remain valid when MFA is disabled', () => {
  assert.equal(isSessionValid(activeSession, { now, mfaRequired: false }), true);
});

test('MFA-required deployments reject sessions not created or upgraded after MFA verification', () => {
  assert.equal(isSessionValid(activeSession, { now, mfaRequired: true }), false);
  assert.equal(isSessionValid({ ...activeSession, mfaVerified: false }, { now, mfaRequired: true }), false);
  assert.equal(isSessionValid({ ...activeSession, mfaVerified: true }, { now, mfaRequired: true }), true);
});

test('expired or malformed sessions are always rejected', () => {
  assert.equal(isSessionValid({ expiresAt: new Date(now).toISOString(), mfaVerified: true }, { now, mfaRequired: true }), false);
  assert.equal(isSessionValid({ expiresAt: 'not-a-date', mfaVerified: true }, { now, mfaRequired: true }), false);
  assert.equal(isSessionValid(null, { now, mfaRequired: false }), false);
});

test('every HTTP, proxy, module, and Socket.io session boundary uses the shared MFA-aware policy', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const policyCalls = source.match(/isSessionValid\([^\n]+mfaRequired: MFA_REQUIRED/g) || [];
  assert.equal(policyCalls.length, 6);
  assert.doesNotMatch(source, /new Date\(auth\.sessions\[sessionId\]\.expiresAt\)/);
});
