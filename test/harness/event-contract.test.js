'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvent, readStoredEvent, redactEvent, extractSecretValues, MAX_EVENT_BYTES, SUPPORTED_EVENT_TYPES } = require('../../server/harness/event-contract');

const CANONICAL_TYPES = [
  'run.created', 'run.restored', 'run.terminated',
  'plan.requested', 'plan.proposed', 'plan.approved', 'plan.declined',
  'execution.started', 'execution.claimed_complete', 'execution.failed', 'execution.retry_requested',
  'task.started', 'task.completed', 'task.failed', 'log.emitted',
  'artifact.declared', 'artifact.validated',
  'verification.started', 'verification.check_recorded', 'verification.passed', 'verification.failed',
  'intervention.requested', 'intervention.resolved', 'checkpoint.recorded', 'run.child_created'
];

function event(overrides = {}) {
  return { schemaVersion: 1, eventId: 'evt-001', runId: 'run-001', type: 'run.created', timestamp: '2026-07-12T12:00:00.000Z', actor: { type: 'harness', id: 'test' }, data: {}, ...overrides };
}

test('supports exactly every canonical event type with the exact envelope shape', () => {
  assert.deepEqual([...SUPPORTED_EVENT_TYPES], CANONICAL_TYPES);
  for (const type of CANONICAL_TYPES) {
    const value = event({ type });
    assert.deepEqual(Object.keys(validateEvent(value)), ['schemaVersion', 'eventId', 'runId', 'type', 'timestamp', 'actor', 'data']);
    assert.deepEqual(Object.keys(value.actor), ['type', 'id']);
  }
});

test('accepts only canonical UTC ISO timestamps', () => {
  for (const timestamp of ['1970-01-01T00:00:00.000Z', '2026-07-12T12:00:00.000Z']) {
    assert.equal(validateEvent(event({ timestamp })).timestamp, timestamp);
  }
  for (const timestamp of ['0', '2026-07-12T13:00:00.000+01:00', '2026-07-12T12:00:00Z', '2026-07-12 12:00:00.000Z']) {
    assert.throws(() => validateEvent(event({ timestamp })), /timestamp/i);
    assert.throws(() => readStoredEvent(event({ timestamp })), /timestamp/i);
  }
});

test('rejects malformed envelope fields and unknown untrusted types', () => {
  for (const value of [
    event({ schemaVersion: 2 }), event({ eventId: '../bad' }), event({ runId: 'bad/id' }),
    event({ type: 'future.event' }), event({ timestamp: 'yesterday' }), event({ actor: null }),
    event({ actor: { type: '', id: 'test' } }), event({ actor: { type: 'harness', id: '../bad' } }), event({ data: null }),
    { ...event(), id: 'legacy-id' }
  ]) assert.throws(() => validateEvent(value));
});

test('enforces serialized event size at and above the limit', () => {
  let low = 0; let high = MAX_EVENT_BYTES;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(event({ data: { text: 'x'.repeat(mid) } }))) <= MAX_EVENT_BYTES) low = mid;
    else high = mid - 1;
  }
  assert.doesNotThrow(() => validateEvent(event({ data: { text: 'x'.repeat(low) } })));
  assert.throws(() => validateEvent(event({ data: { text: 'x'.repeat(low + 1) } })), /size/i);
});

test('rejects secret-bearing fields and can redact them before validation', () => {
  const unsafe = event({ data: { nested: { apiToken: 's3cr3t' }, authorization: 'Bearer nope', safe: 'ok' } });
  assert.throws(() => validateEvent(unsafe), /secret/i);
  const redacted = redactEvent(unsafe);
  assert.equal(redacted.data.nested.apiToken, '[REDACTED]');
  assert.equal(redacted.data.authorization, '[REDACTED]');
  assert.equal(redacted.data.safe, 'ok');
  assert.doesNotThrow(() => validateEvent(redacted));
});

test('secret detector allows token budget fields but rejects credential token names', () => {
  assert.doesNotThrow(() => validateEvent(event({ data: { maxTokens: 1024, contextTokens: 2048 } })));
  for (const key of ['token', 'access_token', 'auth_token']) {
    assert.throws(() => validateEvent(event({ data: { [key]: 'credential-value' } })), /secret-bearing field rejected/);
  }
});

test('redacts known secret values embedded in free-form strings', () => {
  const secret = 'sentinel-value-9f61';
  const values = extractSecretValues({ apiKey: secret, nested: { password: 'second-secret' }, hostUrl: 'https://safe' });
  const redacted = redactEvent(event({ data: { message: `bridge echoed ${secret}`, result: 'prefix-second-secret-suffix' } }), values);
  assert.equal(JSON.stringify(redacted).includes(secret), false);
  assert.equal(JSON.stringify(redacted).includes('second-secret'), false);
  assert.equal(redacted.data.message, 'bridge echoed [REDACTED]');
  assert.doesNotThrow(() => validateEvent(redacted));
});

test('compatibility reads preserve unknown stored events but still validate envelopes', () => {
  const future = event({ type: 'future.event', data: { value: 1 } });
  assert.deepEqual(readStoredEvent(future), future);
  assert.throws(() => readStoredEvent({ ...future, runId: '../escape' }));
});

test('compatibility reads allow additive envelope fields while untrusted events remain exact', () => {
  const future = { ...event({ type: 'future.event' }), traceContext: { id: 'trace' } };
  assert.deepEqual(readStoredEvent(future), future);
  assert.throws(() => validateEvent({ ...event(), traceContext: {} }), /shape/i);
  const { actor, ...missing } = future;
  assert.throws(() => readStoredEvent(missing), /shape|actor/i);
});

test('secret traversal handles arrays and cycles deterministically', () => {
  assert.throws(() => validateEvent(event({ data: { items: [{ apiKey: 'unsafe' }] } })), /secret/i);
  const cyclic = { safe: true }; cyclic.self = cyclic;
  assert.throws(() => validateEvent(event({ data: cyclic })), /cyclic/i);
  assert.throws(() => redactEvent(cyclic), /cyclic/i);
});
