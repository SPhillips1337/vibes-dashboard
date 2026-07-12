'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentController, safeSocketHandler } = require('../../server/harness/agent-controller');

function harness(overrides = {}) {
  const views = new Map(); const calls = []; const prefs = new Map();
  const service = {
    async getRun(id) { return structuredClone(views.get(id)); },
    async createRun(input) { calls.push(['createRun', input]); const view={id:'run-1',mission:input.mission,cwd:input.cwd,status:'planning',useVibes:input.useVibes,tasks:[],attempt:1}; views.set(view.id,view); return structuredClone(view); },
    async recordPlan(id, plan) { calls.push(['recordPlan',id,plan]); Object.assign(views.get(id),{status:'awaiting_approval',plan,tasks:plan.tasks||[]}); return this.getRun(id); },
    async approvePlan(id) { calls.push(['approvePlan',id]); return this.getRun(id); },
    async startExecution(id,d={}) { calls.push(['startExecution',id,d]); Object.assign(views.get(id),{status:'executing',attempt:d.attempt||views.get(id).attempt}); return this.getRun(id); },
    async failExecution(id,d) { calls.push(['failExecution',id,d]); Object.assign(views.get(id),{status:'failed',failure:d}); return this.getRun(id); },
    async recordLog(id,d) { calls.push(['recordLog',id,d]); return this.getRun(id); },
    async claimExecutionComplete(id,d) { calls.push(['claimExecutionComplete',id,d]); Object.assign(views.get(id),{status:'verifying'}); return this.getRun(id); },
    async startVerification(id,d) { calls.push(['startVerification',id,d]); return this.getRun(id); },
    async recordArtifactValidation(id,d) { calls.push(['recordArtifactValidation',id,d]); return this.getRun(id); },
    async finishVerification(id,d) { calls.push(['finishVerification',id,d]); Object.assign(views.get(id),{status:d.passed?'completed':'failed',verification:d}); return this.getRun(id); },
    async retryRun(id,d) { calls.push(['retryRun',id,d]); Object.assign(views.get(id),{status:d.fromTaskId?'executing':'planning',attempt:(views.get(id).attempt||1)+1,retry:d}); return this.getRun(id); },
    async retryFromIntervention(id,d) { calls.push(['retryFromIntervention',id,d]); const view=views.get(id); Object.assign(view,{status:d.mode==='planning'?'planning':'executing',attempt:(view.attempt||1)+1,retry:d,interventions:(view.interventions||[]).map(item=>item.id===d.interventionId?{...item,status:'resolved'}:item)}); return this.getRun(id); },
    async requestIntervention(id,d) { calls.push(['requestIntervention',id,d]); Object.assign(views.get(id),{status:'blocked',interventions:[{...d,status:'requested'}]}); return this.getRun(id); },
    async resolveIntervention(id,d) { calls.push(['resolveIntervention',id,d]); return this.getRun(id); },
    async terminateRun(id,d) { calls.push(['terminateRun',id,d]); Object.assign(views.get(id),{status:'terminated'}); return this.getRun(id); },
    async recordTaskStatus(id,d) { calls.push(['recordTaskStatus',id,d]); return this.getRun(id); }
  };
  const bridge={createAgent:async(...a)=>{calls.push(['createAgent',...a]);return {content:'{"tasks":[{"id":"up-1","name":"Build","status":"pending"}]}'};},executePlannedMission:async(...a)=>{calls.push(['execute',...a]);return {content:'done'};},terminate:id=>calls.push(['terminate',id]),instances:new Map()};
  const timers=[]; const controller=new AgentController({runService:service,vibesBridge:bridge,project:run=>run,emit:(n,p)=>calls.push(['emit',n,p]),setTimeout:(fn)=>{timers.push(fn);return fn;},clearTimeout:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},setInterval:(fn)=>{timers.push(fn);return fn;},clearInterval:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},random:()=>0,...overrides});
  controller._launchPrefs=prefs;
  return {controller,service,bridge,views,calls,timers,prefs};
}

test('create keeps launch secrets only until bridge creation has copied them',async()=>{const h=harness();const secret='phase2-super-secret';await h.controller.create({mission:'ship',cwd:'/tmp',llmPrefs:{provider:'openai',hostUrl:'https://example',model:'m',maxTokens:99,apiKey:secret,token:secret}},true);assert.equal(JSON.stringify(h.calls.filter(c=>c[0]==='createRun')).includes(secret),false);assert.equal(JSON.stringify(await h.service.getRun('run-1')).includes(secret),false);assert.equal(h.prefs.get('run-1').apiKey,secret);await h.timers.shift()();assert.equal(h.calls.find(c=>c[0]==='createAgent')[4].apiKey,secret);assert.equal(h.prefs.has('run-1'),false);});

test('restart planning recreates bridge with durable hostUrl and no secret',async()=>{const h=harness();h.views.set('r',{id:'r',mission:'x',cwd:'/tmp',status:'planning',useVibes:true,attempt:2,llmPrefs:{provider:'local',hostUrl:'http://restart-host',model:'m',maxTokens:42}});await h.controller.plan('r');assert.deepEqual(h.calls.find(c=>c[0]==='createAgent')[4],{provider:'local',hostUrl:'http://restart-host',model:'m',maxTokens:42});});

test('duplicate accept launches execution exactly once',async()=>{const h=harness();h.views.set('r',{id:'r',status:'awaiting_approval',useVibes:true,attempt:1,tasks:[]});await Promise.all([h.controller.accept('r'),h.controller.accept('r')]);assert.equal(h.calls.filter(c=>c[0]==='execute').length,1);});

test('planning and execution missing or invalid responses persist canonical staged failure',async()=>{const h=harness({vibesBridge:{createAgent:async()=>({}),executePlannedMission:async()=>({}),terminate(){},instances:new Map()}});h.views.set('r',{id:'r',mission:'x',cwd:'/tmp',status:'planning',useVibes:true,attempt:1});await h.controller.plan('r');assert.deepEqual(h.calls.find(c=>c[0]==='failExecution').slice(2),[{stage:'planning',reason:'missing planning response'}]);h.views.set('e',{id:'e',status:'executing',useVibes:true,attempt:1});await h.controller.execute('e');assert.deepEqual(h.calls.filter(c=>c[0]==='failExecution').at(-1)[2],{stage:'execution',reason:'missing execution response',attempt:1});});

test('planning accepts only strict plan object, recipe ids, and safe artifact paths',async()=>{
  const cases=[
    ['legacy array','[{"id":"1","name":"legacy"}]'],
    ['missing tasks',JSON.stringify({verificationChecks:['unit']})],
    ['malformed check id',JSON.stringify({tasks:[],verificationChecks:['unit;rm']})],
    ['unsafe artifact',JSON.stringify({tasks:[],declaredArtifacts:['../secret']})]
  ];
  for(const [label,content] of cases){
    const h=harness({vibesBridge:{createAgent:async()=>({content}),executePlannedMission:async()=>({}),terminate(){},instances:new Map()}});
    h.views.set(label,{id:label,mission:'x',cwd:'/tmp',status:'planning',useVibes:true,attempt:1});
    await h.controller.plan(label);
    assert.equal(h.calls.some(c=>c[0]==='recordPlan'),false,label);
    assert.deepEqual(h.calls.find(c=>c[0]==='failExecution')[2],{stage:'planning',reason:'invalid planning response'});
  }
  const valid=JSON.stringify({tasks:[{id:'t1',title:'Build'}],verificationChecks:['unit.test-1'],declaredArtifacts:['reports/out.json']});
  const h=harness({vibesBridge:{createAgent:async()=>({content:valid}),executePlannedMission:async()=>({}),terminate(){},instances:new Map()}});
  h.views.set('ok',{id:'ok',mission:'x',cwd:'/tmp',status:'planning',useVibes:true,attempt:1});
  await h.controller.plan('ok');
  assert.deepEqual(h.calls.find(c=>c[0]==='recordPlan').slice(2),[{tasks:[{id:'t1',title:'Build'}],verificationChecks:['unit.test-1'],declaredArtifacts:['reports/out.json']}]);
});

test('MCP result is completion authority and zero exit is diagnostic only',async()=>{let release;const gate=new Promise(resolve=>{release=resolve;});const h=harness({verify:async()=>{await gate;return {passed:true};}});h.views.set('r',{id:'r',status:'executing',attempt:1,useVibes:true});const execution=h.controller.execute('r');while(!h.calls.some(c=>c[0]==='startVerification'))await new Promise(resolve=>setImmediate(resolve));await h.controller.onExit({id:'r',code:0});release();await execution;assert.equal(h.calls.filter(c=>c[0]==='claimExecutionComplete').length,1);assert.ok(h.calls.some(c=>c[0]==='recordLog'&&/exit 0/.test(c[2].message)));});

test('real execution runs external verification and only its result grants completion',async()=>{const h=harness({verify:async run=>({passed:true,checks:[{name:'claim-present',passed:Boolean(run)}]})});h.views.set('r',{id:'r',status:'executing',attempt:1,useVibes:true});const run=await h.controller.execute('r');assert.deepEqual(h.calls.filter(c=>['claimExecutionComplete','startVerification','finishVerification'].includes(c[0])).map(c=>c[0]),['claimExecutionComplete','startVerification','finishVerification']);assert.equal(run.status,'completed');});

test('verification failure leaves a real execution durably failed',async()=>{const h=harness({verify:async()=>({passed:false,checks:[{name:'workspace-check',passed:false}],reason:'check failed'})});h.views.set('r',{id:'r',status:'executing',attempt:1,useVibes:true});const run=await h.controller.execute('r');assert.equal(run.status,'failed');assert.equal(h.calls.find(c=>c[0]==='finishVerification')[2].reason,'check failed');});

test('verification emits artifact evidence before a grounded failed outcome',async()=>{const h=harness({verify:async()=>({passed:false,cause:'artifact_validation_failed',checks:[],artifacts:[{path:'report.txt',valid:false,reason:'missing'}]})});h.views.set('r',{id:'r',status:'executing',attempt:1,useVibes:true});await h.controller.execute('r');const artifactIndex=h.calls.findIndex(c=>c[0]==='recordArtifactValidation');const finishIndex=h.calls.findIndex(c=>c[0]==='finishVerification');assert.ok(artifactIndex>=0&&artifactIndex<finishIndex);const failure=h.calls[finishIndex][2].failureRecord;assert.equal(failure.terminalCause,'artifact_validation_failed');assert.equal(failure.relevantAgentBehaviour,'execution claimed complete');assert.equal(failure.exposedMechanism,'external verification gate');assert.equal(failure.retryable,true);assert.deepEqual(failure.evidenceEventIds,[]);});

test('verification evidence ids include canonical check and artifact validation events',async()=>{
  const h=harness({verify:async()=>({passed:false,cause:'verification_failed',checks:[{id:'unit',passed:false,eventId:'evt-check'}],artifacts:[{id:'report',path:'report.txt',valid:false,reason:'missing'}]})});
  h.service.recordArtifactValidation=async(id,d)=>{h.calls.push(['recordArtifactValidation',id,d]);return {eventId:'evt-artifact',run:await h.service.getRun(id)};};
  h.service.recordVerificationCheck=async(id,d)=>{h.calls.push(['recordVerificationCheck',id,d]);return {eventId:'evt-check',run:await h.service.getRun(id)};};
  h.views.set('r',{id:'r',status:'executing',attempt:1,useVibes:true});
  await h.controller.execute('r');
  const failure=h.calls.find(c=>c[0]==='finishVerification')[2].failureRecord;
  assert.deepEqual(failure.evidenceEventIds,['evt-check','evt-artifact']);
});

test('demo path is explicitly marked fixture-only and does not use runtime version checks',async()=>{
  const h=harness();
  h.views.set('r',{id:'r',mission:'x',status:'planning',useVibes:false,attempt:1});
  await h.controller.demoPlan('r');
  await h.controller.accept('r');
  for(let guard=0;h.timers.length&&guard<10;guard++)await h.timers.shift()();
  const plan=h.calls.find(c=>c[0]==='recordPlan')[2];
  const claim=h.calls.find(c=>c[0]==='claimExecutionComplete')[2];
  assert.equal(plan.demo_fixture_only,true);
  assert.equal(claim.demo_fixture_only,true);
  assert.equal(JSON.stringify(h.calls).includes('--version'),false);
});

test('nonzero exit fails execution and stale exit does not overwrite terminal state',async()=>{const h=harness();h.views.set('r',{id:'r',status:'executing',attempt:1});await h.controller.onExit({id:'r',code:2});assert.equal(h.calls.find(c=>c[0]==='failExecution')[2].stage,'process');h.views.set('r',{id:'r',status:'terminated',attempt:1});await h.controller.onExit({id:'r',code:3});assert.equal(h.calls.filter(c=>c[0]==='failExecution').length,1);});

test('retry is durable, resolves a real intervention with upstream task id, and launches once',async()=>{const h=harness();const instance={resolveIntervention:async(...a)=>h.calls.push(['resolveExternal',...a])};h.bridge.instances.set('r',instance);h.views.set('r',{id:'r',status:'failed',useVibes:true,attempt:1,tasks:[{id:'up-9',status:'failed'}],interventions:[]});await Promise.all([h.controller.retryTask('r','up-9'),h.controller.retryTask('r','up-9')]);assert.equal(h.calls.filter(c=>c[0]==='requestIntervention').length,1);assert.equal(h.calls.filter(c=>c[0]==='retryFromIntervention').length,1);assert.deepEqual(h.calls.find(c=>c[0]==='resolveExternal').slice(1),['retry',undefined,'up-9']);});

test('same task can be retried once again on a later attempt',async()=>{const h=harness();h.bridge.instances.set('r',{resolveIntervention:async(...a)=>h.calls.push(['resolveExternal',...a])});h.views.set('r',{id:'r',status:'blocked',useVibes:true,attempt:1,tasks:[{id:'up-9',status:'failed'}],interventions:[{id:'help-1',status:'requested',taskId:'up-9'}]});await h.controller.retryTask('r','up-9');await h.service.failExecution('r',{stage:'execution',reason:'attempt 2 failed',attempt:2});await Promise.all([h.controller.retryTask('r','up-9'),h.controller.retryTask('r','up-9')]);assert.deepEqual(h.calls.filter(c=>c[0]==='retryFromIntervention').map(c=>c[2].operationKey),['1:retry-task:up-9','2:retry-task:up-9']);assert.equal(h.calls.filter(c=>c[0]==='resolveExternal').length,2);assert.equal(h.views.get('r').attempt,3);});

test('live task retry commits durable resolution before external retry and compensates external failure',async()=>{const h=harness();h.bridge.instances.set('r',{resolveIntervention:async()=>{h.calls.push(['resolveExternal']);throw new Error('bridge retry failed');}});h.views.set('r',{id:'r',status:'blocked',useVibes:true,attempt:1,tasks:[{id:'up-9',status:'failed'}],interventions:[{id:'help-1',status:'requested',taskId:'up-9'}]});await assert.rejects(()=>h.controller.retryTask('r','up-9'),/bridge retry failed/);assert.ok(h.calls.findIndex(c=>c[0]==='retryFromIntervention')<h.calls.findIndex(c=>c[0]==='resolveExternal'));assert.equal(h.views.get('r').status,'failed');});

test('task retry without live process returns to planning and auto-launches recreated process',async()=>{const h=harness();h.views.set('r',{id:'r',mission:'x',cwd:'/tmp',status:'blocked',useVibes:true,attempt:1,llmPrefs:{provider:'local',model:'m'},tasks:[{id:'up-9',status:'failed'}],interventions:[{id:'help-1',status:'requested',taskId:'up-9'}]});const retried=await h.controller.retryTask('r','up-9');assert.equal(retried.status,'planning');assert.equal(h.timers.length,1);await h.timers.shift()();assert.equal(h.calls.filter(c=>c[0]==='createAgent').length,1);assert.equal(h.calls.filter(c=>c[0]==='execute').length,1);});

test('demo task retry schedules current attempt and reaches completion claim',async()=>{const h=harness();h.views.set('r',{id:'r',status:'blocked',useVibes:false,attempt:1,tasks:[{id:'one',name:'One',status:'failed'},{id:'two',name:'Two',status:'pending'}],interventions:[{id:'help',status:'requested',taskId:'one'}]});await h.controller.retryTask('r','one');for(let guard=0;h.timers.length&&guard<10;guard++)await h.timers.shift()();assert.equal(h.calls.filter(c=>c[0]==='recordTaskStatus').length,2);assert.equal(h.calls.filter(c=>c[0]==='claimExecutionComplete').length,1);assert.equal(h.calls.find(c=>c[0]==='claimExecutionComplete')[2].attempt,2);});

test('accept resumes interrupted run without approving an already approved plan',async()=>{const h=harness();h.views.set('r',{id:'r',status:'interrupted',useVibes:true,attempt:2,tasks:[]});await h.controller.accept('r');assert.equal(h.calls.filter(c=>c[0]==='approvePlan').length,0);assert.equal(h.calls.filter(c=>c[0]==='startExecution').length,1);assert.equal(h.calls.filter(c=>c[0]==='execute').length,1);});

test('scheduled callbacks remove fired timers and route sync and async errors',async()=>{const errors=[];const h=harness({onAsyncError:(error,context)=>errors.push([error.message,context])});h.views.set('r',{id:'r',status:'planning',attempt:1});h.controller._schedule('r','planning',1,()=>{throw new Error('sync timer');},0);await h.timers.shift()();assert.equal(h.controller._timers.has('r'),false);h.controller._schedule('r','planning',1,async()=>{throw new Error('async timer');},0);await h.timers.shift()();assert.deepEqual(errors.map(item=>item[0]),['sync timer','async timer']);assert.ok(errors.every(item=>item[1].id==='r'&&item[1].kind==='planning'));});

test('terminal paths discard ephemeral launch preferences',async()=>{const h=harness();for(const status of ['terminated','failed','completed']){h.prefs.set(status,{apiKey:'secret'});h.views.set(status,{id:status,status:status==='terminated'?'awaiting_approval':'executing',attempt:1,useVibes:true});if(status==='terminated')await h.controller.terminate(status);else if(status==='failed')await h.controller.onExit({id:status,code:2});else await h.controller.execute(status);assert.equal(h.prefs.has(status),false);}});

test('terminate cancels demo timers and stale callbacks cannot mutate a new attempt',async()=>{const h=harness();h.views.set('r',{id:'r',mission:'x',status:'awaiting_approval',useVibes:false,attempt:1,tasks:[{id:'1',name:'x',status:'pending'}]});await h.controller.accept('r');assert.ok(h.timers.length);const stale=h.timers[0];await h.controller.terminate('r');assert.equal(h.timers.length,0);await stale();assert.equal(h.calls.filter(c=>c[0]==='recordTaskStatus').length,0);});

test('safe socket boundary catches rejection and emits stable operation error',async()=>{const emitted=[];const socket={emit:(...a)=>emitted.push(a)};let logged='';await safeSocketHandler(socket,'agent-accept',async()=>{throw new Error('boom');},{error:(...a)=>{logged=a.join(' ');}})({id:'r'});assert.match(logged,/boom/);assert.deepEqual(emitted,[['agent-operation-error',{operation:'agent-accept',id:'r',error:'Operation failed'}]]);});
