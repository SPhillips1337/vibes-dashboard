'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RunStore } = require('../../server/harness/run-store');
const { RunService } = require('../../server/harness/run-service');

function eventLine(runId, eventId, byteLength) {
  const event={schemaVersion:1,eventId,runId,type:'log.emitted',timestamp:'2026-07-12T12:00:00.000Z',actor:{type:'harness',id:'test'},data:{message:''}};
  const base=Buffer.byteLength(JSON.stringify(event));
  assert.ok(base<=byteLength);
  event.data.message='x'.repeat(byteLength-base);
  const line=JSON.stringify(event);
  assert.equal(Buffer.byteLength(line),byteLength);
  return line;
}

test('completes a valid record when maxBytes ends exactly before its newline', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'run-page-boundary-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new RunStore({root}); await store.createRun({id:'run-boundary',createdAt:new Date().toISOString()});
  const first=eventLine('run-boundary','exact-boundary',323); const second=eventLine('run-boundary','following',256);
  await fs.writeFile(path.join(root,'run-boundary','events.jsonl'),`${first}\n${second}\n`);
  const page=await store.readEventsPage('run-boundary',{cursor:0,limit:1,maxBytes:323});
  assert.deepEqual(page.items.map(item=>item.eventId),['exact-boundary']);
  assert.equal(page.nextCursor,324); assert.equal(page.hasMore,true); assert.ok(page.bytesRead<=323+64*1024+1);
  const following=await store.readEventsPage('run-boundary',{cursor:page.nextCursor,limit:1,maxBytes:323});
  assert.deepEqual(following.items.map(item=>item.eventId),['following']); assert.equal(following.hasMore,false);
});

test('completes one valid record larger than the soft byte budget', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'run-page-soft-budget-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new RunStore({root}); await store.createRun({id:'run-soft-budget',createdAt:new Date().toISOString()});
  const first=eventLine('run-soft-budget','larger-than-budget',323); const second=eventLine('run-soft-budget','following',256);
  await fs.writeFile(path.join(root,'run-soft-budget','events.jsonl'),`${first}\n${second}\n`);
  const page=await store.readEventsPage('run-soft-budget',{cursor:0,limit:1,maxBytes:100});
  assert.deepEqual(page.items.map(item=>item.eventId),['larger-than-budget']); assert.equal(page.nextCursor,324); assert.equal(page.hasMore,true);
  assert.ok(page.bytesRead>100); assert.ok(page.bytesRead<=100+64*1024+1);
  const following=await store.readEventsPage('run-soft-budget',{cursor:page.nextCursor,limit:1,maxBytes:100});
  assert.deepEqual(following.items.map(item=>item.eventId),['following']); assert.equal(following.hasMore,false);
});

test('discards one malformed bounded record past the soft budget without zero progress', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'run-page-malformed-budget-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new RunStore({root}); await store.createRun({id:'run-malformed-budget',createdAt:new Date().toISOString()});
  const malformed=`{"broken":"${'x'.repeat(300)}"`; const second=eventLine('run-malformed-budget','following',256);
  await fs.writeFile(path.join(root,'run-malformed-budget','events.jsonl'),`${malformed}\n${second}\n`);
  const page=await store.readEventsPage('run-malformed-budget',{cursor:0,limit:1,maxBytes:100});
  assert.deepEqual(page.items,[]); assert.equal(page.nextCursor,Buffer.byteLength(malformed)+1); assert.equal(page.hasMore,true);
  assert.ok(page.nextCursor>0); assert.ok(page.bytesRead<=100+64*1024+1); assert.match(page.warnings.join(' '),/Malformed/);
  const following=await store.readEventsPage('run-malformed-budget',{cursor:page.nextCursor,limit:1,maxBytes:100});
  assert.deepEqual(following.items.map(item=>item.eventId),['following']); assert.equal(following.hasMore,false);
});

test('event byte cursors advance across blank and malformed lines without duplicates', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-page-')); t.after(() => fs.rm(root,{recursive:true,force:true}));
  const store = new RunStore({root});
  await store.createRun({id:'run-page',createdAt:new Date().toISOString()});
  const event=i=>JSON.stringify({schemaVersion:1,eventId:`e${i}`,runId:'run-page',type:'log.emitted',timestamp:new Date().toISOString(),actor:{type:'harness',id:'test'},data:{message:String(i)}});
  await fs.writeFile(path.join(root,'run-page','events.jsonl'),`${[event(0),'','not-json',event(1),event(2)].join('\n')}\n`);
  const seen=[]; let cursor=0; let hasMore=true;
  while(hasMore){ const page=await store.readEventsPage('run-page',{cursor,limit:1,maxBytes:1024*1024}); seen.push(...page.items.map(item=>item.eventId)); assert.ok(page.nextCursor>cursor); cursor=page.nextCursor; hasMore=page.hasMore; }
  assert.deepEqual(seen,['e0','e1','e2']);
});

test('oversized records are discarded incrementally and bounded pages eventually reach later events', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'run-huge-page-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new RunStore({root}); await store.createRun({id:'run-huge',createdAt:new Date().toISOString()});
  const valid=JSON.stringify({schemaVersion:1,eventId:'after-huge',runId:'run-huge',type:'log.emitted',timestamp:new Date().toISOString(),actor:{type:'harness',id:'test'},data:{message:'✓'}});
  await fs.writeFile(path.join(root,'run-huge','events.jsonl'),`${'x'.repeat(2_100_000)}\n${valid}\n`);
  let cursor=0; let calls=0; const found=[];
  do { const page=await store.readEventsPage('run-huge',{cursor,limit:1,maxBytes:128*1024}); calls++; assert.ok(page.bytesRead<=128*1024); if(!page.items.length) assert.equal(page.hasMore,true); assert.ok(page.nextCursor>cursor); cursor=page.nextCursor; found.push(...page.items); } while(!found.length && calls<30);
  assert.equal(found[0].eventId,'after-huge'); assert.ok(calls>1);
  const final=await store.readEventsPage('run-huge',{cursor,limit:1,maxBytes:128*1024}); assert.equal(final.hasMore,false);
});

test('paginated run listing replays only selected histories', async () => {
  const metadata = Array.from({length:3},(_,i)=>({id:`run-${i}`,createdAt:new Date(1700000000000-i*1000).toISOString()}));
  const reads=[];
  const store={listRuns:async()=>metadata,getRun:async id=>metadata.find(item=>item.id===id),readEvents:async id=>{reads.push(id);return{events:[],warnings:[]};}};
  const service=new RunService({store});
  const page=await service.listRuns({offset:1,limit:1});
  assert.deepEqual(page.items.map(item=>item.id),['run-1']); assert.deepEqual(reads,['run-1']);
});

test('evidence scan is bounded without loading the complete event history', async () => {
  const calls=[];
  const events=Array.from({length:6000},(_,i)=>({eventId:`e${i}`,type:i%2?'verification.check_recorded':'log.emitted',data:{command:'test'}}));
  const store={readEventsPage:async(_id,options)=>{calls.push(options);const start=options.cursor||0;const items=events.slice(start,start+options.limit);return{items,nextCursor:start+items.length,hasMore:start+items.length<events.length,warnings:[],bytesRead:items.length*10};}};
  const service=new RunService({store}); const evidence=await service.getRunEvidence('run-1');
  assert.equal(evidence.truncated,true); assert.equal(evidence.checks.length,200); assert.equal(calls.at(-1).cursor <= 5000,true);
});

test('evidence truncation distinguishes exactly 200 items from an encountered 201st item', async () => {
  const makeStore=count=>({readEventsPage:async(_id,{cursor=0,limit})=>{const all=Array.from({length:count},(_,i)=>({eventId:`e${i}`,type:'verification.check_recorded',data:{}}));const items=all.slice(cursor,cursor+limit);return{items,nextCursor:cursor+items.length,hasMore:cursor+items.length<all.length,warnings:[],bytesRead:items.length};}});
  assert.equal((await new RunService({store:makeStore(200)}).getRunEvidence('r')).truncated,false);
  assert.equal((await new RunService({store:makeStore(201)}).getRunEvidence('r')).truncated,true);
});

test('read APIs return deterministic bounded pages and evidence linked to event ids', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-read-api-')); t.after(() => fs.rm(root,{recursive:true,force:true}));
  let n=0; const service=new RunService({store:new RunStore({root}),clock:()=>new Date(1700000000000+n*1000),idGenerator:p=>`${p}-${++n}`});
  const older=await service.createRun({mission:'older'}); const newer=await service.createRun({mission:'newer'});
  const listed=await service.listRuns({offset:0,limit:1});
  assert.equal(listed.total,2); assert.equal(listed.items[0].id,newer.id); assert.equal(listed.hasMore,true);
  await service.recordPlan(older.id,{summary:'x'}); await service.approvePlan(older.id); await service.startExecution(older.id); await service.claimExecutionComplete(older.id); await service.startVerification(older.id);
  const check=await service.recordVerificationCheck(older.id,{command:['npm','test'],stdout:'ok'});
  const artifact=await service.recordArtifactValidation(older.id,{path:'dist/app.js',size:3,sha256:'abc',valid:true});
  await service.finishVerification(older.id,{passed:false,failureRecord:{terminalCause:'tests',relevantAgentBehaviour:'failed',exposedMechanism:'exit',retryable:true,evidenceEventIds:[check.eventId,artifact.eventId]}});
  const events=await service.getRunEvents(older.id,{offset:1,limit:2});
  assert.equal(events.items.length,2); assert.equal(events.offset,1); assert.equal(events.items[0].type,'plan.requested');
  const evidence=await service.getRunEvidence(older.id);
  assert.equal(evidence.status,'failed'); assert.equal(evidence.demo,false); assert.equal(evidence.checks[0].eventId,check.eventId); assert.equal(evidence.artifacts[0].eventId,artifact.eventId);
  assert.deepEqual(evidence.failureRecord.evidenceEventIds,[check.eventId,artifact.eventId]);
});
