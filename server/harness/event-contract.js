'use strict';

const MAX_EVENT_BYTES = 64 * 1024;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SUPPORTED_EVENT_TYPES = new Set([
  'run.created', 'run.restored', 'run.terminated',
  'plan.requested', 'plan.proposed', 'plan.approved', 'plan.declined',
  'execution.started', 'execution.claimed_complete', 'execution.failed', 'execution.retry_requested',
  'task.started', 'task.completed', 'task.failed', 'log.emitted',
  'artifact.declared', 'artifact.validated',
  'verification.started', 'verification.check_recorded', 'verification.passed', 'verification.failed',
  'intervention.requested', 'intervention.resolved', 'checkpoint.recorded'
]);
const ENVELOPE_FIELDS = ['schemaVersion', 'eventId', 'runId', 'type', 'timestamp', 'actor', 'data'];
const SECRET_FIELD = /(?:password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|credential|cookie)/i;
const TOKEN_BUDGET_FIELDS = new Set(['maxTokens', 'contextTokens']);
function isSecretField(key) { return !TOKEN_BUDGET_FIELDS.has(key) && SECRET_FIELD.test(key); }

function assertEnvelope(value, allowUnknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('event must be an object');
  if ((!allowUnknown && Object.keys(value).length !== ENVELOPE_FIELDS.length) || ENVELOPE_FIELDS.some(field => !Object.hasOwn(value, field))) throw new TypeError('event envelope shape is invalid');
  if (value.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');
  for (const field of ['eventId', 'runId']) if (!ID_PATTERN.test(value[field] || '')) throw new TypeError(`${field} is invalid`);
  if (typeof value.type !== 'string' || (!allowUnknown && !SUPPORTED_EVENT_TYPES.has(value.type))) throw new TypeError('unsupported event type');
  if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || new Date(value.timestamp).toISOString() !== value.timestamp) throw new TypeError('timestamp is invalid');
  if (!value.actor || typeof value.actor !== 'object' || Array.isArray(value.actor) ||
      Object.keys(value.actor).length !== 2 || !Object.hasOwn(value.actor, 'type') || !Object.hasOwn(value.actor, 'id') ||
      !ID_PATTERN.test(value.actor.type || '') || !ID_PATTERN.test(value.actor.id || '')) throw new TypeError('actor is invalid');
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new TypeError('data must be an object');
  findSecrets(value.data, new Set());
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_EVENT_BYTES) throw new RangeError('event exceeds size limit');
  return value;
}

function findSecrets(value, ancestors) {
  if (ancestors.has(value)) throw new TypeError('cyclic event data is invalid');
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (isSecretField(key) && child !== '[REDACTED]') throw new TypeError(`secret-bearing field rejected: ${key}`);
    if (child && typeof child === 'object') findSecrets(child, ancestors);
  }
  ancestors.delete(value);
}

function normalizeSensitiveValues(values) {
  return [...new Set((values || [])
    .filter(value => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length);
}

function redactString(value, sensitiveValues) {
  let result = value;
  for (const secret of sensitiveValues) result = result.split(secret).join('[REDACTED]');
  return result;
}

function redactValue(value, ancestors = new Set(), sensitiveValues = []) {
  if (typeof value === 'string') return redactString(value, sensitiveValues);
  if (!value || typeof value !== 'object') return value;
  if (ancestors.has(value)) throw new TypeError('cyclic value cannot be redacted');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? value.map(child => redactValue(child, ancestors, sensitiveValues))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isSecretField(key) ? '[REDACTED]' : redactValue(child, ancestors, sensitiveValues)]));
  ancestors.delete(value);
  return result;
}

function validateEvent(value) { return assertEnvelope(value, false); }
function readStoredEvent(value) { return assertEnvelope(value, true); }
function redactEvent(value, sensitiveValues = []) { return redactValue(value, new Set(), normalizeSensitiveValues(sensitiveValues)); }

function extractSecretValues(value, ancestors = new Set(), result = []) {
  if (!value || typeof value !== 'object') return result;
  if (ancestors.has(value)) throw new TypeError('cyclic value cannot be inspected');
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (isSecretField(key) && typeof child === 'string' && child.length > 0) result.push(child);
    else if (child && typeof child === 'object') extractSecretValues(child, ancestors, result);
  }
  ancestors.delete(value);
  return normalizeSensitiveValues(result);
}

module.exports = { MAX_EVENT_BYTES, SUPPORTED_EVENT_TYPES, validateEvent, readStoredEvent, redactEvent, extractSecretValues };
