'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('stale client cwd recovers to the running server project directory', () => {
  const { resolveWorkingDirectory } = require('../server/terminal-exec');
  const fallback = fs.mkdtempSync(path.join(os.tmpdir(), 'vibes-terminal-cwd-'));
  try {
    const result = resolveWorkingDirectory('/missing/old-checkout', { defaultCwd: fallback });
    assert.deepEqual(result, { cwd: fallback, recovered: true });

    const current = resolveWorkingDirectory(fallback, { defaultCwd: root });
    assert.deepEqual(current, { cwd: fallback, recovered: false });
  } finally {
    fs.rmSync(fallback, { recursive: true, force: true });
  }
});

test('spawn error followed by close reports one terminal exit', () => {
  const { bindTerminalProcess } = require('../server/terminal-exec');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const events = [];

  bindTerminalProcess(child, {
    onStdout: data => events.push(['stdout', data.toString()]),
    onStderr: data => events.push(['stderr', data.toString()]),
    onError: error => events.push(['error', error.message]),
    onExit: code => events.push(['exit', code])
  });

  child.emit('error', new Error('spawn /bin/sh ENOENT'));
  child.emit('close', -2);
  assert.deepEqual(events, [
    ['error', 'spawn /bin/sh ENOENT'],
    ['exit', 1]
  ]);
});

test('terminal UI requests an authoritative cwd and has no checkout-specific path', () => {
  const client = read('modules/terminal/script.js');
  const server = read('server/index.js');

  assert.doesNotMatch(client, /glass-vibes-dashboard/);
  assert.match(client, /terminal-cwd-request/);
  assert.match(server, /socket\.on\('terminal-cwd-request'/);
  assert.match(server, /resolveWorkingDirectory\(cwd/);
  assert.match(server, /bindTerminalProcess\(child/);
});
