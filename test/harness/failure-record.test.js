'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {RunStore}=require('../../server/harness/run-store');
const {RunService}=require('../../server/harness/run-service');
const {toAgentProjection}=require('../../server/harness/agent-compat');

test('persists artifact validation evidence and verifier-grounded failure safely',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'failure-record-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let n=0;
 const store=new RunStore({root});const service=new RunService({store,idGenerator:p=>`${p}-${++n}`});
 const run=await service.createRun({mission:'verify'});await service.recordPlan(run.id,{tasks:[]});await service.approvePlan(run.id);await service.startExecution(run.id);await service.recordArtifact(run.id,{id:'report',path:'report.txt'});await service.claimExecutionComplete(run.id);await service.startVerification(run.id,{operationKey:'start'});
 await service.recordArtifactValidation(run.id,{artifactId:'report',path:'report.txt',valid:false,reason:'missing'});
 const failureRecord={terminalCause:'artifact_validation_failed',relevantAgentBehaviour:'execution claimed complete',exposedMechanism:'external verification gate',retryable:true,evidenceEventIds:[],humanNote:'operator note'};
 await service.finishVerification(run.id,{passed:false,cause:'artifact_validation_failed',reason:'artifact validation failed',failureRecord,operationKey:'finish'});
 const view=await service.getRun(run.id);assert.equal(view.status,'failed');assert.deepEqual(view.failure.failureRecord,failureRecord);assert.equal(view.artifacts[0].validation.valid,false);
 const events=(await store.readEvents(run.id)).events;assert.deepEqual(events.slice(-2).map(e=>e.type),['artifact.validated','verification.failed']);
 const disk=JSON.parse(await fs.readFile(path.join(root,run.id,'verification.json'),'utf8'));assert.deepEqual(disk.failureRecord,failureRecord);
 assert.equal(toAgentProjection(view).error,'artifact validation failed');
});

test('rejects malformed failure records rather than accepting agent-authored shapes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'failure-record-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let n=0;const service=new RunService({store:new RunStore({root}),idGenerator:p=>`${p}-${++n}`});
 const run=await service.createRun({});await service.recordPlan(run.id,{});await service.approvePlan(run.id);await service.startExecution(run.id);await service.claimExecutionComplete(run.id);await service.startVerification(run.id);
 await assert.rejects(()=>service.finishVerification(run.id,{passed:false,failureRecord:{terminalCause:'x'}}),/failure record/i);
});
