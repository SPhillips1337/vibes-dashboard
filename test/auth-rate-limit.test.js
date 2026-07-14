const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('five failed authentication factors lock the source IP and success clears the lock', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibes-rate-limit-'));
  try {
    const script = `
      const auth = require('./server/auth');
      auth.initializationPromise.then(() => {
        const ip = '198.51.100.73';
        for (let attempt = 0; attempt < 4; attempt += 1) auth.recordLoginAttempt(ip, false);
        if (auth.isRateLimited(ip)) process.exit(21);
        auth.recordLoginAttempt(ip, false);
        if (!auth.isRateLimited(ip)) process.exit(22);
        auth.recordLoginAttempt(ip, true);
        if (auth.isRateLimited(ip)) process.exit(23);
        process.exit(0);
      }).catch(() => process.exit(24));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', AUTH_DATA_DIR: dataDir, ADMIN_PASSWORD: 'fixture-password-only' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the MFA rejection branch records a failed attempt before returning', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.match(source, /const mfaResult = mfaService\.verify[\s\S]*?if \(!mfaResult\.ok\) \{[\s\S]*?auth\.recordLoginAttempt\(ip, false\);[\s\S]*?return res\.status\(401\)/);
});
