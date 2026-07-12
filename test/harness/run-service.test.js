'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RunStore } = require('../../server/harness/run-store');
const { RunService } = require('../../server/harness/run-service');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-service-'));
  let sequence = 0;
  const emitted = [];
  const service = new RunService({ store: new RunStore({ root }), clock: () => new Date(`2026-07-12T00:00:${String(sequence).padStart(2,'0')}.000Z`), idGenerator: prefix => `${prefix}-${++sequence}`, emit: (event, run) => emitted.push({ event, run }) });
  return { root, service, emitted };
}

async function customFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-service-'));
  let sequence = 0;
  const emitErrors = [];
  const service = new RunService({
    store: new RunStore({ root }),
    clock: () => new Date(`2026-07-12T00:01:${String(sequence).padStart(2,'0')}.000Z`),
    idGenerator: prefix => `${prefix}-${++sequence}`,
    emit: options.emit,
    onEmitError: (error, event) => emitErrors.push({ error, event })
  });
  return { root, service, emitErrors };
}

test('persists a canonical lifecycle and gates completion on verification', async t => {
  const { root, service, emitted } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const run = await service.createRun({ mission:'ship', cwd:'/tmp', actor:{type:'forged',id:'socket'}, eventId:'forged' });
  await service.recordPlan(run.id, { summary:'safe', steps:['one'] });
  await service.approvePlan(run.id);
  await service.startExecution(run.id);
  await service.recordTaskStatus(run.id, { id:'one', name:'One', status:'in-progress' });
  await service.recordTaskStatus(run.id, { id:'one', name:'One', status:'complete' });
  await service.claimExecutionComplete(run.id, { result:'claimed' });
  assert.equal((await service.getRun(run.id)).status, 'verifying');
  await assert.rejects(() => service.finishVerification(run.id, { passed:false, evidence:['bad'] }));
  await service.startVerification(run.id, { checks:['fixture'] });
  await service.finishVerification(run.id, { passed:true, evidence:['ok'] });
  const complete = await service.getRun(run.id);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.verification.status, 'passed');
  assert.ok(emitted.every(({event}) => event.actor.type === 'harness' && event.eventId !== 'forged'));
  const disk = await new RunStore({root}).readEvents(run.id);
  assert.deepEqual(disk.events.map(e=>e.type), emitted.map(x=>x.event.type));
});

test('rejects illegal transitions and secret-bearing input', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const run = await service.createRun({ mission:'safe' });
  await assert.rejects(() => service.startExecution(run.id), /illegal transition/);
  await service.recordLog(run.id, { message:'x', apiKey:'secret' });
  const view = await service.getRun(run.id);
  assert.equal(view.logs[0].apiKey, '[REDACTED]');
  assert.equal(view.status, 'planning');
});

test('known credentials never reach event JSONL, projections, documents, or emissions through free-form text', async t => {
  const { root, service, emitted } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const secret='sentinel-persist-broadcast-secret';
  const run=await service.createRun({mission:`ship without ${secret}`,sensitiveValues:[secret]});
  await service.recordPlan(run.id,{summary:`plan echoed ${secret}`,tasks:[]});
  await service.recordLog(run.id,{message:`bridge log ${secret}`});
  const values=[
    await fs.readFile(path.join(root,run.id,'events.jsonl'),'utf8'),
    await fs.readFile(path.join(root,run.id,'run.json'),'utf8'),
    await fs.readFile(path.join(root,run.id,'plan.json'),'utf8'),
    JSON.stringify(await service.getRun(run.id)),
    JSON.stringify(emitted)
  ];
  for (const value of values) assert.equal(value.includes(secret),false);
  assert.match(values[0],/\[REDACTED\]/);
});

test('repeated calls are idempotent and concurrent runs stay isolated', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const [a,b] = await Promise.all([service.createRun({mission:'a'}), service.createRun({mission:'b'})]);
  await service.recordPlan(a.id,{steps:['a']}); await service.recordPlan(a.id,{steps:['a']});
  await service.recordLog(a.id,{message:'only a'});
  assert.equal((await service.getRun(a.id)).logs.length,1);
  assert.equal((await service.getRun(b.id)).logs.length,0);
  assert.equal((await new RunStore({root}).readEvents(a.id)).events.filter(e=>e.type==='plan.proposed').length,1);
});

test('persists allowlisted plan and verification documents', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const run=await service.createRun({mission:'docs'}); const plan={steps:['x']};
  await service.recordPlan(run.id,plan); await service.approvePlan(run.id); await service.startExecution(run.id); await service.claimExecutionComplete(run.id); await service.startVerification(run.id); await service.finishVerification(run.id,{passed:true,evidence:[]});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,run.id,'plan.json'),'utf8')),plan);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,run.id,'verification.json'),'utf8')).passed,true);
});

test('verification final events and persisted documents are bounded and emitted before document write', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-service-bounded-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  let sequence = 0; const emitted = [];
  let failVerificationDocument = false;
  const fsOps = { ...fs, async writeFile(file, ...rest) { if (failVerificationDocument && String(file).includes('verification.json.tmp-')) throw new Error('doc write failed'); return fs.writeFile(file, ...rest); } };
  const service = new RunService({ store: new RunStore({ root, fsOps }), idGenerator: prefix => `${prefix}-${++sequence}`, emit: event => emitted.push(event) });
  const run=await service.createRun({mission:'bounded'});
  await service.recordPlan(run.id,{tasks:[]}); await service.approvePlan(run.id); await service.startExecution(run.id); await service.claimExecutionComplete(run.id); await service.startVerification(run.id);
  const large='a'.repeat(80*1024);
  await service.finishVerification(run.id,{passed:true,checks:Array.from({length:40},(_,i)=>({id:`c${i}`,stdout:large,stderr:large,passed:true})),artifacts:Array.from({length:40},(_,i)=>({path:`a${i}.txt`,valid:true,sha256:'x'.repeat(64)}))});
  const finalEvent=emitted.at(-1);
  assert.equal(finalEvent.type,'verification.passed');
  assert.ok(Buffer.byteLength(JSON.stringify(finalEvent))<=64*1024);
  assert.ok(Buffer.byteLength(finalEvent.data.checks[0].stdout)<=16*1024);
  assert.ok(finalEvent.data.checks.length<=16);
  assert.ok(finalEvent.data.artifacts.length<=16);
  assert.ok((await fs.stat(path.join(root,run.id,'verification.json'))).size<=128*1024);

  const second=await service.createRun({mission:'doc failure'});
  await service.recordPlan(second.id,{tasks:[]}); await service.approvePlan(second.id); await service.startExecution(second.id); await service.claimExecutionComplete(second.id); await service.startVerification(second.id);
  failVerificationDocument = true;
  await assert.rejects(()=>service.finishVerification(second.id,{passed:true,checks:[{id:'ok',stdout:'ok',passed:true}],artifacts:[]}),/doc write failed/);
  assert.equal(emitted.at(-1).type,'verification.passed');
  assert.equal((await service.getRun(second.id)).status,'completed');
});

test('strictly allowlists persisted LLM metadata and durable retry preserves history', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const secret='phase2-persist-secret';
  const run=await service.createRun({mission:'retry',llmPrefs:{provider:'openai',hostUrl:'http://local',host:'legacy-must-not-persist',model:'m',maxTokens:10,apiKey:secret,token:secret}});
  const disk=await fs.readFile(path.join(root,run.id,'run.json'),'utf8');
  assert.equal(disk.includes(secret),false);
  assert.deepEqual(JSON.parse(disk).llmPrefs,{provider:'openai',hostUrl:'http://local',model:'m',maxTokens:10});
  await service.recordPlan(run.id,{tasks:[{id:'upstream-1',name:'One'}]}); await service.approvePlan(run.id); await service.startExecution(run.id,{operationKey:'accept-1'});
  await service.failExecution(run.id,{stage:'execution',reason:'boom',operationKey:'fail-1'});
  const retried=await service.retryRun(run.id,{fromTaskId:'upstream-1',operationKey:'retry-1'});
  assert.equal(retried.status,'executing'); assert.equal(retried.attempt,2); assert.equal(retried.tasks[0].id,'upstream-1');
  const events=(await new RunStore({root}).readEvents(run.id)).events;
  assert.equal(events.filter(e=>e.type==='execution.retry_requested').length,1);
  await service.retryRun(run.id,{fromTaskId:'upstream-1',operationKey:'retry-1'});
  assert.equal((await new RunStore({root}).readEvents(run.id)).events.length,events.length);
  assert.equal(JSON.stringify(await service.getRun(run.id)).includes(secret),false);
});

test('retry from intervention atomically persists resolution before retry', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const run=await service.createRun({mission:'retry task'});
  await service.recordPlan(run.id,{tasks:[{id:'task-1',name:'One'}]});
  await service.approvePlan(run.id); await service.startExecution(run.id);
  const blocked=await service.requestIntervention(run.id,{id:'help-1',kind:'retry',taskId:'task-1'});
  assert.equal(blocked.status,'blocked');
  const retried=await service.retryFromIntervention(run.id,{interventionId:'help-1',fromTaskId:'task-1',operationKey:'retry-task-1'});
  assert.equal(retried.status,'executing');
  assert.equal(retried.interventions[0].status,'resolved');
  const events=(await new RunStore({root}).readEvents(run.id)).events;
  assert.deepEqual(events.slice(-2).map(event=>event.type),['intervention.resolved','execution.retry_requested']);
  await service.retryFromIntervention(run.id,{interventionId:'help-1',fromTaskId:'task-1',operationKey:'retry-task-1'});
  assert.equal((await new RunStore({root}).readEvents(run.id)).events.length,events.length);
});

test('failed intervention retry batch changes neither disk, cache, nor emissions and remains retryable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-service-batch-failure-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  let failBatch = false; let sequence = 0; const emitted = [];
  const fsOps = { ...fs, async appendFile(...args) { if (failBatch && String(args[1]).includes('execution.retry_requested')) throw new Error('injected batch failure'); return fs.appendFile(...args); } };
  const store = new RunStore({ root, fsOps });
  const service = new RunService({ store, idGenerator: prefix => `${prefix}-${++sequence}`, emit: event => emitted.push(event) });
  const run = await service.createRun({mission:'atomic retry'});
  await service.recordPlan(run.id,{tasks:[{id:'task-1'}]}); await service.approvePlan(run.id); await service.startExecution(run.id);
  await service.requestIntervention(run.id,{id:'help-1',taskId:'task-1'});
  const before = await service.getRun(run.id); const beforeEvents = (await store.readEvents(run.id)).events.length; const beforeEmits = emitted.length;
  failBatch = true;
  await assert.rejects(service.retryFromIntervention(run.id,{interventionId:'help-1',fromTaskId:'task-1',operationKey:'retry-1'}),/injected batch failure/);
  assert.deepEqual(await service.getRun(run.id), before);
  assert.equal((await store.readEvents(run.id)).events.length, beforeEvents);
  assert.equal(emitted.length, beforeEmits);
  failBatch = false;
  const recovered = await service.retryFromIntervention(run.id,{interventionId:'help-1',fromTaskId:'task-1',operationKey:'retry-1'});
  assert.equal(recovered.attempt, 2);
  assert.equal(recovered.interventions[0].status, 'resolved');
  assert.deepEqual((await store.readEvents(run.id)).events.slice(-2).map(event => event.type), ['intervention.resolved','execution.retry_requested']);
});

test('retry from intervention rejects absent intervention without appending retry', async t => {
  const { root, service } = await fixture(); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const run=await service.createRun({mission:'invalid retry'});
  await service.recordPlan(run.id,{tasks:[{id:'task-1'}]}); await service.approvePlan(run.id); await service.startExecution(run.id);
  await assert.rejects(()=>service.retryFromIntervention(run.id,{interventionId:'missing',fromTaskId:'task-1',operationKey:'bad'}),/requested intervention/);
  const events=(await new RunStore({root}).readEvents(run.id)).events;
  assert.equal(events.some(event=>event.type==='execution.retry_requested'),false);
});

test('notification failures do not reject committed events or duplicate persistence', async t => {
  for (const emit of [() => { throw new Error('sync emit'); }, async () => { throw new Error('async emit'); }]) {
    const { root, service, emitErrors }=await customFixture({emit}); t.after(() => fs.rm(root,{recursive:true,force:true}));
    const run=await service.createRun({mission:'emit isolation'});
    assert.equal(run.status,'planning');
    const events=(await new RunStore({root}).readEvents(run.id)).events;
    assert.deepEqual(events.map(event=>event.type),['run.created','plan.requested']);
    assert.equal(emitErrors.length,2);
    assert.match(emitErrors[0].error.message,/emit/);
  }
});
