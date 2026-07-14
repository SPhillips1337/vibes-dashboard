'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;
const MIN_OUTPUT_BYTES = 256;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const SHELL_SURFACE = /[;&|`$<>\n\r\0]/;
const WRITE_BITS = 0o022;

function artifactPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) throw new TypeError('artifact path is invalid');
  const normalized=path.posix.normalize(value.replaceAll('\\','/'));
  if (normalized==='.' || normalized==='..' || normalized.startsWith('../')) throw new TypeError('artifact traversal is invalid');
  return normalized;
}

async function executableIdentity(command, fsOps) {
  const stat=await fsOps.lstat(command);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('executable must be a nonsymlink regular file');
  if ((stat.mode & WRITE_BITS) !== 0) throw new TypeError('executable path is group/world writable');
  const real=await fsOps.realpath(command);
  const realStat=await fsOps.lstat(real);
  if (realStat.isSymbolicLink() || !realStat.isFile()) throw new TypeError('executable must be a nonsymlink regular file');
  if ((realStat.mode & WRITE_BITS) !== 0) throw new TypeError('executable path is group/world writable');
  return { path: real, dev: realStat.dev, ino: realStat.ino, mtimeMs: realStat.mtimeMs, ctimeMs: realStat.ctimeMs, size: realStat.size };
}

function containsPath(parent, child) {
  const relative=path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertPolicyPath(policyPath, { fsOps, trustedPolicyRoots = [], harnessWorkspaces = [] }) {
  if (typeof policyPath!=='string' || !path.isAbsolute(policyPath)) throw new TypeError('policy path is invalid');
  if (!Array.isArray(trustedPolicyRoots) || trustedPolicyRoots.length===0) throw new TypeError('trusted policy root is required');
  const stat=await fsOps.lstat(policyPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new TypeError('policy path must be a nonsymlink regular file');
  if ((stat.mode & WRITE_BITS) !== 0) throw new TypeError('policy path is group/world writable');
  const real=await fsOps.realpath(policyPath);
  const canonicalRoots=[];
  for (const root of trustedPolicyRoots) if (typeof root === 'string' && path.isAbsolute(root)) canonicalRoots.push(await fsOps.realpath(root));
  if (!canonicalRoots.length || !canonicalRoots.some(root => containsPath(root, real))) throw new TypeError('policy path is outside trusted roots');
  for (const workspace of harnessWorkspaces) {
    if (typeof workspace === 'string' && path.isAbsolute(workspace) && containsPath(await fsOps.realpath(workspace), real)) throw new TypeError('policy path is inside a harness workspace');
  }
  return real;
}

async function normalizePolicy(input = {}, fsOps = fs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('verification policy is invalid');
  const executableIdentities={};
  const executablePaths=[];
  for (const value of input.executablePaths || []) {
    if (typeof value!=='string' || !path.isAbsolute(value) || SHELL_SURFACE.test(value) || /\s/.test(value)) throw new TypeError('executable path is invalid');
    const identity=await executableIdentity(path.resolve(value), fsOps);
    executablePaths.push(identity.path);
    executableIdentities[identity.path]=Object.freeze(identity);
  }
  const recipes={};
  for (const [id,value] of Object.entries(input.recipes || {})) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || !value || typeof value!=='object' || Array.isArray(value)) throw new TypeError('recipe is invalid');
    const command=value.command;
    if (typeof command!=='string' || !path.isAbsolute(command) || SHELL_SURFACE.test(command) || /\s/.test(command)) throw new TypeError('recipe command is invalid');
    const identity=await executableIdentity(path.resolve(command), fsOps);
    if (!executablePaths.includes(identity.path)) throw new TypeError('recipe executable is not allowlisted');
    if (!Array.isArray(value.args) || value.args.some(arg=>typeof arg!=='string' || SHELL_SURFACE.test(arg))) throw new TypeError('recipe args contain an unsafe shell surface');
    const timeoutMs=value.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes=value.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>MAX_TIMEOUT_MS) throw new TypeError('timeout limit is invalid');
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes<MIN_OUTPUT_BYTES || maxOutputBytes>MAX_OUTPUT_BYTES) throw new TypeError('output limit is invalid');
    recipes[id]=Object.freeze({id,command:identity.path,executableIdentity:executableIdentities[identity.path],args:[...value.args],cwdPolicy:'run_workspace',timeoutMs,maxOutputBytes,artifacts:(value.artifacts||[]).map(artifactPath)});
  }
  return Object.freeze({recipes:Object.freeze(recipes),executablePaths:Object.freeze(executablePaths),executableIdentities:Object.freeze(executableIdentities)});
}

async function loadVerificationPolicy({ policy, policyPath, fsOps=fs, trustedPolicyRoots=[], harnessWorkspaces=[] } = {}) {
  if (policy !== undefined) return normalizePolicy(structuredClone(policy), fsOps);
  if (policyPath !== undefined) {
    const real=await assertPolicyPath(policyPath,{fsOps,trustedPolicyRoots,harnessWorkspaces});
    return normalizePolicy(JSON.parse(await fsOps.readFile(real,'utf8')), fsOps);
  }
  return normalizePolicy({}, fsOps);
}

function selectVerification(policy, run = {}) {
  const plan=run.plan && typeof run.plan === 'object' && !Array.isArray(run.plan) ? run.plan : null;
  if (plan && !Array.isArray(plan.tasks)) return {recipeIds:[],recipes:[],artifacts:[],noChecksConfigured:true};
  const requested=Array.isArray(plan?.verificationChecks) ? plan.verificationChecks : (Array.isArray(run.requestedChecks) ? run.requestedChecks : []);
  const recipeIds=[...new Set(requested)].filter(id=>Object.hasOwn(policy.recipes,id));
  const recipes=recipeIds.map(id=>policy.recipes[id]);
  const artifacts=[...new Set([
    ...(Array.isArray(plan?.declaredArtifacts)?plan.declaredArtifacts:(Array.isArray(run.declaredArtifacts)?run.declaredArtifacts:[])),
    ...recipes.flatMap(recipe=>recipe.artifacts)
  ].map(value=>typeof value==='string'?value:value?.path).filter(Boolean).map(artifactPath))];
  return {recipeIds,recipes,artifacts,noChecksConfigured:recipes.length===0&&artifacts.length===0};
}

module.exports={loadVerificationPolicy,selectVerification,normalizePolicy,artifactPath,DEFAULT_TIMEOUT_MS,DEFAULT_MAX_OUTPUT_BYTES};
