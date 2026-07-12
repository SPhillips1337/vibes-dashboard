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

function validateFailureRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || FAILURE_FIELDS.some(field => typeof value[field] !== 'string' || !value[field]) ||
      typeof value.retryable !== 'boolean' || !Array.isArray(value.evidenceEventIds) || value.evidenceEventIds.some(id => typeof id !== 'string') ||
      (value.humanNote !== undefined && typeof value.humanNote !== 'string')) throw new TypeError('failure record is invalid');
  return value;
}

class RunService {
  constructor({ store, clock = () => new Date(), idGenerator = prefix => `${prefix}-${crypto.randomUUID()}`, emit = () => {}, onEmitError = () => {} } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store; this.clock = clock; this.idGenerator = idGenerator; this.emit = emit; this.onEmitError = onEmitError;
    this.cache = new Map(); this.queues = new Map(); this.warnings = new Map(); this.sensitiveValues = new Map();
  }

  createRun(input = {}) { return this._serial('__create__', async () => {
    const id = this.idGenerator('run'); const createdAt = this._now();
    const sensitiveValues = Array.isArray(input.sensitiveValues) ? input.sensitiveValues : [];
    this.sensitiveValues.set(id, sensitiveValues);
    const llmPrefs = input.llmPrefs && typeof input.llmPrefs === 'object'
      ? Object.fromEntries(SAFE_LLM_FIELDS.filter(key => input.llmPrefs[key] !== undefined).map(key => [key, input.llmPrefs[key]])) : {};
    const metadata = redactEvent({ id, createdAt, mission: input.mission || 'Unnamed Mission', cwd: input.cwd || '~/', useVibes: Boolean(input.useVibes), llmPrefs, parentRunId: input.parentRunId || null }, sensitiveValues);
    await this.store.createRun(metadata); this.cache.set(id, { metadata, events: [] });
    await this._append(id, 'run.created', { parentRunId: metadata.parentRunId, childRunIds: input.childRunIds || [] });
    await this._append(id, 'plan.requested', {});
    return this.getRun(id);
  }); }

  recordPlan(id, plan) { return this._transition(id, ['planning','awaiting_approval'], 'plan.proposed', { plan }, async clean => this.store.writeDocument(id, 'plan.json', clean.plan), true); }
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
  recordArtifactValidation(id, validation) { return this._transitionWithEvent(id, ['verifying'], 'artifact.validated', validation, null, true); }
  recordVerificationCheck(id, check) { return this._transitionWithEvent(id, ['verifying'], 'verification.check_completed', check, null, true); }
  startVerification(id, data={}) { return this._transition(id, ['verifying'], 'verification.started', data, null, true); }
  finishVerification(id, result={}) { return this._serial(id, async () => {
    const view=await this.getRun(id);
    const clean=this.redactForRun(id, boundVerificationResult(result || {}));
    if (view.verification.status !== 'running') throw new Error(`illegal transition from ${view.status} via verification.${clean.passed === true ? 'passed' : 'failed'}`);
    if (!['verifying'].includes(view.status)) {
      if (this._has(id, clean.passed === true ? 'verification.passed' : 'verification.failed', clean)) return view;
      throw new Error(`illegal transition from ${view.status} via verification.${clean.passed === true ? 'passed' : 'failed'}`);
    }
    if (clean.passed !== true) validateFailureRecord(clean.failureRecord);
    const type=clean.passed === true ? 'verification.passed' : 'verification.failed';
    if (this._has(id,type,clean)) return view;
    const event=this._event(id,type,clean);
    await this.store.appendEvent(id,event);
    const projected=await this._commitEvents(id,[event]);
    await this.store.writeDocument(id, 'verification.json', boundVerificationDocument(clean));
    return projected;
  }); }
  requestIntervention(id, intervention) { return this._transition(id, ['planning','awaiting_approval','executing','verifying'], 'intervention.requested', { intervention: { id: intervention.id || this.idGenerator('intervention'), ...intervention } }); }
  resolveIntervention(id, resolution) { return this._transition(id, ['blocked'], 'intervention.resolved', resolution, null, true); }
  async terminateRun(id, data={}) { const run=await this._transition(id, ['created','planning','awaiting_approval','executing','verifying','blocked','interrupted'], 'run.terminated', data, null, true); this.sensitiveValues.delete(id); return run; }

  registerSensitiveValues(id, values) { this.sensitiveValues.set(id, Array.isArray(values) ? [...values] : []); }
  redactForRun(id, value) { return redactEvent(value, this.sensitiveValues.get(id) || []); }

  recordTaskStatus(id, task = {}) {
    const status = task.status;
    const type = status === 'complete' || status === 'completed' ? 'task.completed' : status === 'failed' ? 'task.failed' : 'task.started';
    const taskId = String(task.id ?? task.taskId ?? task.name ?? '');
    return this._transition(id, ['executing'], type, { taskId, task: { id: taskId, title: task.name || task.title, description: task.description } }, null, true);
  }

  async getRun(id) { const entry = await this._load(id); return { ...projectRun(entry.metadata, entry.events), warnings: [...(this.warnings.get(id)||[])] }; }
  async listRuns() { const metadata = await this.store.listRuns(); return Promise.all(metadata.map(run => this.getRun(run.id))); }
  async restoreRuns() {
    const metadata = await this.store.listRuns(); const restored=[];
    for (const run of metadata) {
      const read = await this.store.readEvents(run.id); this.cache.set(run.id,{metadata:run,events:read.events}); this.warnings.set(run.id,read.warnings);
      const view = projectRun(run,read.events);
      if (INTERRUPTIBLE.has(view.status)) await this._append(run.id,'run.restored',{interrupted:true,previousStatus:view.status});
      restored.push(await this.getRun(run.id));
    }
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
  _event(id,type,data) { return {schemaVersion:1,eventId:this.idGenerator('evt'),runId:id,type,timestamp:this._now(),actor:{type:'harness',id:'vibes-dashboard'},data}; }
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

function truncateUtf8(value, limit) {
  const buffer=Buffer.from(String(value ?? ''), 'utf8');
  if (buffer.length <= limit) return String(value ?? '');
  return buffer.subarray(0, limit).toString('utf8').replace(/\uFFFD+$/u, '');
}

function boundCheck(check) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return check;
  const clean={...check};
  for (const field of ['stdout','stderr','output']) if (clean[field] !== undefined) clean[field]=truncateUtf8(clean[field], MAX_VERIFICATION_OUTPUT_BYTES);
  return clean;
}

function boundVerificationResult(result) {
  const clean={...result};
  if (Array.isArray(clean.checks)) clean.checks=clean.checks.slice(0,MAX_VERIFICATION_ITEMS).map(boundCheck);
  if (Array.isArray(clean.recipes)) clean.recipes=clean.recipes.slice(0,MAX_VERIFICATION_ITEMS);
  if (Array.isArray(clean.artifacts)) clean.artifacts=clean.artifacts.slice(0,MAX_VERIFICATION_ITEMS);
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

module.exports={RunService,TERMINAL,INTERRUPTIBLE,validateFailureRecord,boundVerificationResult,truncateUtf8};
