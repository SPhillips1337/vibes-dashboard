'use strict';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'terminated']);

function projectRun(run, events) {
  const view = {
    ...structuredClone(run),
    status: 'created',
    progress: 0,
    totalTasks: 0,
    completedTasks: 0,
    tasks: [],
    plan: null,
    logs: [],
    interventions: [],
    artifacts: [],
    checkpoints: [],
    verification: { status: 'pending', checks: [] },
    attempt: 1
  };
  const seen = new Set();
  const tasks = new Map();
  const artifacts = new Map();
  const interventions = new Map();
  const unresolvedInterventions = new Set();
  let statusBeforeBlock = 'created';

  for (const event of events) {
    if (!event || !event.eventId || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    const previousStatus = view.status;
    const data = structuredClone(event.data || {});
    switch (event.type) {
      case 'run.created':
        view.status = 'created';
        if (data.parentRunId !== undefined) view.parentRunId = data.parentRunId;
        if (Array.isArray(data.childRunIds)) view.childRunIds = [...data.childRunIds];
        break;
      case 'run.restored':
        if (data.interrupted === true && !TERMINAL_STATUSES.has(view.status)) view.status = 'interrupted';
        break;
      case 'run.terminated':
        view.status = 'terminated';
        view.termination = { ...data };
        break;
      case 'plan.requested':
        view.status = 'planning';
        break;
      case 'plan.proposed':
        view.plan = data.plan ?? data;
        if (Array.isArray(view.plan?.tasks)) for (const task of view.plan.tasks) {
          const id = String(task.id ?? task.taskId ?? task.name ?? '');
          if (id) upsertTask(tasks, id, { ...task, title: task.title || task.name }, task.status || 'pending');
        }
        view.status = 'awaiting_approval';
        break;
      case 'plan.approved':
        view.status = 'awaiting_approval';
        break;
      case 'plan.declined':
        view.status = 'failed';
        view.failure = { ...data };
        break;
      case 'execution.started':
        view.status = 'executing';
        view.attempt = data.attempt || view.attempt || 1;
        break;
      case 'execution.claimed_complete':
        view.status = 'verifying';
        break;
      case 'execution.failed':
        view.status = 'failed';
        view.failure = { ...data };
        break;
      case 'execution.retry_requested': {
        view.attempt = (view.attempt || 1) + 1;
        view.retry = { ...data, attempt: view.attempt };
        view.failure = null;
        view.verification = { status: 'pending' };
        const values = [...tasks.values()];
        const retryIndex = data.fromTaskId == null ? -1 : values.findIndex(task => String(task.id) === String(data.fromTaskId));
        if (retryIndex >= 0) values.forEach((task,index) => { if (index >= retryIndex) resetTaskForRetry(task); });
        else if (data.fromTaskId == null) tasks.clear();
        view.status = data.mode === 'planning' || data.fromTaskId == null ? 'planning' : 'executing';
        break;
      }
      case 'task.started':
        upsertTask(tasks, data.taskId ?? data.task?.id, data.task, 'running');
        view.status = 'executing';
        break;
      case 'task.completed':
        upsertTask(tasks, data.taskId ?? data.task?.id, data.task, 'completed', data);
        break;
      case 'task.failed':
        upsertTask(tasks, data.taskId ?? data.task?.id, data.task, 'failed', data);
        view.status = 'failed';
        view.failure = { ...data };
        break;
      case 'log.emitted':
        view.logs.push({ ...data, eventId: event.eventId, timestamp: event.timestamp });
        break;
      case 'artifact.declared': {
        const artifact = data.artifact ?? data;
        if (artifact.id) artifacts.set(artifact.id, { ...artifact });
        break;
      }
      case 'artifact.validated': {
        const artifact = artifacts.get(data.artifactId) || { id: data.artifactId };
        const { artifactId, ...validation } = data;
        artifacts.set(data.artifactId, { ...artifact, validation: { ...validation, eventId: event.eventId, timestamp: event.timestamp } });
        break;
      }
      case 'verification.started':
        view.status = 'verifying';
        view.verification = { status: 'running', checks: view.verification.checks || [], ...data };
        break;
      case 'verification.check_recorded':
        view.verification.checks = [...(view.verification.checks || []), { ...(data.check ?? data), eventId: event.eventId, timestamp: event.timestamp }];
        break;
      case 'verification.passed':
        view.status = 'completed';
        view.verification = { status: 'passed', checks: view.verification.checks || [], ...data };
        break;
      case 'verification.failed':
        view.status = 'failed';
        view.verification = { status: 'failed', checks: view.verification.checks || [], ...data };
        view.failure = { ...data };
        break;
      case 'intervention.requested': {
        const intervention = data.intervention ?? data;
        if (intervention.id) {
          interventions.set(intervention.id, { ...intervention, status: 'requested' });
          unresolvedInterventions.add(intervention.id);
        }
        if (view.status !== 'blocked') statusBeforeBlock = view.status;
        view.status = 'blocked';
        break;
      }
      case 'intervention.resolved': {
        const current = interventions.get(data.interventionId) || { id: data.interventionId };
        const { interventionId, ...resolution } = data;
        interventions.set(data.interventionId, { ...current, status: 'resolved', ...resolution });
        unresolvedInterventions.delete(data.interventionId);
        if (view.status === 'blocked' && unresolvedInterventions.size === 0) view.status = statusBeforeBlock;
        break;
      }
      case 'checkpoint.recorded':
        view.checkpoints.push({ ...(data.checkpoint ?? data) });
        break;
      default:
        break;
    }
    if (previousStatus === 'terminated') view.status = 'terminated';
    else if ((previousStatus === 'completed' || previousStatus === 'failed') && !['run.terminated','execution.retry_requested'].includes(event.type)) view.status = previousStatus;
  }

  view.tasks = [...tasks.values()];
  view.totalTasks = view.tasks.length;
  view.completedTasks = view.tasks.filter(task => task.status === 'completed').length;
  view.progress = view.totalTasks === 0 ? 0 : Math.round((view.completedTasks / view.totalTasks) * 100);
  view.artifacts = [...artifacts.values()];
  view.interventions = [...interventions.values()];
  return view;
}

function resetTaskForRetry(task) {
  task.status = 'pending';
  for (const field of ['result', 'evidence', 'error', 'reason']) delete task[field];
}

function upsertTask(tasks, id, task = {}, status, eventData = {}) {
  if (!id) return;
  const current = tasks.get(id) || { id, parentId: null };
  const details = task && typeof task === 'object' ? task : {};
  const safe = pick(details, ['title', 'name', 'description', 'assignee', 'dependsOn', 'metadata']);
  const result = pick(eventData, ['result', 'evidence', 'error', 'reason']);
  const parentId = current.parentId ?? details.parentId ?? null;
  tasks.set(id, { ...current, ...safe, ...result, id, parentId, status });
}

function pick(value, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

module.exports = { projectRun };
