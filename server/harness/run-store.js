'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { validateEvent, readStoredEvent } = require('./event-contract');

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTABLE_DOCUMENTS = new Set(['plan.json', 'verification.json', 'artifacts/manifest.json', 'checkpoints/manifest.json']);

class RunStore {
  constructor({ root, fsOps = fs }) {
    if (!root) throw new TypeError('root is required');
    this.root = path.resolve(root);
    this.fs = fsOps;
    this.queues = new Map();
  }

  runPath(runId) {
    if (!RUN_ID.test(runId || '')) throw new TypeError('invalid run id');
    const target = path.resolve(this.root, runId);
    if (path.dirname(target) !== this.root) throw new TypeError('run id escapes root');
    return target;
  }

  async createRun(metadata) {
    const normalized = this.normalizeMetadata(metadata);
    const dir = this.runPath(normalized.id);
    await this.fs.mkdir(this.root, { recursive: true });
    await this.secureRoot();
    await this.fs.mkdir(dir);
    try {
      await this.secureRun(normalized.id);
      await this.atomicWrite(path.join(dir, 'run.json'), normalized);
      await this.fs.writeFile(path.join(dir, 'events.jsonl'), '', { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 });
    } catch (error) {
      await this.fs.rm(dir, { recursive: true, force: true });
      throw error;
    }
    return normalized;
  }

  async getRun(runId) {
    const dir = await this.secureRun(runId);
    const handle = await this.fs.open(path.join(dir, 'run.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return this.normalizeMetadata(JSON.parse(await handle.readFile('utf8')), runId); }
    finally { await handle.close(); }
  }

  async writeDocument(runId, name, value) {
    if (!MUTABLE_DOCUMENTS.has(name)) throw new TypeError('document name is not allowlisted');
    const runDir = await this.secureRun(runId);
    const file = path.resolve(runDir, name);
    if (!file.startsWith(`${runDir}${path.sep}`)) throw new TypeError('document name escapes run directory');
    await this.secureDirectory(path.dirname(file), runDir);
    await this.atomicWrite(file, value);
    return value;
  }

  async atomicWrite(file, value) {
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      await this.fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode: 0o600 });
      await this.fs.rename(temporary, file);
    } catch (error) {
      await this.fs.rm(temporary, { force: true });
      throw error;
    }
  }

  appendEvent(runId, event) {
    return this.appendEvents(runId, [event]);
  }

  appendEvents(runId, events) {
    if (!Array.isArray(events) || events.length === 0) return Promise.reject(new TypeError('events must be a non-empty array'));
    try {
      for (const event of events) {
        if (!event || event.runId !== runId) throw new TypeError('event run id mismatch');
        validateEvent(event);
      }
    } catch (error) { return Promise.reject(error); }
    const payload = events.map(event => `${JSON.stringify(event)}\n`).join('');
    const previous = this.queues.get(runId) || Promise.resolve();
    const operation = previous.then(async () => {
      const dir = await this.secureRun(runId);
      await this.fs.appendFile(path.join(dir, 'events.jsonl'), payload, { flag: constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW, mode: 0o600 });
    });
    const tail = operation.catch(() => {});
    this.queues.set(runId, tail);
    tail.finally(() => { if (this.queues.get(runId) === tail) this.queues.delete(runId); });
    return operation;
  }

  async readEvents(runId) {
    const dir = await this.secureRun(runId);
    const handle = await this.fs.open(path.join(dir, 'events.jsonl'), constants.O_RDONLY | constants.O_NOFOLLOW);
    let text;
    try { text = await handle.readFile('utf8'); } finally { await handle.close(); }
    const lines = text.split('\n');
    const events = []; const warnings = [];
    const lastContent = lines.reduce((last, line, index) => line ? index : last, -1);
    for (let index = 0; index <= lastContent; index++) {
      if (!lines[index]) continue;
      try { events.push(readStoredEvent(JSON.parse(lines[index]))); }
      catch (error) {
        if (index === lastContent && !text.endsWith('\n')) { warnings.push(`truncated final JSONL record ignored: ${error.message}`); break; }
        throw error;
      }
    }
    return { events, warnings };
  }

  async listRuns() {
    try {
      await this.secureRoot();
      const entries = await this.fs.readdir(this.root, { withFileTypes: true });
      const ids = entries.filter(entry => entry.isDirectory() && RUN_ID.test(entry.name)).map(entry => entry.name);
      const runs = await Promise.all(ids.map(id => this.getRun(id)));
      return runs.sort((left, right) => {
        const byCreatedAt = (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0);
        return byCreatedAt || String(left.id).localeCompare(String(right.id));
      });
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  normalizeMetadata(metadata, expectedId) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !RUN_ID.test(metadata.id || '') || (expectedId && metadata.id !== expectedId)) throw new TypeError('run id metadata is invalid');
    const normalized = { ...metadata };
    if (typeof metadata.createdAt !== 'string' || !Number.isFinite(Date.parse(metadata.createdAt))) throw new TypeError('run metadata createdAt is invalid');
    normalized.createdAt = new Date(Date.parse(metadata.createdAt)).toISOString();
    return normalized;
  }

  async secureRoot() {
    const stat = await this.fs.lstat(this.root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('run root symbolic link or containment violation');
    const real = await this.fs.realpath(this.root);
    if (real !== this.root) throw new TypeError('run root containment violation');
    return real;
  }

  async secureRun(runId) {
    const root = await this.secureRoot();
    const dir = this.runPath(runId);
    const stat = await this.fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('run directory symbolic link rejected');
    const real = await this.fs.realpath(dir);
    if (path.dirname(real) !== root) throw new TypeError('run directory containment violation');
    return dir;
  }

  async secureDirectory(directory, runDir) {
    if (directory === runDir) return directory;
    try { await this.fs.mkdir(directory); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await this.fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('nested directory symbolic link rejected');
    const real = await this.fs.realpath(directory);
    const runReal = await this.fs.realpath(runDir);
    if (path.dirname(real) !== runReal) throw new TypeError('nested directory containment violation');
    return directory;
  }
}

module.exports = { RunStore };
