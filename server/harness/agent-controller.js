'use strict';

const { extractSecretValues, redactEvent } = require('./event-contract');
const { artifactPath } = require('./verification-policy');

const SAFE_PREF_FIELDS = ['provider', 'hostUrl', 'model', 'maxTokens'];
const RECIPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function safeLlmMetadata(value = {}) {
  return Object.fromEntries(SAFE_PREF_FIELDS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

function responseText(result) {
  if (!result || result.content == null) return null;
  if (typeof result.content === 'string') return result.content || null;
  if (Array.isArray(result.content)) return result.content.find(item => item && typeof item.text === 'string')?.text || null;
  return null;
}

function parsePlan(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.tasks)) return null;
  if (value.verificationChecks !== undefined && (!Array.isArray(value.verificationChecks) || value.verificationChecks.some(id => typeof id !== 'string' || !RECIPE_ID.test(id)))) return null;
  let declaredArtifacts;
  try {
    declaredArtifacts = value.declaredArtifacts === undefined ? undefined : [...new Set(value.declaredArtifacts.map(item => artifactPath(typeof item === 'string' ? item : item?.path)))];
  } catch { return null; }
  return { tasks:value.tasks, ...(value.verificationChecks ? {verificationChecks:[...new Set(value.verificationChecks)]} : {}), ...(declaredArtifacts ? {declaredArtifacts} : {}) };
}

function safeSocketHandler(socket, operation, handler, logger = console) {
  return async data => {
    try { return await handler(data || {}); }
    catch (error) {
      logger.error(`[Harness] ${operation} failed:`, error.message);
      socket.emit('agent-operation-error', { operation, id: data?.id, error: 'Operation failed' });
      return undefined;
    }
  };
}

class AgentController {
  constructor(options = {}) {
    this.runService = options.runService;
    this.vibesBridge = options.vibesBridge;
    this.project = options.project || (run => run);
    this.emit = options.emit || (() => {});
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.setInterval = options.setInterval || setInterval;
    this.clearInterval = options.clearInterval || clearInterval;
    this.random = options.random || Math.random;
    this.verify = options.verify || (async () => ({ passed:false, cause:'no_checks_configured', checks:[], artifacts:[] }));
    this.onAsyncError = options.onAsyncError || ((error, context) => console.error(`[Harness] ${context.kind} callback failed for ${context.id}:`, error));
    this._launchPrefs = new Map();
    this._launches = new Map();
    this._timers = new Map();
    this._operationQueues = new Map();
    this._verifications = new Map();
  }

  create(data = {}, useVibes = false) {
    return this._serial('create', async () => {
      const prefs = data.llmPrefs && typeof data.llmPrefs === 'object' ? structuredClone(data.llmPrefs) : {};
      const sensitiveValues = extractSecretValues(prefs);
      const input = redactEvent({ mission:data.mission || 'Unnamed Mission', cwd:data.cwd || '~/', useVibes, llmPrefs:safeLlmMetadata(prefs) }, sensitiveValues);
      const run = await this.runService.createRun(input);
      this.runService.registerSensitiveValues?.(run.id, sensitiveValues);
      this._launchPrefs.set(run.id, prefs);
      this.emit('agent-created', this.project(await this.runService.getRun(run.id)));
      this._schedule(run.id, 'planning', run.attempt || 1, () => useVibes ? this.plan(run.id) : this.demoPlan(run.id), 0);
      return run;
    });
  }

  async plan(id, autoLaunch = false) {
    const run = await this.runService.getRun(id); if (!run || run.status !== 'planning') return run;
    try {
      const result = await this.vibesBridge.createAgent(id, run.cwd, run.mission, this._launchPrefs.get(id) || run.llmPrefs || {});
      this._launchPrefs.delete(id);
      const text = responseText(result);
      if (!text) return this.runService.failExecution(id,{stage:'planning',reason:'missing planning response'});
      const plan = parsePlan(text);
      if (!plan) return this.runService.failExecution(id,{stage:'planning',reason:'invalid planning response'});
      await this.runService.recordPlan(id,plan);
      if (autoLaunch) return this.accept(id);
      return this.runService.getRun(id);
    } catch (error) { this._launchPrefs.delete(id); return this.runService.failExecution(id,{stage:'planning',reason:error.message}); }
  }

  accept(id) { return this._serial(id, async () => {
    let run=await this.runService.getRun(id); if (!run) return;
    const token=`${run.attempt || 1}:execution`;
    if (this._launches.get(id)===token || !['awaiting_approval','interrupted'].includes(run.status)) return run;
    this._launches.set(id,token);
    try { if (run.status==='awaiting_approval') await this.runService.approvePlan(id); run=await this.runService.startExecution(id,{attempt:run.attempt || 1,operationKey:token}); }
    catch (error) { this._launches.delete(id); throw error; }
    if (run.useVibes) await this.execute(id,token); else this.demoExecute(id,token,0);
    return this.runService.getRun(id);
  }); }

  async execute(id, token) {
    const run=await this.runService.getRun(id); if (!run || run.status!=='executing') return run;
    const active=token || `${run.attempt || 1}:execution`; this._launches.set(id,active);
    try {
      const result=await this.vibesBridge.executePlannedMission(id); const text=responseText(result);
      if (!text) { const failed=await this.runService.failExecution(id,{stage:'execution',reason:'missing execution response',attempt:run.attempt || 1}); this._launchPrefs.delete(id); return failed; }
      const live=await this.runService.getRun(id); if (!live || live.status!=='executing' || this._launches.get(id)!==active) return live;
      await this.runService.recordLog(id,{message:`Mission result: ${text}`,attempt:run.attempt || 1});
      await this.runService.claimExecutionComplete(id,{result:text,attempt:run.attempt || 1,operationKey:`${active}:claim`});
      const complete=await this._verify(id,active); this._launchPrefs.delete(id); return complete;
    } catch(error) { const live=await this.runService.getRun(id); if(live?.status==='executing'){const failed=await this.runService.failExecution(id,{stage:'execution',reason:error.message,attempt:run.attempt || 1});this._launchPrefs.delete(id);return failed;} return live; }
  }

  async onExit(data) {
    const run=await this.runService.getRun(data.id); if (!run || !['executing','verifying'].includes(run.status)) return run;
    if (data.code===0) return this.runService.recordLog(data.id,{message:'Vibes process exit 0 (diagnostic)',attempt:run.attempt || 1});
    if (run.status !== 'executing') return run;
    const failed=await this.runService.failExecution(data.id,{stage:'process',reason:`exit ${data.code}`,exitCode:data.code,attempt:run.attempt || 1,operationKey:`${run.attempt || 1}:exit-failure`}); this._launchPrefs.delete(data.id); return failed;
  }

  retry(id) { return this._serial(id,async()=>{let run=await this.runService.getRun(id);if(!run)return;const key=`${run.attempt || 1}:retry`;if(this._launches.get(id)===key)return run;this._launches.set(id,key);this._cancel(id);this.vibesBridge.terminate(id);run=await this.runService.retryRun(id,{operationKey:key});if(run.useVibes)this._schedule(id,'planning',run.attempt,()=>this.plan(id,true),0);else this._schedule(id,'planning',run.attempt,()=>this.demoPlan(id,true),0);return run;}); }

  retryTask(id,taskId) { return this._serial(id,async()=>{let run=await this.runService.getRun(id);if(!run||!run.tasks?.some(t=>String(t.id)===String(taskId)))return run;const prior=this._launches.get(id);const key=`${run.attempt || 1}:retry-task:${taskId}`;if(prior===key||(!['failed','blocked'].includes(run.status)&&prior?.endsWith(`:retry-task:${taskId}`)))return run;this._launches.set(id,key);this._cancel(id);let intervention=run.interventions?.find(x=>x.status==='requested');if(!intervention){run=await this.runService.requestIntervention(id,{kind:'retry',reason:'task failure',taskId});intervention=run.interventions?.find(x=>x.status==='requested');}const instance=this.vibesBridge.instances?.get(id);const mode=instance||!run.useVibes?'execution':'planning';run=await this.runService.retryFromIntervention(id,{interventionId:intervention.id,fromTaskId:taskId,mode,operationKey:key});if(instance){try{await instance.resolveIntervention('retry',undefined,taskId);}catch(error){await this.runService.failExecution(id,{stage:'retry',reason:error.message,attempt:run.attempt,operationKey:`${key}:external-failure`});this._launchPrefs.delete(id);throw error;}}else if(run.useVibes){this.vibesBridge.terminate(id);this._schedule(id,'planning',run.attempt,()=>this.plan(id,true),0);}else{const executionToken=`${run.attempt || 1}:retry-task:${taskId}`;this._launches.set(id,executionToken);this.demoExecute(id,executionToken,Math.max(0,run.tasks.findIndex(t=>String(t.id)===String(taskId))));}return run;}); }

  async terminate(id) { this._cancel(id);this._launches.delete(id);this._launchPrefs.delete(id);const run=await this.runService.terminateRun(id,{reason:'operator'});this.vibesBridge.terminate(id);return run; }

  async demoPlan(id,auto=false){const run=await this.runService.getRun(id);if(!run||run.status!=='planning')return run;const tasks=['Analyze project structure','Implement primary logic','Run validation suite'].map((name,i)=>({id:String(i+1),name,status:'pending'}));await this.runService.recordPlan(id,{tasks,demo_fixture_only:true});this._launchPrefs.delete(id);return auto?this.accept(id):this.runService.getRun(id);}
  demoExecute(id,token,start=0){const tick=async()=>{const run=await this.runService.getRun(id);if(!run||run.status!=='executing'||this._launches.get(id)!==token)return;const task=run.tasks?.[start];if(!task){await this.runService.claimExecutionComplete(id,{demo_fixture_only:true,attempt:run.attempt,operationKey:`${token}:claim`});return this._verify(id,token);}await this.runService.recordTaskStatus(id,{...task,status:'complete'});start+=1;this._schedule(id,'execution',run.attempt,tick,1);};this._schedule(id,'execution',Number(token.split(':')[0]),tick,1);}
  async _verify(id,token){
    const key=`${id}:${token}`;
    if(this._verifications.has(key))return this._verifications.get(key);
    const operation=(async()=>{
      const run=await this.runService.getRun(id);
      if(!run||run.status!=='verifying'||this._launches.get(id)!==token)return run;
      await this.runService.startVerification(id,{attempt:run.attempt,operationKey:`${token}:verification-start`});
      let result;
      try{result=await this.verify(await this.runService.getRun(id));if(!result||typeof result.passed!=='boolean')throw new Error('verifier returned an invalid result');}
      catch(error){result={passed:false,cause:'verifier_error',reason:error.message,checks:[],artifacts:[]};}
      const evidenceEventIds=[];
      for(const check of result.checks||[]){
        const receipt=await this.runService.recordVerificationCheck?.(id,{...check,checkId:check.id||check.name||'check',passed:check.passed===true,exitCode:check.exitCode??null,reason:check.reason||null,attempt:run.attempt});
        if(receipt?.eventId)evidenceEventIds.push(receipt.eventId);
      }
      for(const artifact of result.artifacts||[]){
        const receipt=await this.runService.recordArtifactValidation(id,{artifactId:artifact.id||artifact.path,path:artifact.path,valid:artifact.valid,reason:artifact.reason||null,attempt:run.attempt});
        if(receipt?.eventId)evidenceEventIds.push(receipt.eventId);
      }
      const failureRecord=result.passed?undefined:{
        terminalCause:result.cause||result.reason||'verification_failed',
        relevantAgentBehaviour:'execution claimed complete',
        exposedMechanism:'external verification gate',
        retryable:result.retryable!==false,
        evidenceEventIds,
        ...(result.humanNote?{humanNote:result.humanNote}:{})
      };
      return this.runService.finishVerification(id,{...result,...(failureRecord?{failureRecord,reason:result.reason||failureRecord.terminalCause}:{}),attempt:run.attempt,operationKey:`${token}:verification-finish`});
    })();
    this._verifications.set(key,operation);
    try{return await operation;}finally{if(this._verifications.get(key)===operation)this._verifications.delete(key);}
  }
  _schedule(id,kind,attempt,fn,delay){let timer;const wrapped=async()=>{const timers=this._timers.get(id);if(timers){timers.delete(timer);if(timers.size===0)this._timers.delete(id);}try{const run=await this.runService.getRun(id);if(!run||run.attempt!==attempt||run.status==='terminated')return;await fn();}catch(error){try{this.onAsyncError(error,{id,kind,attempt});}catch{}}};timer=this.setTimeout(wrapped,delay);if(!this._timers.has(id))this._timers.set(id,new Set());this._timers.get(id).add(timer);return timer;}
  _cancel(id){for(const timer of this._timers.get(id)||[]){this.clearTimeout(timer);this.clearInterval(timer);}this._timers.delete(id);}
  _serial(key,fn){const prior=this._operationQueues.get(key)||Promise.resolve();const current=prior.then(fn);const tail=current.catch(()=>{});this._operationQueues.set(key,tail);tail.finally(()=>{if(this._operationQueues.get(key)===tail)this._operationQueues.delete(key);});return current;}
}

module.exports={AgentController,safeSocketHandler,safeLlmMetadata,responseText,parsePlan};
