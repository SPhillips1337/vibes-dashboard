'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RunStore } = require('../../server/harness/run-store');

async function store(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-store-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return { root, value: new RunStore({ root }) }; }
function evt(runId, eventId, type = 'run.created', data = {}) { return { schemaVersion: 1, eventId, runId, type, timestamp: '2026-07-12T12:00:00.000Z', actor: { type: 'harness', id: 'test' }, data }; }
function metadata(id, createdAt = '2026-07-12T12:00:00.000Z') { return { id, createdAt }; }

test('creates immutable run metadata and reads it back', async t => {
  const { value } = await store(t);
  const metadata = { id: 'run-a', createdAt: '2026-07-12T12:00:00.000Z', goal: 'ship' };
  await value.createRun(metadata);
  assert.deepEqual(await value.getRun('run-a'), metadata);
  await assert.rejects(value.createRun(metadata), /exists/i);
});

test('appends valid events and serializes concurrent writes per run', async t => {
  const { value } = await store(t); await value.createRun(metadata('run-a'));
  await Promise.all(Array.from({ length: 20 }, (_, i) => value.appendEvent('run-a', evt('run-a', `evt-${i}`))));
  const result = await value.readEvents('run-a');
  assert.deepEqual(result.events.map(x => x.eventId), Array.from({ length: 20 }, (_, i) => `evt-${i}`));
  assert.deepEqual(result.warnings, []);
});

test('appendEvents validates the whole batch before one append write', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-batch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writes = [];
  const fsOps = { ...fs, async appendFile(...args) { writes.push(args[1]); return fs.appendFile(...args); } };
  const value = new RunStore({ root, fsOps });
  await value.createRun(metadata('run-a'));
  await value.appendEvents('run-a', [evt('run-a', 'evt-1'), evt('run-a', 'evt-2')]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].split('\n').filter(Boolean).length, 2);
  await assert.rejects(value.appendEvents('run-a', [evt('run-a', 'evt-3'), evt('other', 'evt-4')]), /run id/i);
  assert.equal(writes.length, 1);
  assert.deepEqual((await value.readEvents('run-a')).events.map(event => event.eventId), ['evt-1', 'evt-2']);
});

test('rejects traversal, mismatched run IDs, and writes outside root', async t => {
  const { root, value } = await store(t);
  for (const id of ['../escape', 'a/b', '/tmp/escape', '.', '']) await assert.rejects(value.createRun({ id }), /run id/i);
  await value.createRun(metadata('safe'));
  await assert.rejects(value.appendEvent('safe', evt('other', 'evt-1')), /run id/i);
  assert.equal(await fs.stat(path.dirname(root)).then(() => true), true);
  await assert.rejects(fs.access(path.join(path.dirname(root), 'escape', 'run.json')));
});

test('lists runs newest-first by createdAt with deterministic ID tie-break', async t => {
  const { value } = await store(t);
  await value.createRun({ id: 'old-run', createdAt: '2026-07-10T00:00:00.000Z' });
  await value.createRun({ id: 'z-run', createdAt: '2026-07-12T00:00:00.000Z' });
  await value.createRun({ id: 'a-run', createdAt: '2026-07-12T00:00:00.000Z' });
  assert.deepEqual((await value.listRuns()).map(x => x.id), ['a-run', 'z-run', 'old-run']);
});

test('run listing caps metadata opens and concurrency and reports a truncated scan', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'harness-list-cap-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let active=0; let peak=0; let opens=0;
  const fsOps={...fs,async open(...args){ if(String(args[0]).endsWith('run.json')){opens++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;} return fs.open(...args); }};
  const seed=new RunStore({root}); for(let i=0;i<12;i++) await seed.createRun(metadata(`run-${String(i).padStart(2,'0')}`,new Date(1700000000000+i).toISOString()));
  const value=new RunStore({root,fsOps,maxRunScan:5,listConcurrency:3}); const runs=await value.listRuns();
  assert.equal(opens,5); assert.ok(peak<=3); assert.equal(runs.length,5); assert.equal(runs.scanTruncated,true); assert.match(runs.warnings[0],/bounded/i);
  assert.deepEqual(runs.map(run=>run.createdAt),[...runs].map(run=>run.createdAt).sort().reverse());
});

test('quarantine reconciliation bounds directory iteration with lookahead and closes it', async () => {
  let reads=0; let closes=0; let active=0; let peak=0;
  const entries=Array.from({length:1000},(_,i)=>({name:`.quarantine-run-${i}-${'a'.repeat(32)}`}));
  const directory={async next(){reads++;return {value:entries.shift(),done:false};},[Symbol.asyncIterator](){return this;},async close(){closes++;}};
  const fsOps={...fs,opendir:async()=>directory,lstat:async()=>({isSymbolicLink:()=>false,isDirectory:()=>true}),rm:async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;}};
  const value=new RunStore({root:'/tmp/quarantine-iterator-success',fsOps,listConcurrency:16}); value.secureRoot=async()=>{};
  const result=await value.reconcileQuarantine({maxEntries:5});
  assert.equal(reads,6); assert.equal(closes,1); assert.equal(result.results.length,5); assert.equal(result.truncated,true); assert.ok(peak<=8);
});

test('quarantine reconciliation caps total scans even when entries do not match', async () => {
  let reads=0; let closes=0;
  const directory={async next(){reads++;return {value:{name:`ordinary-run-${reads}`},done:false};},[Symbol.asyncIterator](){return this;},async close(){closes++;}};
  const value=new RunStore({root:'/tmp/quarantine-nonmatching-bound',fsOps:{...fs,opendir:async()=>directory}}); value.secureRoot=async()=>{};
  const result=await value.reconcileQuarantine({maxEntries:5,dryRun:true});
  assert.equal(reads,6); assert.equal(closes,1); assert.equal(result.results.length,0); assert.equal(result.truncated,true);
});

test('quarantine reconciliation closes the directory when iteration fails', async () => {
  let closes=0; let reads=0;
  const directory={async next(){if(++reads===2)throw new Error('iterator failed');return {value:{name:`.quarantine-run-1-${'b'.repeat(32)}`},done:false};},[Symbol.asyncIterator](){return this;},async close(){closes++;}};
  const value=new RunStore({root:'/tmp/quarantine-iterator-error',fsOps:{...fs,opendir:async()=>directory}}); value.secureRoot=async()=>{};
  await assert.rejects(()=>value.reconcileQuarantine({maxEntries:5}),/iterator failed/);
  assert.equal(closes,1);
});

test('recovers complete events and warns on a truncated final JSONL record', async t => {
  const { root, value } = await store(t); await value.createRun(metadata('run-a'));
  await value.appendEvent('run-a', evt('run-a', 'evt-1'));
  await fs.appendFile(path.join(root, 'run-a', 'events.jsonl'), '{"schemaVersion":1');
  const result = await value.readEvents('run-a');
  assert.deepEqual(result.events.map(x => x.eventId), ['evt-1']);
  assert.match(result.warnings[0], /truncated/i);
});

test('run identity is immutable and only allowlisted mutable documents are replaced atomically', async t => {
  const { root, value } = await store(t); await value.createRun({ ...metadata('run-a'), status: 'new' });
  assert.equal(value.replaceRun, undefined);
  const documents = ['plan.json', 'verification.json', 'artifacts/manifest.json', 'checkpoints/manifest.json'];
  for (const name of documents) {
    await value.writeDocument('run-a', name, { name });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'run-a', name), 'utf8')), { name });
  }
  assert.deepEqual(await value.getRun('run-a'), { ...metadata('run-a'), status: 'new' });
  for (const name of ['run.json', 'events.jsonl', '../escape.json', 'artifacts/../run.json', '/tmp/escape.json']) {
    await assert.rejects(value.writeDocument('run-a', name, {}), /document name/i);
  }
  const files = await fs.readdir(path.join(root, 'run-a'), { recursive: true });
  assert.equal(files.some(name => name.includes('.tmp-')), false);
});

test('rejects a run directory replaced by a symlink without reading or appending outside root', async t => {
  const { root, value } = await store(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await value.createRun(metadata('run-a'));
  await fs.rm(path.join(root, 'run-a'), { recursive: true });
  await fs.writeFile(path.join(outside, 'run.json'), JSON.stringify({ id: 'outside' }));
  await fs.writeFile(path.join(outside, 'events.jsonl'), 'sentinel\n');
  await fs.symlink(outside, path.join(root, 'run-a'));
  await assert.rejects(value.getRun('run-a'), /symbolic|containment/i);
  await assert.rejects(value.writeDocument('run-a', 'plan.json', {}), /symbolic|containment/i);
  await assert.rejects(value.appendEvent('run-a', evt('run-a', 'evt-outside')), /symbolic|containment/i);
  await assert.rejects(value.readEvents('run-a'), /symbolic|containment/i);
  assert.equal(await fs.readFile(path.join(outside, 'events.jsonl'), 'utf8'), 'sentinel\n');
});

test('rejects symlinked nested document directories without touching outside files', async t => {
  const { root, value } = await store(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-nested-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await value.createRun(metadata('run-a'));
  for (const directory of ['artifacts', 'checkpoints']) {
    await fs.symlink(outside, path.join(root, 'run-a', directory));
    await assert.rejects(value.writeDocument('run-a', `${directory}/manifest.json`, { escaped: true }), /symbolic|containment/i);
    await fs.unlink(path.join(root, 'run-a', directory));
  }
  await assert.rejects(fs.access(path.join(outside, 'manifest.json')));
});

test('settled append queues are cleaned without deleting a newer queued tail', async t => {
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let appends = 0;
  const fsOps = { ...fs, async appendFile(...args) { appends += 1; if (appends === 1) await firstGate; return fs.appendFile(...args); } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-queues-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const value = new RunStore({ root, fsOps });
  await value.createRun(metadata('run-a'));
  const first = value.appendEvent('run-a', evt('run-a', 'evt-1'));
  const second = value.appendEvent('run-a', evt('run-a', 'evt-2'));
  releaseFirst();
  await first;
  assert.equal(value.queues.has('run-a'), true);
  await second;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value.queues.has('run-a'), false);
  fsOps.appendFile = async () => { throw new Error('append failed'); };
  await assert.rejects(value.appendEvent('run-a', evt('run-a', 'evt-3')), /append failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(value.queues.has('run-a'), false);
});

test('atomic writes remove temporary files after write and rename failures', async t => {
  for (const failure of ['writeFile', 'rename']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `harness-${failure}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    let fail = false;
    const fsOps = { ...fs, async [failure](...args) { if (fail) throw new Error(`${failure} failed`); return fs[failure](...args); } };
    const value = new RunStore({ root, fsOps });
    await value.createRun(metadata('run-a'));
    fail = true;
    await assert.rejects(value.writeDocument('run-a', 'plan.json', { value: 1 }), new RegExp(`${failure} failed`));
    assert.equal((await fs.readdir(path.join(root, 'run-a'))).some(name => name.includes('.tmp-')), false);
  }
});

test('validates and normalizes metadata timestamps and sorts by instant then ID', async t => {
  const { value } = await store(t);
  await assert.rejects(value.createRun({ id: 'bad-date', createdAt: 'not-a-date' }), /createdAt/i);
  await assert.rejects(value.createRun({ id: 'missing-date' }), /createdAt/i);
  const normalized = await value.createRun(metadata('offset', '2026-07-12T13:00:00+01:00'));
  assert.equal(normalized.createdAt, '2026-07-12T12:00:00.000Z');
  await value.createRun(metadata('same', '2026-07-12T12:00:00.000Z'));
  await value.createRun(metadata('newer', '2026-07-12T12:00:00.001Z'));
  assert.deepEqual((await value.listRuns()).map(run => run.id), ['newer', 'offset', 'same']);
});
