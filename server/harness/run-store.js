'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const { constants } = require('node:fs');
const path = require('node:path');
const { validateEvent, readStoredEvent } = require('./event-contract');

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MUTABLE_DOCUMENTS = new Set(['plan.json', 'verification.json', 'artifacts/manifest.json', 'checkpoints/manifest.json']);
const OPERATION_DOCUMENT = /^operations\/(?:child|checkpoint|resume)-[a-f0-9]{64}\.json$/;
const QUARANTINE_ENTRY = /^\.quarantine-([A-Za-z0-9][A-Za-z0-9._-]{0,127})-([a-f0-9]{32})$/;

class RunStore {
  constructor({ root, fsOps = fs, createReadStream: streamFactory = createReadStream, createInterface: readlineFactory = createInterface, maxRunScan = 10000, listConcurrency = 16 }) {
    if (!root) throw new TypeError('root is required');
    if (!Number.isSafeInteger(maxRunScan) || maxRunScan < 1 || !Number.isSafeInteger(listConcurrency) || listConcurrency < 1 || listConcurrency > 16) throw new TypeError('invalid run scan bounds');
    this.root = path.resolve(root);
    this.fs = fsOps;
    this.createReadStream = streamFactory;
    this.createInterface = readlineFactory;
    this.maxRunScan = maxRunScan;
    this.listConcurrency = listConcurrency;
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
    if (!MUTABLE_DOCUMENTS.has(name) && !/^checkpoints\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name) && !OPERATION_DOCUMENT.test(name)) throw new TypeError('document name is not allowlisted');
    const runDir = await this.secureRun(runId);
    const file = path.resolve(runDir, name);
    if (!file.startsWith(`${runDir}${path.sep}`)) throw new TypeError('document name escapes run directory');
    await this.secureDirectory(path.dirname(file), runDir);
    await this.atomicWrite(file, value);
    return value;
  }

  async readDocument(runId, name) {
    if (!MUTABLE_DOCUMENTS.has(name) && !/^checkpoints\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(name) && !OPERATION_DOCUMENT.test(name)) throw new TypeError('document name is not allowlisted');
    const runDir=await this.secureRun(runId); const file=path.resolve(runDir,name);
    if (!file.startsWith(`${runDir}${path.sep}`)) throw new TypeError('document name escapes run directory');
    const handle=await this.fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
  }

  async deleteRun(runId) {
    const dir=this.runPath(runId); await this.secureRun(runId);
    const stat=await this.fs.lstat(dir);
    if(stat.isSymbolicLink()||!stat.isDirectory()) throw new TypeError('run directory symbolic link rejected');
    const quarantineName=`.quarantine-${runId}-${require('node:crypto').randomUUID().replaceAll('-','')}`;
    const quarantine=path.join(this.root,quarantineName);
    try { await this.fs.lstat(quarantine); throw new Error('quarantine collision'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    await this.fs.rename(dir,quarantine);
    try { await this.fs.rm(quarantine,{recursive:true,force:false}); }
    catch(error) { error.originalRunId=runId; error.quarantineName=quarantineName; error.quarantinePath=quarantine; error.renamed=true; throw error; }
  }

  async reconcileQuarantine({maxEntries=1000,dryRun=false}={}) {
    if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>10000||typeof dryRun!=='boolean') throw new TypeError('invalid quarantine reconciliation options');
    try { await this.secureRoot(); } catch(error) { if(error.code==='ENOENT') return {dryRun,results:[],warnings:[]}; throw error; }
    const selected=[]; let truncated=false; const directory=await this.fs.opendir(this.root);
    try{
      const iterator=directory[Symbol.asyncIterator]();
      let scanned=0;
      while(scanned<maxEntries){
        const {value:entry,done}=await iterator.next();
        if(done)break;
        scanned+=1;
        if(QUARANTINE_ENTRY.test(entry.name))selected.push(entry.name);
      }
      if(scanned===maxEntries){
        const {done}=await iterator.next();
        truncated=!done;
      }
    }finally{
      try{await directory.close();}catch(error){if(error.code!=='ERR_DIR_CLOSED')throw error;}
    }
    const results=[]; const concurrency=Math.min(8,this.listConcurrency);
    for(let index=0;index<selected.length;index+=concurrency){
      results.push(...await Promise.all(selected.slice(index,index+concurrency).map(async name=>{
        const target=path.join(this.root,name);
        try{
          const stat=await this.fs.lstat(target);
          if(stat.isSymbolicLink()||!stat.isDirectory()) return {name,status:'rejected',error:'quarantine entry symbolic link or non-directory rejected'};
          if(dryRun)return {name,status:'leftover'};
          await this.fs.rm(target,{recursive:true,force:false}); return {name,status:'deleted'};
        }catch(error){return {name,status:'error',error:error.message};}
      })));
    }
    const warnings=[];if(truncated)warnings.push('Quarantine scan reached its bounded entry limit.');
    for(const item of results)if(item.status==='error'||item.status==='rejected')warnings.push(`${item.name}: ${item.error}`);
    return {dryRun,results,warnings,truncated};
  }

  async runSize(runId,{maxEntries=10000,maxBytes=1024*1024*1024}={}) {
    const root=await this.secureRun(runId); let entries=0; let bytes=0; let capped=false;
    const walk=async directory=>{
      for(const item of await this.fs.readdir(directory,{withFileTypes:true})){
        if(++entries>maxEntries){capped=true;return;}
        const target=path.join(directory,item.name); const stat=await this.fs.lstat(target);
        if(stat.isSymbolicLink()) continue;
        if(stat.isDirectory()) await walk(target); else if(stat.isFile()) bytes+=stat.size;
        if(bytes>=maxBytes){bytes=maxBytes;capped=true;return;}
      }
    };
    await walk(root); return {bytes,entries,capped};
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

  async readEventsPage(runId, { cursor, offset, limit = 100, maxBytes = 1024 * 1024 } = {}) {
    const start = cursor ?? offset ?? 0;
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new TypeError('invalid event page bounds');
    const dir = await this.secureRun(runId);
    const file = path.join(dir, 'events.jsonl');
    const handle = await this.fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const items = []; const warnings = []; const maxLineBytes = 64 * 1024;
    const streamAllowance = maxBytes + maxLineBytes + 1;
    let stat; let position; let lineStart; let line = Buffer.alloc(0); let discarding = false; let linesRead = 0;
    try {
      stat = await handle.stat(); position = Math.min(start, stat.size); lineStart = position;
      if (position > 0 && position < stat.size) {
        const previous = Buffer.allocUnsafe(1); await handle.read(previous, 0, 1, position - 1);
        discarding = previous[0] !== 0x0a;
        if (discarding) warnings.push('Cursor was inside a JSONL record; discarded its remaining fragment.');
      }
      const pageStart = Math.min(start, stat.size);
      while (position < stat.size && items.length < limit) {
        const consumed = position - pageStart;
        if (consumed >= maxBytes && (discarding || !line.length || consumed >= streamAllowance)) break;
        const readLimit = consumed < maxBytes ? maxBytes : streamAllowance;
        const remaining = readLimit - consumed;
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining, stat.size - position));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        let index = 0;
        while (index < bytesRead && items.length < limit) {
          const newline = chunk.indexOf(0x0a, index);
          if (newline === -1) {
            const fragment = chunk.subarray(index, bytesRead); position += fragment.length;
            if (!discarding) {
              if (line.length + fragment.length > maxLineBytes) { discarding = true; line = Buffer.alloc(0); warnings.push('Oversized JSONL record discarded.'); }
              else line = Buffer.concat([line, fragment]);
            }
            index = bytesRead; break;
          }
          const fragment = chunk.subarray(index, newline);
          position += fragment.length + 1; index = newline + 1; linesRead++;
          if (!discarding) {
            const complete = line.length ? Buffer.concat([line, fragment]) : fragment;
            if (complete.length) {
              try { items.push(readStoredEvent(JSON.parse(complete.toString('utf8')))); }
              catch (error) { warnings.push(`Malformed JSONL record discarded: ${error.message}`); }
            }
          }
          line = Buffer.alloc(0); discarding = false; lineStart = position;
          if (position - pageStart > maxBytes) break;
        }
      }
      if (line.length && position === stat.size) {
        warnings.push('Truncated final JSONL record ignored.');
        line = Buffer.alloc(0); lineStart = position;
      }
      if (line.length && !discarding) position = lineStart;
    } finally { await handle.close(); }
    const bytesRead = Math.max(0, position - Math.min(start, stat.size));
    const hasMore = position < stat.size;
    return { items, cursor: start, offset: start, limit, nextCursor: position, nextOffset: position, hasMore, warnings, bytesRead, linesRead };
  }

  async listRuns() {
    try {
      await this.secureRoot();
      const ids=[]; let scanTruncated=false;
      if (typeof this.fs.opendir === 'function') {
        const directory=await this.fs.opendir(this.root);
        for await (const entry of directory) {
          if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
          if (ids.length >= this.maxRunScan) { scanTruncated=true; break; }
          ids.push(entry.name);
        }
      } else {
        const entries=await this.fs.readdir(this.root,{withFileTypes:true});
        const valid=entries.filter(entry=>entry.isDirectory()&&RUN_ID.test(entry.name));
        scanTruncated=valid.length>this.maxRunScan;
        ids.push(...valid.slice(0,this.maxRunScan).map(entry=>entry.name));
      }
      ids.sort();
      const runs=[];
      for(let index=0;index<ids.length;index+=this.listConcurrency) runs.push(...await Promise.all(ids.slice(index,index+this.listConcurrency).map(id=>this.getRun(id))));
      runs.sort((left, right) => {
        const byCreatedAt = (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0);
        return byCreatedAt || String(left.id).localeCompare(String(right.id));
      });
      Object.defineProperties(runs,{scanTruncated:{value:scanTruncated,enumerable:false},warnings:{value:scanTruncated?['Run metadata scan reached its bounded directory limit.']:[],enumerable:false}});
      return runs;
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
