'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const UNSAFE_ARG = /[;&|`$<>\n\r\0]/;
const SECRET_OUTPUT = /\b(?:access_token|auth_token|token|authorization|api[_-]?key|password|secret)=([^\s]+)/gi;
const DEFAULT_PATH = '/usr/bin:/bin';

function boundedAppend(state, field, chunk, limit) {
  const available = Math.max(0, limit - state.bytes);
  const buffer = Buffer.from(chunk);
  if (buffer.length > available) state.truncated = true;
  if (available) state[field] = Buffer.concat([state[field], buffer.subarray(0, available)]);
  state.bytes += Math.min(buffer.length, available);
}

function decodeUtf8(buffer) {
  return buffer.toString('utf8').replace(/\uFFFD+$/u, '').replace(SECRET_OUTPUT, match => `${match.split('=')[0]}=[REDACTED]`);
}

async function makeIsolatedDirs(fsOps) {
  const root=await fsOps.mkdtemp(path.join(os.tmpdir(), 'vibes-harness-check-'));
  await fsOps.chmod(root,0o700).catch(()=>{});
  const dirs={root,home:path.join(root,'home'),config:path.join(root,'config'),cache:path.join(root,'cache'),tmp:path.join(root,'tmp')};
  await Promise.all([dirs.home,dirs.config,dirs.cache,dirs.tmp].map(dir=>fsOps.mkdir(dir,{mode:0o700})));
  return dirs;
}

async function revalidateExecutable(recipe, fsOps) {
  if (!recipe.executableIdentity) return;
  const stat=await fsOps.lstat(recipe.command);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('verification executable changed');
  if ((stat.mode & 0o022) !== 0) throw new TypeError('verification executable is group/world writable');
  const current={dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,size:stat.size};
  for (const key of ['dev','ino','mtimeMs','ctimeMs','size']) if (current[key] !== recipe.executableIdentity[key]) throw new TypeError('verification executable identity changed');
}

async function runCheck(recipe, workspace, options) {
  if (!recipe || typeof recipe.command !== 'string' || !path.isAbsolute(recipe.command) || !Array.isArray(recipe.args) || recipe.args.some(arg => typeof arg !== 'string' || UNSAFE_ARG.test(arg))) {
    throw new TypeError('unsafe verification recipe');
  }
  const dirs=await makeIsolatedDirs(options.fsOps);
  try { await revalidateExecutable(recipe, options.fsOps); }
  catch (error) { await options.fsOps.rm(dirs.root,{recursive:true,force:true}).catch(()=>{}); throw error; }
  const startedAt = options.clock().toISOString();
  const state = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), bytes: 0, truncated: false };
  return new Promise(resolve => {
    let child;
    let settled = false;
    let timedOut = false;
    let graceTimer;
    const finish = (exitCode, signal, spawnError) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) options.clearTimer(timer);
      if (graceTimer !== undefined) options.clearTimer(graceTimer);
      options.fsOps.rm(dirs.root,{recursive:true,force:true}).catch(()=>{});
      resolve({ id: recipe.id, command: recipe.command, args: [...recipe.args], cwd: workspace, startedAt, finishedAt: options.clock().toISOString(), exitCode, signal: signal || null, timedOut, truncated: state.truncated, stdout: decodeUtf8(state.stdout), stderr: decodeUtf8(state.stderr), spawnError: spawnError || null, passed: !spawnError && !timedOut && exitCode === 0 && !signal });
    };
    let timer;
    try {
      const env = { HOME: dirs.home, XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, TMPDIR: dirs.tmp, LANG: process.env.LANG || 'C.UTF-8', PATH: DEFAULT_PATH };
      child = options.spawnImpl(recipe.command, recipe.args, { cwd: workspace, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', chunk => boundedAppend(state, 'stdout', chunk, recipe.maxOutputBytes));
      child.stderr?.on('data', chunk => boundedAppend(state, 'stderr', chunk, recipe.maxOutputBytes));
      child.on('error', error => finish(null, null, error.message));
      child.on('close', (code, signal) => finish(code, signal, null));
      timer = options.setTimer(() => {
        timedOut = true;
        try {
          if (options.platform !== 'win32' && child.pid) options.killImpl(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {}
        graceTimer = options.setTimer(() => finish(null, 'SIGKILL', null), options.graceTimeoutMs);
      }, recipe.timeoutMs);
    } catch (error) {
      finish(null, null, error.message);
    }
  });
}

async function validateArtifact(workspace, artifact, fsOps) {
  const workspaceReal=await fsOps.realpath(path.resolve(workspace));
  const target = path.resolve(workspaceReal, artifact);
  const root = `${workspaceReal}${path.sep}`;
  if (!target.startsWith(root)) return { path: artifact, valid: false, reason: 'outside_workspace' };
  let handle; let rootHandle;
  try {
    rootHandle=await fsOps.open(workspaceReal,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    const components=artifact.split('/').filter(Boolean); let cursor=workspaceReal; const parents=[];
    for(const component of components.slice(0,-1)) {
      cursor=path.join(cursor,component); const stat=await fsOps.lstat(cursor);
      if(stat.isSymbolicLink()||!stat.isDirectory()) return {path:artifact,valid:false,reason:'parent_containment_changed'};
      const real=await fsOps.realpath(cursor); if(!real.startsWith(root)) return {path:artifact,valid:false,reason:'outside_workspace'};
      parents.push({path:cursor,real,dev:stat.dev,ino:stat.ino});
    }
    const stat = await fsOps.lstat(target);
    if (stat.isSymbolicLink()) return { path: artifact, valid: false, reason: 'symbolic_link' };
    if (!stat.isFile()) return { path: artifact, valid: false, reason: 'not_regular_file' };
    const real = await fsOps.realpath(target);
    if (!real.startsWith(root)) return { path: artifact, valid: false, reason: 'outside_workspace' };
    handle = await fsOps.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const handleStat=await handle.stat();
    const after=await fsOps.lstat(target); const afterReal=await fsOps.realpath(target);
    if(handleStat.dev!==stat.dev||handleStat.ino!==stat.ino||after.dev!==handleStat.dev||after.ino!==handleStat.ino||afterReal!==real) return {path:artifact,valid:false,reason:'artifact_changed_during_validation'};
    for(const parent of parents){const current=await fsOps.lstat(parent.path);if(current.dev!==parent.dev||current.ino!==parent.ino||await fsOps.realpath(parent.path)!==parent.real)return {path:artifact,valid:false,reason:'parent_containment_changed'};}
    if (!handleStat.isFile()) return { path: artifact, valid: false, reason: 'not_regular_file' };
    const hash=crypto.createHash('sha256'); hash.update(await handle.readFile());
    return { path: artifact, valid: true, reason: null, dev: handleStat.dev, ino: handleStat.ino, size: handleStat.size, mtimeMs: handleStat.mtimeMs, sha256: hash.digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: artifact, valid: false, reason: 'missing' };
    return { path: artifact, valid: false, reason: error.code || 'containment_race' };
  } finally { if (handle) await handle.close().catch(()=>{}); if(rootHandle)await rootHandle.close().catch(()=>{}); }
}

function createVerifier({ spawnImpl = spawn, fsOps = fs, clock = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, platform = process.platform, killImpl = process.kill, graceTimeoutMs = 1000 } = {}) {
  return { async verify({ workspace, selection } = {}) {
    if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || !selection || !Array.isArray(selection.recipes) || !Array.isArray(selection.artifacts)) throw new TypeError('verification input is invalid');
    if (selection.noChecksConfigured) return { passed: false, cause: 'no_checks_configured', checks: [], artifacts: [] };
    const checks = [];
    for (const recipe of selection.recipes) checks.push(await runCheck(recipe, workspace, { spawnImpl, fsOps, clock, setTimer, clearTimer, platform, killImpl, graceTimeoutMs }));
    const artifacts = [];
    for (const artifact of selection.artifacts) artifacts.push(await validateArtifact(workspace, artifact, fsOps));
    return { passed: checks.every(check => check.passed) && artifacts.every(artifact => artifact.valid), cause: null, checks, artifacts };
  } };
}

module.exports = { createVerifier };
