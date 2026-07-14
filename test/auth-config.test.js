const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('production refuses to seed a default administrator without ADMIN_PASSWORD', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibes-auth-config-'));
  try {
    const script = "require('./server/auth').initializationPromise.then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(23); })";
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', AUTH_DATA_DIR: dataDir, ADMIN_PASSWORD: '' },
      encoding: 'utf8'
    });
    assert.equal(result.status, 23);
    assert.match(result.stderr, /ADMIN_PASSWORD is required/);
    assert.equal(fs.existsSync(path.join(dataDir, 'users.json')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
