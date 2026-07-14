'use strict';

const fs = require('node:fs');
const os = require('node:os');

function isDirectory(candidate, statSync) {
  if (typeof candidate !== 'string' || !candidate.trim()) return false;
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function resolveWorkingDirectory(requestedCwd, options = {}) {
  const statSync = options.statSync || fs.statSync;
  const requested = typeof requestedCwd === 'string' ? requestedCwd.trim() : '';
  const candidates = [requested, options.defaultCwd || process.cwd(), options.homeDir || os.homedir(), '/'];
  const cwd = candidates.find(candidate => isDirectory(candidate, statSync));

  if (!cwd) {
    throw new Error('No usable terminal working directory is available');
  }

  return { cwd, recovered: cwd !== requested };
}

function bindTerminalProcess(child, handlers) {
  let settled = false;
  const finish = code => {
    if (settled) return;
    settled = true;
    handlers.onExit(code);
  };

  child.stdout.on('data', handlers.onStdout);
  child.stderr.on('data', handlers.onStderr);
  child.on('error', error => {
    handlers.onError(error);
    finish(1);
  });
  child.on('close', code => finish(code));
}

module.exports = { resolveWorkingDirectory, bindTerminalProcess };
