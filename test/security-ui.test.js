const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('login shell exposes an accessible second-factor field and enrollment presentation', () => {
  const html = read('public/index.html');
  assert.match(html, /id="login-mfa-code"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /id="mfa-enrollment"/);
  assert.match(html, /id="mfa-qr-code"/);
  assert.match(html, /id="mfa-recovery-codes"/);
});

test('login client performs the MFA challenge without persisting MFA secrets', () => {
  const script = read('public/js/app.js');
  assert.match(script, /mfaChallengeId/);
  assert.match(script, /mfaCode/);
  assert.match(script, /enrollmentRequired/);
  assert.match(script, /recoveryCodes/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^\n]*(?:mfa|totp|recovery)/i);
});

test('user access settings render MFA state and provide a protected reset action', () => {
  const script = read('modules/settings/script.js');
  assert.match(script, /mfaEnabled/);
  assert.match(script, /\/mfa/);
  assert.match(script, /Set up two-factor authentication/);
  assert.match(script, /\/api\/auth\/mfa\/setup/);
  assert.match(script, /\/api\/auth\/mfa\/enable/);
  assert.match(script, /mfa-admin-qr-code/);
  assert.match(script, /Reset two-factor authentication/);
  assert.match(script, /X-CSRF-Token/);
});
