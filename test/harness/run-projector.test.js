'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectRun } = require('../../server/harness/run-projector');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, `../fixtures/harness-runs/${name}/events.jsonl`), 'utf8')
    .trim().split('\n').map(JSON.parse);
}
const verified = fixture('verified-run');
const failed = fixture('failed-run');
const metadata = { id: 'verified-run', createdAt: '2026-07-12T10:00:00.000Z' };

function prefixes(events) { return events.map((_, index) => projectRun(metadata, events.slice(0, index + 1)).status); }

test('projects every lifecycle state from canonical events in append order', () => {
  assert.deepEqual(prefixes(verified), [
    'created', 'planning', 'awaiting_approval', 'awaiting_approval', 'executing',
    'executing', 'executing', 'executing', 'executing', 'executing', 'executing',
    'executing', 'blocked', 'executing', 'executing', 'verifying', 'verifying', 'completed'
  ]);
});

test('projects plan, logs, interventions, artifacts, checkpoints, and run relationships', () => {
  const view = projectRun(metadata, verified);
  assert.deepEqual(view.plan, { summary: 'Ship safely', steps: ['build', 'verify'] });
  assert.deepEqual(view.logs, [{ level: 'info', message: 'verification ready', eventId: 'evt-09', timestamp: '2026-07-12T10:08:00.000Z' }]);
  assert.deepEqual(view.interventions, [{ id: 'intervention-1', reason: 'confirm output', status: 'resolved', resolution: 'approved' }]);
  assert.deepEqual(view.artifacts, [{ id: 'artifact-1', taskId: 'task-2', path: 'reports/result.txt', validation: { valid: true, evidence: 'sha256:fixture', eventId: 'evt-11', timestamp: '2026-07-12T10:10:00.000Z' } }]);
  assert.deepEqual(view.checkpoints, [{ id: 'checkpoint-1', gitRef: 'abc123', mode: 'metadata-only' }]);
  assert.equal(view.parentRunId, 'parent-run');
  assert.deepEqual(view.childRunIds, ['child-run']);
});

test('projects verification check records and artifact validation evidence event ids', () => {
  const base = verified[0];
  const events = [
    { ...base, eventId:'claim', type:'execution.claimed_complete', data:{} },
    { ...base, eventId:'start-v', type:'verification.started', data:{} },
    { ...base, eventId:'check-evt', type:'verification.check_recorded', data:{check:{id:'unit',passed:false,stdout:'no'}} },
    { ...base, eventId:'artifact-evt', type:'artifact.validated', data:{artifactId:'report',path:'report.txt',valid:false,reason:'missing'} },
    { ...base, eventId:'failed-v', type:'verification.failed', data:{passed:false,failureRecord:{terminalCause:'verification_failed',relevantAgentBehaviour:'execution claimed complete',exposedMechanism:'external verification gate',retryable:true,evidenceEventIds:['check-evt','artifact-evt']}} }
  ];
  const view = projectRun(metadata, events);
  assert.deepEqual(view.verification.checks,[{id:'unit',passed:false,stdout:'no',eventId:'check-evt',timestamp:base.timestamp}]);
  assert.equal(view.artifacts[0].validation.eventId,'artifact-evt');
  assert.deepEqual(view.failure.failureRecord.evidenceEventIds,['check-evt','artifact-evt']);
});

test('task events upsert tasks and derive counts and progress only from task states', () => {
  const view = projectRun(metadata, verified);
  assert.deepEqual(view.tasks.map(task => [task.id, task.status, task.parentId]), [['task-1', 'completed', null], ['task-2', 'completed', 'task-1']]);
  assert.equal(view.totalTasks, 2);
  assert.equal(view.completedTasks, 2);
  assert.equal(view.progress, 100);
  const partial = projectRun(metadata, verified.slice(0, 8));
  assert.equal(partial.tasks[1].status, 'running');
  assert.equal(partial.totalTasks, 2);
  assert.equal(partial.completedTasks, 1);
  assert.equal(partial.progress, 50);
});

test('retry projection clears prior attempt outcomes while preserving task definition fields', () => {
  const base = verified[0];
  const events = [
    { ...base, eventId:'plan', type:'plan.proposed', data:{plan:{tasks:[{id:'one',title:'One',description:'Do it',dependsOn:['zero']},{id:'two',title:'Two',description:'Then it',dependsOn:['one']}]}} },
    { ...base, eventId:'done-one', type:'task.completed', data:{taskId:'one',result:'old',evidence:['old'],error:'old error',reason:'old reason'} },
    { ...base, eventId:'fail-two', type:'task.failed', data:{taskId:'two',result:'partial',evidence:['bad'],error:'boom',reason:'failed'} },
    { ...base, eventId:'retry', type:'execution.retry_requested', data:{fromTaskId:'one'} }
  ];
  const view = projectRun(metadata, events);
  assert.deepEqual(view.tasks, [
    {id:'one',parentId:null,title:'One',description:'Do it',dependsOn:['zero'],status:'pending'},
    {id:'two',parentId:null,title:'Two',description:'Then it',dependsOn:['one'],status:'pending'}
  ]);
});

test('execution failure fails and failed fixture is consumed', () => {
  const view = projectRun({ id: 'failed-run' }, failed);
  assert.equal(view.status, 'failed');
  assert.deepEqual(view.failure, { reason: 'process exited 1', evidence: ['exit:1'] });
});

test('restored nonterminal work becomes interrupted only when indicated', () => {
  const restored = { ...verified[0], eventId: 'restore-1', type: 'run.restored', data: { interrupted: true, previousStatus: 'executing' } };
  assert.equal(projectRun(metadata, [...verified.slice(0, 5), restored]).status, 'interrupted');
  assert.equal(projectRun(metadata, [...verified, { ...restored, eventId: 'restore-2' }]).status, 'completed');
});

test('termination and plan decline project terminal and failed states', () => {
  const declined = { ...verified[0], eventId: 'decline-1', type: 'plan.declined', data: { reason: 'unsafe' } };
  const terminated = { ...verified[0], eventId: 'terminate-1', type: 'run.terminated', data: { reason: 'operator' } };
  assert.equal(projectRun(metadata, [verified[0], declined]).status, 'failed');
  assert.equal(projectRun(metadata, [verified[0], terminated]).status, 'terminated');
});

test('duplicate event IDs are idempotent and timestamps never override append order', () => {
  const started = verified.find(event => event.type === 'task.started');
  const duplicate = { ...started, data: { task: { id: 'wrong' } } };
  const lateTimestamp = { ...verified.find(event => event.type === 'task.completed'), eventId: 'late-append', timestamp: '2000-01-01T00:00:00.000Z', data: { taskId: 'task-1' } };
  const view = projectRun(metadata, [started, duplicate, lateTimestamp]);
  assert.deepEqual(view.tasks.map(task => task.id), ['task-1']);
  assert.equal(view.tasks[0].status, 'completed');
});

test('unknown stored events are ignored safely', () => {
  const base = projectRun(metadata, verified);
  const unknown = { ...verified[0], eventId: 'evt-future', type: 'future.event', data: { status: 'corrupt' } };
  assert.deepEqual(projectRun(metadata, [...verified, unknown]), base);
});

test('task payloads cannot forge canonical identity, status, or parent relationship', () => {
  const started = { ...verified[0], eventId: 'forged-start', type: 'task.started', data: { taskId: 'canonical', task: { id: 'forged', status: 'completed', parentId: 'parent', title: 'safe', secretExtra: 'ignored' } } };
  const completed = { ...started, eventId: 'forged-complete', type: 'task.completed', data: { taskId: 'canonical', task: { id: 'other', status: 'running', parentId: 'changed', title: 'done' }, status: 'running', result: { ok: true } } };
  assert.deepEqual(projectRun(metadata, [started, completed]).tasks, [{ id: 'canonical', parentId: 'parent', title: 'done', status: 'completed', result: { ok: true } }]);
});

test('terminal statuses ignore all later lifecycle and verification status transitions', () => {
  const base = verified[0];
  const terminalEvents = {
    completed: { ...base, eventId: 'completed', type: 'verification.passed', data: { evidence: [] } },
    failed: { ...base, eventId: 'failed', type: 'execution.failed', data: { reason: 'boom' } },
    terminated: { ...base, eventId: 'terminated', type: 'run.terminated', data: { reason: 'stop' } }
  };
  const lateEvents = {
    'verification.started': { ...base, eventId: 'verification-started', type: 'verification.started', data: {} },
    'verification.failed': { ...base, eventId: 'verification-failed', type: 'verification.failed', data: { reason: 'late' } },
    'verification.passed': { ...base, eventId: 'verification-passed', type: 'verification.passed', data: { evidence: [] } },
    'execution.started': { ...base, eventId: 'execution-started', type: 'execution.started', data: {} }
  };
  const cases = [
    ['completed', 'verification.started'], ['completed', 'verification.failed'],
    ['failed', 'verification.passed'], ['failed', 'verification.started'],
    ['terminated', 'verification.started'], ['terminated', 'verification.failed'], ['terminated', 'verification.passed'],
    ['completed', 'execution.started'], ['failed', 'execution.started'], ['terminated', 'execution.started']
  ];
  for (const [terminal, late] of cases) {
    assert.equal(projectRun(metadata, [base, terminalEvents[terminal], lateEvents[late]]).status, terminal, `${terminal} -> ${late}`);
  }
});

test('run termination explicitly supersedes completed and failed statuses', () => {
  const base = verified[0];
  const terminated = { ...base, eventId: 'terminated', type: 'run.terminated', data: { reason: 'operator' } };
  const completed = { ...base, eventId: 'completed', type: 'verification.passed', data: {} };
  const failedEvent = { ...base, eventId: 'failed', type: 'execution.failed', data: { reason: 'boom' } };
  assert.equal(projectRun(metadata, [base, completed, terminated]).status, 'terminated');
  assert.equal(projectRun(metadata, [base, failedEvent, terminated]).status, 'terminated');
});

test('fresh verification outcomes still transition verifying runs to terminal status', () => {
  const base = verified[0];
  const started = { ...base, eventId: 'verification-started', type: 'verification.started', data: {} };
  const passed = { ...base, eventId: 'verification-passed', type: 'verification.passed', data: { evidence: [] } };
  const failedEvent = { ...base, eventId: 'verification-failed', type: 'verification.failed', data: { reason: 'checks failed' } };
  assert.equal(projectRun(metadata, [base, started, passed]).status, 'completed');
  assert.equal(projectRun(metadata, [base, started, failedEvent]).status, 'failed');
});

test('nested interventions stay blocked until all IDs resolve then restore pre-block status', () => {
  const base = verified[0];
  const events = [
    { ...base, eventId: 'start', type: 'execution.started' },
    { ...base, eventId: 'ask-1', type: 'intervention.requested', data: { intervention: { id: 'one' } } },
    { ...base, eventId: 'ask-2', type: 'intervention.requested', data: { intervention: { id: 'two' } } },
    { ...base, eventId: 'resolve-1', type: 'intervention.resolved', data: { interventionId: 'one' } }
  ];
  assert.equal(projectRun(metadata, events).status, 'blocked');
  assert.equal(projectRun(metadata, [...events, { ...base, eventId: 'resolve-2', type: 'intervention.resolved', data: { interventionId: 'two' } }]).status, 'executing');
});

test('projection deep-clones metadata and event payloads', () => {
  const run = { id: 'clone', nested: { value: 1 } };
  const event = { ...verified[0], eventId: 'clone-event', type: 'plan.proposed', data: { plan: { steps: [{ name: 'original' }] } } };
  const view = projectRun(run, [event]);
  view.nested.value = 2;
  view.plan.steps[0].name = 'mutated';
  assert.equal(run.nested.value, 1);
  assert.equal(event.data.plan.steps[0].name, 'original');
});
