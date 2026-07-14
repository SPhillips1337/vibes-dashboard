'use strict';

const crypto = require('node:crypto');
const { projectRun } = require('./run-projector');
const { redactEvent } = require('./event-contract');

const TERMINAL = new Set(['completed', 'failed', 'terminated']);
const INTERRUPTIBLE = new Set(['planning', 'executing', 'verifying']);
const SAFE_LLM_FIELDS = ['provider', 'hostUrl', 'model', 'maxTokens'];
const FAILURE_FIELDS = ['terminalCause','relevantAgentBehaviour','exposedMechanism'];
const MAX_VERIFICATION_OUTPUT_BYTES = 16 * 1024;
const MAX_VERIFICATION_ITEMS = 16;
const MAX_VERIFICATION_DOCUMENT_BYTES = 128 * 1024;
const ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_CHILD_DEPTH=4;

function validateFailureRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || FAILURE_FIELDS.some(field => typeof value[field] !== 'string' || !value[field]) ||
      typeof value.retryable !== 'boolean' || !Array.isArray(value.evidenceEventIds) || value.evidenceEventIds.some(id => typeof id !== 'string') ||
      (value.humanNote !== undefined && typeof value.humanNote !== 'string')) throw new TypeError('failure record is invalid');
  return value;
}

class RunService {
  constructor({ store, clock = () => new Date(), idGenerator = prefix => `${prefix}-${crypto.randomUUID()}`, emit = () => {}, onEmitError = () => {}, enableDestructiveRetention=false } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store; this.clock = clock; this.idGenerator = idGenerator; this.emit = emit; this.onEmitError = onEmitError;
    this.cache = new Map(); this.queues = new Map(); this.warnings = new Map(); this.sensitiveValues = new Map(); this.enableDestructiveRetention=enableDestructiveRetention;
  }

  createRun(input = {}) { return this._serial('__create__', async () => {
    if (input.parentRunId !== undefined || input.rootRunId !== undefined || input.depth !== undefined || input.taskId !== undefined) throw new TypeError('parent metadata requires createChildRun');
    const id = this.idGenerator('run'); const createdAt = this._now();
    const sensitiveValues = Array.isArray(input.sensitiveValues) ? input.sensitiveValues : [];
    this.sensitiveValues.set(id, sensitiveValues);
    const llmPrefs = input.llmPrefs && typeof input.llmPrefs === 'object'
      ? Object.fromEntries(SAFE_LLM_FIELDS.filter(key => input.llmPrefs[key] !== undefined).map(key => [key, input.llmPrefs[key]])) : {};
    const metadata = redactEvent({ id, createdAt, mission: input.mission || 'Unnamed Mission', cwd: input.cwd || '~/', useVibes: Boolean(input.useVibes), llmPrefs, parentRunId:null, rootRunId:id, taskId:null, depth:0 }, sensitiveValues);
    await this.store.createRun(metadata); this.cache.set(id, { metadata, events: [] });
    await this._append(id, 'run.created', { parentRunId: metadata.parentRunId, childRunIds: input.childRunIds || [] });
    await this._append(id, 'plan.requested', {});
    return this.getRun(id);
  }); }

  createChildRun(parentId,input={}) { return this._serial(`children:${parentId}`,async()=>{
    if(!ID_PATTERN.test(parentId||'')) throw new TypeError('invalid parent run id');
    if(typeof input.operationKey!=='string'||!input.operationKey||input.operationKey.length>128) throw new TypeError('child operationKey is required');
    if(input.taskId!==undefined&&!ID_PATTERN.test(input.taskId||'')) throw new TypeError('invalid child task id');
    const parent=await this._getRunBase(parentId);
    if(parent.depth>=MAX_CHILD_DEPTH) throw new RangeError('maximum child depth exceeded');
    const payload={mission:input.mission||'Unnamed Child Mission',cwd:input.cwd||parent.cwd||'~/',useVibes:Boolean(input.useVibes),llmPrefs:Object.fromEntries(SAFE_LLM_FIELDS.filter(k=>input.llmPrefs?.[k]!==undefined).map(k=>[k,input.llmPrefs[k]])),taskId:input.taskId||null};
    const fingerprint=sha256(stableJson(payload)); const keyHash=sha256(input.operationKey);
    const intentName=`operations/child-${keyHash}.json`; const childId=`run-${sha256(`${parentId}\0${input.operationKey}`).slice(0,32)}`;
    const ids={childId,createdEventId:`evt-${sha256(`${childId}:created`).slice(0,32)}`,planEventId:`evt-${sha256(`${childId}:plan`).slice(0,32)}`,parentEventId:`evt-${sha256(`${parentId}:child:${keyHash}`).slice(0,32)}`};
    let intent; try{intent=await this.store.readDocument(parentId,intentName);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(intent) validateOperationIntent('child',intent,{runId:parentId,keyHash,payload,ids});
    if(intent&&intent.fingerprint!==fingerprint) throw new Error('child operation key conflicts with payload');
    intent=intent||operationIntent({schemaVersion:1,kind:'child-create',parentRunId:parentId,operationKeyHash:keyHash,fingerprint,...ids,payload,createdAt:this._now()});
    const lineage={parentRunId:parentId,rootRunId:parent.rootRunId||parent.id,depth:parent.depth+1};
    const metadata={id:childId,createdAt:intent.createdAt,...payload,...lineage};
    if(!await this._runExists(childId)){
      await this.store.writeDocument(parentId,intentName,intent);
      await this.store.createRun(metadata); this.cache.set(childId,{metadata,events:[]});
    } else {
      const existing=await this.store.getRun(childId);
      if(stableJson(existing)!==stableJson(metadata)) throw new Error('child id collision with unrelated run');
    }
    await this._appendDeterministic(childId,'run.created',{parentRunId:parentId,rootRunId:lineage.rootRunId,taskId:payload.taskId,depth:lineage.depth},intent.createdEventId);
    await this._appendDeterministic(childId,'plan.requested',{},intent.planEventId);
    await this._appendDeterministic(parentId,'run.child_created',{childRunId:childId,taskId:payload.taskId,attempt:parent.attempt||1,operationKey:input.operationKey},intent.parentEventId);
    const id=childId;
    return this.getRun(id);
  }); }

  recordPlan(id, plan) {
    if(plan?.requiredChildRunIds!==undefined&&(!Array.isArray(plan.requiredChildRunIds)||plan.requiredChildRunIds.length>100||plan.requiredChildRunIds.some(childId=>typeof childId!=='string'||!ID_PATTERN.test(childId)))) return Promise.reject(new TypeError('required child run ids are invalid'));
    return this._transition(id, ['planning','awaiting_approval'], 'plan.proposed', { plan }, async clean => this.store.writeDocument(id, 'plan.json', clean.plan), true);
  }
  approvePlan(id, data={}) { return this._transition(id, ['awaiting_approval'], 'plan.approved', data, null, true); }
  declinePlan(id, data={}) { return this._transition(id, ['awaiting_approval'], 'plan.declined', data, null, true); }
  startExecution(id, data={}) { return this._transition(id, ['awaiting_approval','interrupted'], 'execution.started', data, null, true); }
  failExecution(id, data={}) { return this._transition(id, ['planning','awaiting_approval','executing','verifying','blocked','interrupted'], 'execution.failed', data, null, true); }
  retryRun(id, data={}) { return this._transition(id, ['failed','interrupted','verifying','blocked','executing'], 'execution.retry_requested', data, null, true); }
  retryFromIntervention(id, data={}) { return this._serial(id, async () => {
    const clean=this.redactForRun(id, data || {});
    if (clean.operationKey && this._has(id,'execution.retry_requested',clean)) return this.getRun(id);
    const view=await this.getRun(id);
    const intervention=view.interventions?.find(item=>item.id===clean.interventionId && item.status==='requested');
    if (view.status!=='blocked' || !intervention) throw new Error('retry requires a blocked run with requested intervention');
    const events = [
      this._event(id,'intervention.resolved',{interventionId:clean.interventionId,action:'retry',taskId:clean.fromTaskId}),
      this._event(id,'execution.retry_requested',clean)
    ];
    await this.store.appendEvents(id,events);
    await this._commitEvents(id,events);
    return this.getRun(id);
  }); }
  recordLog(id, data) { return this._transition(id, ['planning','awaiting_approval','executing','verifying','blocked','interrupted'], 'log.emitted', typeof data === 'string' ? {message:data} : data); }
  claimExecutionComplete(id, data={}) { return this._transition(id, ['executing'], 'execution.claimed_complete', data, null, true); }
  recordArtifact(id, artifact) { return this._transition(id, ['executing','verifying','blocked'], 'artifact.declared', { artifact }, null, true); }
  recordArtifactValidation(id, validation) { return this._transitionWithEvent(id, ['verifying'], 'artifact.validated', boundArtifactEvidence(validation), null, true); }
  recordVerificationCheck(id, check) { return this._transitionWithEvent(id, ['verifying'], 'verification.check_recorded', boundCheckEvidence(check), null, true); }
  startVerification(id, data={}) { return this._transition(id, ['verifying'], 'verification.started', data, null, true); }
  finishVerification(id, result={}) { return this._serial(id, async () => {
    const view=await this.getRun(id);
    const clean=this.redactForRun(id, boundVerificationResult(result || {}));
    const type=clean.passed === true ? 'verification.passed' : 'verification.failed';
    const existing=this.cache.get(id)?.events.find(event=>event.type===type && clean.operationKey && event.data?.operationKey===clean.operationKey);
    if(existing){
      if(JSON.stringify(existing.data)!==JSON.stringify(clean)) throw new Error('verification operation key conflicts with terminal result');
      await this.store.writeDocument(id,'verification.json',boundVerificationDocument(existing.data));
      return view;
    }
    if (view.verification.status !== 'running' || view.status !== 'verifying') throw new Error(`illegal transition from ${view.status} via ${type}`);
    if (clean.passed !== true) validateFailureRecord(clean.failureRecord);
    if (this._has(id,type,clean)) {
      await this.store.writeDocument(id,'verification.json',boundVerificationDocument(clean));
      return view;
    }
    const event=this._event(id,type,clean);
    await this.store.appendEvent(id,event);
    const projected=await this._commitEvents(id,[event]);
    await this.store.writeDocument(id, 'verification.json', boundVerificationDocument(clean));
    return projected;
  }); }
  requestIntervention(id, intervention) { return this._transition(id, ['planning','awaiting_approval','executing','verifying'], 'intervention.requested', { intervention: { id: intervention.id || this.idGenerator('intervention'), ...intervention } }); }
  resolveIntervention(id, resolution) { return this._transition(id, ['blocked'], 'intervention.resolved', resolution, null, true); }
  async terminateRun(id, data={}) { const run=await this._transition(id, ['created','planning','awaiting_approval','executing','verifying','blocked','interrupted'], 'run.terminated', data, null, true); this.sensitiveValues.delete(id); return run; }

  registerSensitiveValues(id, values) { this.sensitiveValues.set(id, [...new Set([...(this.sensitiveValues.get(id)||[]),...(Array.isArray(values)?values:[])].filter(value=>typeof value==='string'&&value))]); }
  redactForRun(id, value) { return redactEvent(value, this.sensitiveValues.get(id) || []); }

  recordTaskStatus(id, task = {}) {
    const status = task.status;
    const type = status === 'complete' || status === 'completed' ? 'task.completed' : status === 'failed' ? 'task.failed' : 'task.started';
    const taskId = String(task.id ?? task.taskId ?? task.name ?? '');
    return this._transition(id, ['executing'], type, { taskId, task: { id: taskId, title: task.name || task.title, description: task.description } }, null, true);
  }

  async getRun(id) {
    const view=await this._getRunBase(id); const ids=(view.childRunIds||[]).slice(0,100); const children=[];
    for(let index=0;index<ids.length;index+=8){
      const batch=await Promise.all(ids.slice(index,index+8).map(childId=>this._childOutcome(childId).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
      children.push(...batch.filter(Boolean));
    }
    const counts={}; for(const child of children) counts[child.status]=(counts[child.status]||0)+1;
    return {...view,children,childSummary:{total:(view.childRunIds||[]).length,displayed:children.length,counts,truncated:(view.childRunIds||[]).length>100}};
  }
  async _childOutcome(childId){
    const child=await this._getRunBase(childId); const terminal=[...(this.cache.get(childId)?.events||[])].reverse().find(event=>['verification.passed','verification.failed','execution.failed','run.terminated'].includes(event.type));
    return {id:child.id,taskId:child.taskId,status:child.status,verificationStatus:child.verification?.status||'pending',attempt:child.attempt,elapsedMs:Math.max(0,(Date.parse(terminal?.timestamp||this._now())||0)-(Date.parse(child.createdAt)||0)),artifactCount:Array.isArray(child.artifacts)?child.artifacts.length:0,evidence:{checkCount:Array.isArray(child.verificationChecks)?child.verificationChecks.length:0,artifactCount:Array.isArray(child.artifactValidations)?child.artifactValidations.length:0}};
  }
  async getChildOutcomes(parentId,requiredIds=[]){
    if(!Array.isArray(requiredIds)||requiredIds.length>100||requiredIds.some(id=>typeof id!=='string'||!ID_PATTERN.test(id))) throw new TypeError('required child ids are invalid');
    const parent=await this._getRunBase(parentId); const linked=new Set(parent.childRunIds||[]); const outcomes=new Map();
    for(let index=0;index<requiredIds.length;index+=8){
      const slice=requiredIds.slice(index,index+8); const values=await Promise.all(slice.map(id=>linked.has(id)?this._childOutcome(id).catch(error=>error.code==='ENOENT'?null:Promise.reject(error)):null));
      slice.forEach((id,i)=>outcomes.set(id,values[i]));
    }
    return outcomes;
  }
  async _getRunBase(id) { const entry=await this._load(id); return { ...projectRun(entry.metadata, entry.events), warnings: [...(this.warnings.get(id)||[])] }; }

  recordCheckpoint(id,input={}) { return this._serial(id,async()=>{
    const ids=value=>Array.isArray(value)&&value.length<=100&&value.every(item=>ID_PATTERN.test(item));
    if(typeof input.operationKey!=='string'||!input.operationKey||input.operationKey.length>128||typeof input.label!=='string'||!input.label||input.label.length>128||(input.summary!==undefined&&(typeof input.summary!=='string'||input.summary.length>4096))||!ids(input.completedTaskIds||[])||!ids(input.artifactEventIds||[])||(input.gitRef!==undefined&&input.gitRef!==null&&(typeof input.gitRef!=='string'||input.gitRef.length>256))) throw new TypeError('checkpoint metadata is invalid');
    const dirtyState=boundStrings(input.dirtyState??null,512);
    if(dirtyState!==null&&(typeof dirtyState!=='object'||Array.isArray(dirtyState))) throw new TypeError('checkpoint dirty state is invalid');
    const payload={label:input.label,summary:input.summary||'',completedTaskIds:[...(input.completedTaskIds||[])],artifactEventIds:[...(input.artifactEventIds||[])],gitRef:input.gitRef??null,dirtyState};
    const fingerprint=sha256(stableJson(payload)); const keyHash=sha256(input.operationKey); const intentName=`operations/checkpoint-${keyHash}.json`;
    let intent; try{intent=await this.store.readDocument(id,intentName);}catch(error){if(error.code!=='ENOENT')throw error;}
    const checkpointId=`checkpoint-${sha256(`${id}\0${input.operationKey}`).slice(0,32)}`;
    const eventId=`evt-${sha256(`${id}:checkpoint:${keyHash}`).slice(0,32)}`;
    if(intent) validateOperationIntent('checkpoint',intent,{runId:id,keyHash,payload,ids:{checkpointId,eventId}});
    if(intent&&intent.fingerprint!==fingerprint) throw new Error('checkpoint operation key conflicts with payload');
    intent=intent||operationIntent({schemaVersion:1,kind:'checkpoint',runId:id,operationKeyHash:keyHash,fingerprint,checkpointId,eventId,payload,recordedAt:this._now()});
    await this.store.writeDocument(id,intentName,intent);
    const checkpoint={id:intent.checkpointId,...intent.payload,operationKey:input.operationKey,recordedAt:intent.recordedAt,mode:'metadata-only',eventId:intent.eventId};
    await this._appendDeterministic(id,'checkpoint.recorded',{checkpoint},intent.eventId);
    await this.store.writeDocument(id,`checkpoints/${checkpoint.id}.json`,checkpoint);
    const view=await this._getRunBase(id); await this.store.writeDocument(id,'checkpoints/manifest.json',{checkpoints:view.checkpoints});
    return {checkpointId:checkpoint.id,run:await this.getRun(id)};
  }); }

  resumeFromCheckpoint(id,checkpointId,{operationKey}={}) { return this._serial(id,async()=>{
    if(typeof operationKey!=='string'||!operationKey||operationKey.length>128) throw new TypeError('resume operationKey is required');
    const view=await this._getRunBase(id); const checkpoint=view.checkpoints.find(item=>item.id===checkpointId);
    if(!checkpoint) throw new TypeError('checkpoint does not belong to run');
    const payload={checkpointId,mode:'checkpoint'}; const fingerprint=sha256(stableJson(payload)); const keyHash=sha256(operationKey);
    const intentName=`operations/resume-${keyHash}.json`; let intent;
    try{intent=await this.store.readDocument(id,intentName);}catch(error){if(error.code!=='ENOENT')throw error;}
    const eventId=`evt-${sha256(`${id}:resume:${keyHash}`).slice(0,32)}`;
    if(intent) validateOperationIntent('resume',intent,{runId:id,keyHash,payload,ids:{eventId}});
    if(intent&&intent.fingerprint!==fingerprint) throw new Error('resume operation key conflicts with payload');
    if(!intent&&!['interrupted','blocked'].includes(view.status)) throw new Error(`resume requires interrupted or blocked run, not ${view.status}`);
    intent=intent||operationIntent({schemaVersion:1,kind:'resume',runId:id,operationKeyHash:keyHash,fingerprint,payload,eventId,createdAt:this._now()});
    await this.store.writeDocument(id,intentName,intent);
    await this._appendDeterministic(id,'execution.retry_requested',{...payload,operationKey},intent.eventId);
    return this.getRun(id);
  }); }

  async evaluateRequiredChildren(parentId,requiredIds=[]) {
    const outcomes=await this.getChildOutcomes(parentId,requiredIds); const evidence=[];
    for(const id of requiredIds){
      const child=outcomes.get(id);
      if(!child) return {passed:false,evidence,reason:`required child ${id} is not linked or missing`};
      evidence.push({runId:id,status:child.status,verificationStatus:child.verificationStatus,elapsedMs:child.elapsedMs,artifactCount:child.artifactCount});
      if(child.status!=='completed'||child.verificationStatus!=='passed') return {passed:false,evidence,reason:`required child ${id} failed or is unverified`};
    }
    return {passed:true,evidence};
  }

  async getRunChildren(parentId,{offset=0,limit=100}={}) {
    const parent=await this._getRunBase(parentId); const all=parent.childRunIds||[]; const selected=all.slice(offset,offset+Math.min(100,limit)); const items=[];
    for(let index=0;index<selected.length;index+=8) items.push(...(await Promise.all(selected.slice(index,index+8).map(id=>this._childOutcome(id).catch(error=>error.code==='ENOENT'?null:Promise.reject(error))))).filter(Boolean));
    return {items,total:all.length,offset,limit:Math.min(100,limit),hasMore:offset+selected.length<all.length,truncated:all.length>100};
  }

  async pruneRuns({dryRun=true,maxCount=Infinity,maxAgeMs=Infinity,maxBytes=Infinity,now=Date.now()}={}) {
    if(dryRun===false&&!this.enableDestructiveRetention) throw new Error('destructive retention is disabled');
    if(![maxCount,maxAgeMs,maxBytes].every(value=>value===Infinity||(Number.isSafeInteger(value)&&value>=0))) throw new TypeError('invalid retention policy');
    const quarantine=await this.store.reconcileQuarantine({dryRun});
    const metadata=await this.store.listRuns(); const runs=[]; for(const item of metadata) runs.push(await this.getRun(item.id));
    const byId=new Map(runs.map(run=>[run.id,run])); const protectedIds=new Set(runs.filter(run=>!TERMINAL.has(run.status)).map(run=>run.id));
    let changed=true; while(changed){changed=false;for(const run of runs){const related=[run.parentRunId,...(run.childRunIds||[])].filter(Boolean);if(protectedIds.has(run.id)||related.some(id=>protectedIds.has(id))){if(!protectedIds.has(run.id)){protectedIds.add(run.id);changed=true;}for(const id of related)if(byId.has(id)&&!protectedIds.has(id)){protectedIds.add(id);changed=true;}}}}
    const terminal=runs.filter(run=>TERMINAL.has(run.status)); const reasons=new Map();
    if(Number.isFinite(maxCount)) terminal.slice(Math.max(0,maxCount)).forEach(run=>reasons.set(run.id,new Set(['maxCount'])));
    if(Number.isFinite(maxAgeMs)) terminal.filter(run=>now-Date.parse(run.createdAt)>=maxAgeMs).forEach(run=>{if(!reasons.has(run.id))reasons.set(run.id,new Set());reasons.get(run.id).add('maxAgeMs');});
    if(Number.isFinite(maxBytes)){let used=0;for(const run of terminal){const size=await this.store.runSize(run.id,{maxBytes:Math.max(maxBytes+1,1024)});used+=size.bytes;if(used>maxBytes){if(!reasons.has(run.id))reasons.set(run.id,new Set());reasons.get(run.id).add('maxBytes');}}}
    const eligible=terminal.filter(run=>reasons.has(run.id)&&!protectedIds.has(run.id)).map(run=>run.id); const results=[]; const deleted=[];
    for(const id of eligible){if(dryRun){results.push({id,status:'eligible'});continue;}try{await this.store.deleteRun(id);this.cache.delete(id);this.warnings.delete(id);deleted.push(id);results.push({id,status:'deleted'});}catch(error){if(error.renamed){this.cache.delete(id);this.warnings.delete(id);this.sensitiveValues.delete(id);}results.push({id,status:'error',error:error.message,renamed:Boolean(error.renamed),quarantineName:error.quarantineName});}}
    return {dryRun,eligible,deleted,results,reasons:Object.fromEntries(eligible.map(id=>[id,[...reasons.get(id)]])),quarantine,warnings:[...(quarantine.warnings||[])]};
  }

  async exportRun(id,{maxBytes=256*1024}={}) {
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>2*1024*1024) throw new TypeError('invalid export bound');
    const run=await this.getRun(id); const metadata=boundStrings({...run},512); for(const key of ['cwd','logs','events','children']) delete metadata[key];
    let events=(await this.store.readEvents(id)).events.slice(0,200).map(event=>boundStrings(this.redactForRun(id,event),512));
    let evidence=boundStrings(await this.getRunEvidence(id,{maxEvents:500,maxBytes:Math.min(maxBytes,256*1024)}),512);
    let checkpoints=run.checkpoints.slice(0,100).map(item=>boundStrings(item,512));
    const output={schemaVersion:1,metadata,events,evidence,checkpoints,truncated:false,warnings:[]};
    const size=()=>Buffer.byteLength(JSON.stringify(output)); const mark=()=>{output.truncated=true;if(!output.warnings.length)output.warnings.push('Export truncated to configured byte limit.');};
    while(size()>maxBytes&&events.length){events.pop();mark();}
    while(size()>maxBytes&&Array.isArray(evidence.checks)&&evidence.checks.length){evidence.checks.pop();mark();}
    while(size()>maxBytes&&Array.isArray(evidence.artifacts)&&evidence.artifacts.length){evidence.artifacts.pop();mark();}
    while(size()>maxBytes&&checkpoints.length){checkpoints.pop();mark();}
    if(size()>maxBytes){output.metadata={id:truncateUtf8(run.id,128),status:truncateUtf8(run.status,32)};output.events=[];output.evidence={status:truncateUtf8(run.verification?.status||'pending',32),truncated:true};output.checkpoints=[];mark();}
    if(size()>maxBytes){const tiny={schemaVersion:1,runId:truncateUtf8(run.id,128),truncated:true,warnings:['Export exceeded detail budget.']};if(Buffer.byteLength(JSON.stringify(tiny))>maxBytes)throw new RangeError('export envelope cannot fit configured bound');return tiny;}
    return output;
  }
  async listRuns(options) {
    const metadata = await this.store.listRuns();
    const load=async selected=>{const runs=[];for(let index=0;index<selected.length;index+=16) runs.push(...await Promise.all(selected.slice(index,index+16).map(run=>this.getRun(run.id))));return runs;};
    if (!options) return load(metadata);
    const { offset = 0, limit = 25 } = options;
    const selected = metadata.slice(offset, offset + limit);
    const runs = await load(selected);
    const warnings=[...(metadata.warnings||[])];
    return { items: runs, total: metadata.length, offset, limit, hasMore: offset + limit < metadata.length, scanTruncated:Boolean(metadata.scanTruncated), warnings };
  }
  async getRunEvents(id, { cursor, offset, limit = 100 } = {}) {
    const start = cursor ?? offset ?? 0;
    const page = await this.store.readEventsPage(id, { cursor: start, limit, maxBytes: 2 * 1024 * 1024 });
    return { items: structuredClone(page.items), cursor: start, offset: start, limit, nextCursor: page.nextCursor, nextOffset: page.nextCursor, hasMore: page.hasMore, warnings: [...page.warnings], truncated: page.hasMore && page.bytesRead >= 2 * 1024 * 1024 };
  }
  async getRunEvidence(id, { maxEvents = 5000, maxBytes = 8 * 1024 * 1024 } = {}) {
    const checks=[]; const artifacts=[]; const warnings=[]; let terminal=null; let started=null;
    let cursor=0; let scanned=0; let bytes=0; let hasMore=true; let checkOverflow=false; let artifactOverflow=false;
    while (hasMore && scanned < maxEvents && bytes < maxBytes) {
      const limit=Math.min(200,maxEvents-scanned);
      const page=await this.store.readEventsPage(id,{cursor,limit,maxBytes:Math.min(2*1024*1024,maxBytes-bytes)});
      for(const event of page.items){
        scanned++;
        if(event.type==='verification.check_recorded') {
          if(checks.length<200) checks.push({eventId:event.eventId,...structuredClone(event.data)}); else checkOverflow=true;
        } else if(event.type==='artifact.validated') {
          if(artifacts.length<200) artifacts.push({eventId:event.eventId,...structuredClone(event.data)}); else artifactOverflow=true;
        }
        if(event.type==='verification.started') started=event;
        if(event.type==='verification.passed'||event.type==='verification.failed') terminal=event;
      }
      bytes+=page.bytesRead||0; warnings.push(...(page.warnings||[])); hasMore=page.hasMore;
      const next=page.nextCursor ?? page.nextOffset;
      if(!Number.isSafeInteger(next) || next<=cursor) break;
      cursor=next;
    }
    const truncated=hasMore || checkOverflow || artifactOverflow;
    if(truncated) warnings.push('Evidence scan reached its bounded read limit.');
    return { status: terminal ? (terminal.type === 'verification.passed' ? 'passed' : 'failed') : (started ? 'running' : 'pending'), demo: Boolean(terminal?.data?.demo_fixture_only), checks, artifacts, failureRecord: terminal?.data?.failureRecord || null, terminalEventId: terminal?.eventId || null, truncated, warnings, scannedEvents:scanned };
  }
  async restoreRuns() {
    const quarantine=await this.store.reconcileQuarantine({dryRun:false});
    const metadata = await this.store.listRuns(); const restored=[];
    for (const run of metadata) {
      const read = await this.store.readEvents(run.id); this.cache.set(run.id,{metadata:run,events:read.events}); this.warnings.set(run.id,read.warnings);
      const terminalVerification=[...read.events].reverse().find(event=>event.type==='verification.passed'||event.type==='verification.failed');
      if(terminalVerification) await this.store.writeDocument(run.id,'verification.json',boundVerificationDocument(terminalVerification.data));
      const view = projectRun(run,read.events);
      for(const checkpoint of view.checkpoints||[]) await this.store.writeDocument(run.id,`checkpoints/${checkpoint.id}.json`,checkpoint);
      if(view.checkpoints?.length) await this.store.writeDocument(run.id,'checkpoints/manifest.json',{checkpoints:view.checkpoints});
      if (INTERRUPTIBLE.has(view.status)) await this._append(run.id,'run.restored',{interrupted:true,previousStatus:view.status});
      restored.push(await this.getRun(run.id));
    }
    Object.defineProperty(restored,'quarantine',{value:quarantine,enumerable:true});
    Object.defineProperty(restored,'warnings',{value:[...(quarantine.warnings||[]),...(metadata.warnings||[])],enumerable:true});
    return restored;
  }

  async _transition(id, allowed, type, data, before, idempotent=false, guard=null) { return this._serial(id, async () => {
    const view=await this.getRun(id); const clean=this.redactForRun(id, data || {});
    if (guard && !guard(view)) throw new Error(`illegal transition from ${view.status} via ${type}`);
    if (!allowed.includes(view.status)) {
      if (idempotent && this._has(id,type,clean)) return view;
      throw new Error(`illegal transition from ${view.status} via ${type}`);
    }
    if (idempotent && this._has(id,type,clean)) return view;
    if (before) await before(clean);
    await this._append(id,type,clean); return this.getRun(id);
  }); }
  async _transitionWithEvent(id, allowed, type, data, before, idempotent=false, guard=null) { return this._serial(id, async () => {
    const view=await this.getRun(id); const clean=this.redactForRun(id, data || {});
    if (guard && !guard(view)) throw new Error(`illegal transition from ${view.status} via ${type}`);
    if (!allowed.includes(view.status)) {
      if (idempotent && this._has(id,type,clean)) return { eventId: null, run: view };
      throw new Error(`illegal transition from ${view.status} via ${type}`);
    }
    if (idempotent && this._has(id,type,clean)) return { eventId: null, run: view };
    if (before) await before(clean);
    const event=this._event(id,type,clean);
    await this.store.appendEvent(id,event);
    const run=await this._commitEvents(id,[event]);
    return { eventId: event.eventId, run };
  }); }
  async _append(id,type,data) {
    const event=this._event(id,type,data);
    await this.store.appendEvent(id,event);
    return this._commitEvents(id,[event]);
  }
  async _appendDeterministic(id,type,data,eventId){
    const entry=await this._load(id); let existing=entry.events.find(event=>event.eventId===eventId);
    if(!existing){const disk=await this.store.readEvents(id);existing=disk.events.find(event=>event.eventId===eventId);if(existing&&!entry.events.some(event=>event.eventId===eventId))entry.events.push(existing);}
    if(existing){if(existing.type!==type||stableJson(existing.data)!==stableJson(data))throw new Error('deterministic event id conflicts');return this.getRun(id);}
    const event=this._event(id,type,data,eventId);await this.store.appendEvent(id,event);return this._commitEvents(id,[event]);
  }
  async _runExists(id){try{await this.store.getRun(id);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  _event(id,type,data,eventId) { return {schemaVersion:1,eventId:eventId||this.idGenerator('evt'),runId:id,type,timestamp:this._now(),actor:{type:'harness',id:'vibes-dashboard'},data}; }
  async _commitEvents(id,events) {
    const entry=await this._load(id); let view;
    for (const event of events) {
      entry.events.push(event); view=await this.getRun(id);
      try { await this.emit(event,view); } catch (error) { try { this.onEmitError(error,event,view); } catch {} }
    }
    return view;
  }
  async _load(id) { if (!this.cache.has(id)) { const metadata=await this.store.getRun(id); const read=await this.store.readEvents(id); this.cache.set(id,{metadata,events:read.events}); this.warnings.set(id,read.warnings); } return this.cache.get(id); }
  _has(id,type,data) { const entry=this.cache.get(id); return Boolean(entry && entry.events.some(event => event.type===type && ((data.operationKey && event.data?.operationKey===data.operationKey) || (!data.operationKey && JSON.stringify(event.data)===JSON.stringify(data))))); }
  _now() { const value=this.clock(); return (value instanceof Date ? value : new Date(value)).toISOString(); }
  _serial(key, operation) { const previous=this.queues.get(key)||Promise.resolve(); const current=previous.then(operation); const tail=current.catch(()=>{}); this.queues.set(key,tail); tail.finally(()=>{if(this.queues.get(key)===tail)this.queues.delete(key);}); return current; }
}

function sha256(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function stableJson(value){
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const INTENT_SPECS={
  child:{kind:'child-create',idField:'parentRunId',timestamp:'createdAt',keys:['schemaVersion','kind','parentRunId','operationKeyHash','fingerprint','intentFingerprint','childId','createdEventId','planEventId','parentEventId','payload','createdAt'],payloadKeys:['mission','cwd','useVibes','llmPrefs','taskId']},
  checkpoint:{kind:'checkpoint',idField:'runId',timestamp:'recordedAt',keys:['schemaVersion','kind','runId','operationKeyHash','fingerprint','intentFingerprint','checkpointId','eventId','payload','recordedAt'],payloadKeys:['label','summary','completedTaskIds','artifactEventIds','gitRef','dirtyState']},
  resume:{kind:'resume',idField:'runId',timestamp:'createdAt',keys:['schemaVersion','kind','runId','operationKeyHash','fingerprint','intentFingerprint','payload','eventId','createdAt'],payloadKeys:['checkpointId','mode']}
};
function operationIntent(core){return {...core,intentFingerprint:sha256(stableJson(core))};}
function validateOperationIntent(type,intent,{runId,keyHash,payload,ids}){
  const fail=()=>{throw new Error(`${type} operation intent corruption`);}; const spec=INTENT_SPECS[type];
  if(!intent||typeof intent!=='object'||Array.isArray(intent)||!spec) fail();
  if(stableJson(Object.keys(intent).sort())!==stableJson([...spec.keys].sort())||intent.schemaVersion!==1||intent.kind!==spec.kind||intent[spec.idField]!==runId||intent.operationKeyHash!==keyHash) fail();
  if(!intent.payload||typeof intent.payload!=='object'||Array.isArray(intent.payload)||stableJson(Object.keys(intent.payload).sort())!==stableJson([...spec.payloadKeys].sort())) fail();
  if(intent.fingerprint!==sha256(stableJson(intent.payload))||!canonicalTimestamp(intent[spec.timestamp])) fail();
  const core={...intent};delete core.intentFingerprint;if(intent.intentFingerprint!==sha256(stableJson(core))) fail();
  for(const [field,value] of Object.entries(ids)) if(intent[field]!==value) fail();
  if(!/^[a-f0-9]{64}$/.test(intent.operationKeyHash)||!/^[a-f0-9]{64}$/.test(intent.fingerprint)||!/^[a-f0-9]{64}$/.test(intent.intentFingerprint)) fail();
  if(type==='child'&&(!ID_PATTERN.test(intent.childId)||!intent.payload.llmPrefs||typeof intent.payload.llmPrefs!=='object'||Array.isArray(intent.payload.llmPrefs)||Object.keys(intent.payload.llmPrefs).some(key=>!SAFE_LLM_FIELDS.includes(key)))) fail();
  if(stableJson(intent.payload)!==stableJson(payload)&&intent.fingerprint===sha256(stableJson(payload))) fail();
  return intent;
}
function canonicalTimestamp(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;}

function truncateUtf8(value, limit) {
  const buffer=Buffer.from(String(value ?? ''), 'utf8');
  if (buffer.length <= limit) return String(value ?? '');
  return buffer.subarray(0, limit).toString('utf8').replace(/\uFFFD+$/u, '');
}

function boundStrings(value, stringLimit=1024) {
  if (typeof value === 'string') return truncateUtf8(value,stringLimit);
  if (Array.isArray(value)) return value.slice(0,MAX_VERIFICATION_ITEMS).map(item=>boundStrings(item,stringLimit));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0,32).map(([key,child])=>[truncateUtf8(key,128),boundStrings(child,stringLimit)]));
}

function boundEvidence(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} evidence is invalid`);
  let clean=boundStrings(value,1024);
  for (const field of ['stdout','stderr','output']) if (clean[field] !== undefined) clean[field]=truncateUtf8(clean[field],4096);
  const fields=['stdout','stderr','output','reason','humanNote','name','title','description','path','artifactId','checkId','id','command','spawnError'];
  while (Buffer.byteLength(JSON.stringify(clean)) > MAX_VERIFICATION_OUTPUT_BYTES) {
    const field=fields.find(name=>typeof clean[name]==='string'&&Buffer.byteLength(clean[name])>64);
    if (!field) throw new RangeError(`${label} evidence exceeds size limit`);
    clean[field]=truncateUtf8(clean[field],Math.max(64,Math.floor(Buffer.byteLength(clean[field])/2)));
  }
  return clean;
}

function boundCheckEvidence(check) { return boundEvidence(check,'check'); }
function boundArtifactEvidence(artifact) { return boundEvidence(artifact,'artifact'); }

function boundVerificationResult(result) {
  let clean=boundStrings(result,1024);
  if (Array.isArray(clean.checks)) clean.checks=clean.checks.slice(0,MAX_VERIFICATION_ITEMS).map(boundCheckEvidence);
  if (Array.isArray(clean.recipes)) clean.recipes=clean.recipes.slice(0,MAX_VERIFICATION_ITEMS).map(item=>boundStrings(item,512));
  if (Array.isArray(clean.artifacts)) clean.artifacts=clean.artifacts.slice(0,MAX_VERIFICATION_ITEMS).map(boundArtifactEvidence);
  while (Buffer.byteLength(JSON.stringify(clean)) > 60 * 1024) {
    if (Array.isArray(clean.artifacts) && clean.artifacts.length) clean.artifacts=clean.artifacts.slice(0,-1);
    else if (Array.isArray(clean.checks) && clean.checks.length > 1) clean.checks=clean.checks.slice(0,-1);
    else break;
  }
  return clean;
}

function boundVerificationDocument(value) {
  let clean=boundVerificationResult(value);
  while (Buffer.byteLength(JSON.stringify(clean)) > MAX_VERIFICATION_DOCUMENT_BYTES) {
    if (Array.isArray(clean.checks) && clean.checks.length) clean={...clean,checks:clean.checks.slice(0,-1)};
    else if (Array.isArray(clean.artifacts) && clean.artifacts.length) clean={...clean,artifacts:clean.artifacts.slice(0,-1)};
    else if (clean.reason && clean.reason.length > 1024) clean={...clean,reason:truncateUtf8(clean.reason,1024)};
    else break;
  }
  return clean;
}

module.exports={RunService,TERMINAL,INTERRUPTIBLE,validateFailureRecord,boundVerificationResult,boundCheckEvidence,boundArtifactEvidence,truncateUtf8};
