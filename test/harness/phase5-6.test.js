'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {RunStore}=require('../../server/harness/run-store');
const {RunService}=require('../../server/harness/run-service');

async function fixture(options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'harness-phase56-'));
  let n=0;
  const store=new RunStore({root});
  const service=new RunService({store,idGenerator:p=>`${p}-${++n}`,clock:()=>new Date(Date.UTC(2026,6,12,0,0,n)),...options});
  return {root,store,service};
}

async function complete(service,run) {
  await service.recordPlan(run.id,{tasks:[]}); await service.approvePlan(run.id); await service.startExecution(run.id);
  await service.claimExecutionComplete(run.id); await service.startVerification(run.id); await service.finishVerification(run.id,{passed:true});
}

test('child creation derives immutable lineage, is idempotent, isolated, and bounded to depth four',async t=>{
  const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const parent=await service.createRun({mission:'root'});
  const child=await service.createChildRun(parent.id,{mission:'child',taskId:'task-1',operationKey:'spawn-1',rootRunId:'forged',depth:99});
  const duplicate=await service.createChildRun(parent.id,{mission:'child',taskId:'task-1',operationKey:'spawn-1'});
  assert.equal(duplicate.id,child.id); assert.equal(child.parentRunId,parent.id); assert.equal(child.rootRunId,parent.id); assert.equal(child.depth,1);
  await assert.rejects(()=>service.createChildRun(parent.id,{mission:'conflict',taskId:'task-1',operationKey:'spawn-1'}),/conflicts/);
  assert.equal((await service.getRun(parent.id)).children[0].id,child.id);
  assert.equal((await store.readEvents(parent.id)).events.filter(e=>e.type==='run.child_created').length,1);
  await service.recordLog(child.id,{message:'child only'}); assert.equal((await service.getRun(parent.id)).logs.length,0);
  let cursor=child; for(let depth=2;depth<=4;depth++) cursor=await service.createChildRun(cursor.id,{mission:`d${depth}`,operationKey:`d${depth}`});
  await assert.rejects(()=>service.createChildRun(cursor.id,{mission:'too deep',operationKey:'d5'}),/maximum child depth/);
  await assert.rejects(()=>service.createRun({mission:'forged',parentRunId:parent.id}),/createChildRun/);
});

test('parent child summaries aggregate shallow status and verification fails closed for required children',async t=>{
  const {root,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const parent=await service.createRun({mission:'parent'}); const child=await service.createChildRun(parent.id,{mission:'child',operationKey:'c'});
  let view=await service.getRun(parent.id); assert.deepEqual(view.childSummary.counts,{planning:1});
  await complete(service,child); view=await service.getRun(parent.id); assert.equal(view.children[0].verificationStatus,'passed');
  const verified=await service.evaluateRequiredChildren(parent.id,[child.id]); assert.equal(verified.passed,true); assert.equal(verified.evidence[0].runId,child.id); assert.equal(typeof verified.evidence[0].elapsedMs,'number');
  const other=await service.createChildRun(parent.id,{mission:'other',operationKey:'o'});
  const failed=await service.evaluateRequiredChildren(parent.id,[other.id]); assert.equal(failed.passed,false); assert.match(failed.reason,/unverified/);
});

test('checkpoint validation, atomic manifest, idempotency, and conservative resume',async t=>{
  const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const run=await service.createRun({mission:'checkpoint'});
  const cp=await service.recordCheckpoint(run.id,{label:'ready',summary:'safe metadata',completedTaskIds:['t1'],artifactEventIds:['evt-1'],operationKey:'cp-1'});
  const same=await service.recordCheckpoint(run.id,{label:'ready',summary:'safe metadata',completedTaskIds:['t1'],artifactEventIds:['evt-1'],operationKey:'cp-1'}); assert.equal(same.checkpointId,cp.checkpointId);
  await assert.rejects(()=>service.recordCheckpoint(run.id,{label:'conflict',operationKey:'cp-1'}),/conflicts/);
  assert.equal((await store.readEvents(run.id)).events.filter(e=>e.type==='checkpoint.recorded').length,1);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,run.id,'checkpoints',`${cp.checkpointId}.json`),'utf8')).label,'ready');
  await assert.rejects(()=>service.recordCheckpoint(run.id,{label:'x'.repeat(129),operationKey:'bad'}),/checkpoint/);
  await assert.rejects(()=>service.resumeFromCheckpoint(run.id,'missing',{operationKey:'resume-bad'}),/does not belong/);
  await assert.rejects(()=>service.resumeFromCheckpoint(run.id,cp.checkpointId,{operationKey:'resume-1'}),/interrupted or blocked/);
  await service.restoreRuns();
  const resumed=await service.resumeFromCheckpoint(run.id,cp.checkpointId,{operationKey:'resume-1'});
  assert.equal(resumed.status,'planning'); assert.equal(resumed.retry.checkpointId,cp.checkpointId); assert.equal(resumed.retry.mode,'checkpoint');
});

test('retention defaults dry-run, protects active/lineage, and rejects symlink deletion',async t=>{
  const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const old=await service.createRun({mission:'old'}); await complete(service,old);
  const active=await service.createRun({mission:'active'});
  const parent=await service.createRun({mission:'parent'}); await service.failExecution(parent.id,{reason:'done'});
  await service.createChildRun(parent.id,{mission:'retained child',operationKey:'child'});
  const dry=await service.pruneRuns({maxCount:0}); assert.equal(dry.dryRun,true); assert.ok(dry.eligible.includes(old.id)); assert.equal(dry.eligible.includes(active.id),false); assert.equal(dry.eligible.includes(parent.id),false);
  await assert.rejects(()=>service.pruneRuns({dryRun:false,maxCount:0}),/disabled/);
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'outside-run-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.rm(path.join(root,old.id),{recursive:true}); await fs.symlink(outside,path.join(root,old.id));
  await assert.rejects(()=>store.deleteRun(old.id),/symbolic link/);
});

test('export is redacted, bounded, includes checkpoints and reports truncation',async t=>{
  const {root,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const secret='export-secret-sentinel'; const run=await service.createRun({mission:'export',cwd:'/private/work',sensitiveValues:[secret]});
  await service.recordLog(run.id,{message:`${secret}${'x'.repeat(10000)}`}); await service.recordCheckpoint(run.id,{label:'cp',summary:'ok',operationKey:'cp'});
  const exported=await service.exportRun(run.id,{maxBytes:2500}); const text=JSON.stringify(exported);
  assert.equal(text.includes(secret),false); assert.equal(text.includes('/private/work'),false); assert.ok(Buffer.byteLength(text)<=2500); assert.equal(exported.truncated,true); assert.ok(exported.warnings.length);
  assert.equal(exported.metadata.id,run.id); assert.ok(Array.isArray(exported.checkpoints));
});

test('tampered operation intents fail closed without durable side effects',async t=>{
  const crypto=require('node:crypto'); const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const parent=await service.createRun({mission:'parent'}); const childInput={mission:'child',taskId:'task-1',operationKey:'child-op'};
  await service.createChildRun(parent.id,childInput);
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const childPath=path.join(root,parent.id,'operations',`child-${hash(childInput.operationKey)}.json`);
  const childIntent=JSON.parse(await fs.readFile(childPath,'utf8')); childIntent.payload.mission='tampered'; await fs.writeFile(childPath,JSON.stringify(childIntent));
  const before=(await store.readEvents(parent.id)).events.length;
  await assert.rejects(()=>service.createChildRun(parent.id,childInput),/operation intent corruption/);
  assert.equal((await store.readEvents(parent.id)).events.length,before);

  const cpInput={label:'safe',operationKey:'checkpoint-op'}; const cp=await service.recordCheckpoint(parent.id,cpInput);
  const cpPath=path.join(root,parent.id,'operations',`checkpoint-${hash(cpInput.operationKey)}.json`);
  const cpIntent=JSON.parse(await fs.readFile(cpPath,'utf8')); cpIntent.unknown=true; await fs.writeFile(cpPath,JSON.stringify(cpIntent));
  const cpBefore=(await store.readEvents(parent.id)).events.length;
  await assert.rejects(()=>service.recordCheckpoint(parent.id,cpInput),/operation intent corruption/);
  assert.equal((await store.readEvents(parent.id)).events.length,cpBefore);

  await service.restoreRuns(); await service.resumeFromCheckpoint(parent.id,cp.checkpointId,{operationKey:'resume-op'});
  const resumePath=path.join(root,parent.id,'operations',`resume-${hash('resume-op')}.json`);
  const resumeIntent=JSON.parse(await fs.readFile(resumePath,'utf8')); resumeIntent.eventId='evt-forged'; await fs.writeFile(resumePath,JSON.stringify(resumeIntent));
  const resumeBefore=(await store.readEvents(parent.id)).events.length;
  await assert.rejects(()=>service.resumeFromCheckpoint(parent.id,cp.checkpointId,{operationKey:'resume-op'}),/operation intent corruption/);
  assert.equal((await store.readEvents(parent.id)).events.length,resumeBefore);
});

test('operation intent timestamps are integrity-bound for child checkpoint and resume retries',async t=>{
  const crypto=require('node:crypto'); const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const parent=await service.createRun({mission:'parent'});
  const childInput={mission:'child',operationKey:'timestamp-child'}; await service.createChildRun(parent.id,childInput);
  const checkpointInput={label:'safe',operationKey:'timestamp-checkpoint'}; const checkpoint=await service.recordCheckpoint(parent.id,checkpointInput);
  await service.restoreRuns(); await service.resumeFromCheckpoint(parent.id,checkpoint.checkpointId,{operationKey:'timestamp-resume'});
  const cases=[
    ['child',childInput.operationKey,'createdAt',()=>service.createChildRun(parent.id,childInput)],
    ['checkpoint',checkpointInput.operationKey,'recordedAt',()=>service.recordCheckpoint(parent.id,checkpointInput)],
    ['resume','timestamp-resume','createdAt',()=>service.resumeFromCheckpoint(parent.id,checkpoint.checkpointId,{operationKey:'timestamp-resume'})]
  ];
  for(const [kind,key,timestamp,retry] of cases){
    const intentPath=path.join(root,parent.id,'operations',`${kind}-${hash(key)}.json`);
    const intent=JSON.parse(await fs.readFile(intentPath,'utf8')); intent[timestamp]='2026-07-11T00:00:00.000Z'; await fs.writeFile(intentPath,JSON.stringify(intent));
    const before=(await store.readEvents(parent.id)).events.length;
    await assert.rejects(retry,/operation intent corruption/);
    assert.equal((await store.readEvents(parent.id)).events.length,before);
  }
});

test('reserved deterministic child id collision is rejected without mutation or parent linkage',async t=>{
  const crypto=require('node:crypto'); const {root,store,service}=await fixture();t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const parent=await service.createRun({mission:'parent'}); const operationKey='collision-op';
  const reserved=`run-${crypto.createHash('sha256').update(`${parent.id}\0${operationKey}`).digest('hex').slice(0,32)}`;
  const unrelated={id:reserved,createdAt:'2026-07-01T00:00:00.000Z',mission:'unrelated',cwd:'~/',useVibes:false,llmPrefs:{},parentRunId:null,rootRunId:reserved,taskId:null,depth:0};
  await store.createRun(unrelated);
  await assert.rejects(()=>service.createChildRun(parent.id,{mission:'intended',operationKey}),/child id collision/);
  assert.deepEqual(await store.getRun(reserved),unrelated); assert.equal((await store.readEvents(reserved)).events.length,0);
  assert.equal((await store.readEvents(parent.id)).events.some(event=>event.type==='run.child_created'),false);
});

test('rename-complete deletion invalidates cache and startup reconciles quarantine safely',async t=>{
  const realFs=require('node:fs/promises'); const root=await realFs.mkdtemp(path.join(os.tmpdir(),'harness-quarantine-'));t.after(()=>realFs.rm(root,{recursive:true,force:true}));
  let failRm=true; const fsOps={...realFs,rm:async(target,options)=>{if(failRm&&path.basename(target).startsWith('.quarantine-')){const error=new Error('injected rm failure');error.code='EIO';throw error;}return realFs.rm(target,options);}};
  const store=new RunStore({root,fsOps}); let n=0; const service=new RunService({store,idGenerator:p=>`${p}-${++n}`,clock:()=>new Date('2026-07-12T00:00:00.000Z'),enableDestructiveRetention:true});
  const run=await service.createRun({mission:'cached'}); await service.terminateRun(run.id,{reason:'done'});
  const result=await service.pruneRuns({dryRun:false,maxCount:0}); assert.equal(result.results[0].status,'error'); assert.equal(result.results[0].renamed,true);
  await assert.rejects(()=>service.getRun(run.id),error=>error.code==='ENOENT');
  const quarantine=(await realFs.readdir(root)).find(name=>name.startsWith('.quarantine-')); assert.ok(quarantine);
  const outside=await realFs.mkdtemp(path.join(os.tmpdir(),'quarantine-outside-'));t.after(()=>realFs.rm(outside,{recursive:true,force:true}));
  const malicious='.quarantine-malicious-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; await realFs.symlink(outside,path.join(root,malicious)); failRm=false;
  const restored=await service.restoreRuns();
  assert.ok(restored.quarantine.results.some(item=>item.name===quarantine&&item.status==='deleted'));
  assert.ok(restored.quarantine.results.some(item=>item.name===malicious&&item.status==='rejected'));
  assert.equal((await realFs.lstat(path.join(root,malicious))).isSymbolicLink(),true);
});
