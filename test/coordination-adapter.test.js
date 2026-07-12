'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TOOL_NAMES,
  createCoordinationAdapter,
  createControlCenterHandler
} = require('../server/coordination-adapter');

test('adapter calls isolated MCP tool mappings and normalizes a control-center projection', async () => {
  const calls = [];
  const client = {
    async callTool(name) {
      calls.push(name);
      return {
        providers: [{ id: 'codex', display_name: 'Codex', executable_available: true, state: 'ready', capabilities: ['code'], diagnostics: { executable: 'available', authentication: 'detected' }, checked_at: '2026-07-12T10:00:00Z' }],
        activity: {
          activities: [
            { id: 'evt-2', state: 'passed', summary: 'Verification passed', timestamp: '2026-07-12T10:02:00Z', task_ref: 'task-2', approval_required: false, artifact_refs: ['.tmp/check.log'] },
            { id: 'evt-1', state: 'input_required', summary: 'Review required', timestamp: '2026-07-12T10:01:00Z', task_ref: 'task-1', agent_ref: 'hermes', project_ref: 'vibes', approval_required: true }
          ]
        }
      };
    }
  };

  const result = await createCoordinationAdapter({ client, now: () => new Date('2026-07-12T10:03:00Z') }).getControlCenter();

  assert.deepEqual(calls, [TOOL_NAMES.controlCenter]);
  assert.equal(result.available, true);
  assert.equal(result.providers[0].displayName, 'Codex');
  assert.equal(result.providers[0].binaryAvailable, true);
  assert.deepEqual(result.providers[0].diagnostics, ['executable: available', 'authentication: detected']);
  assert.equal(result.activity[0].id, 'evt-2');
  assert.equal(result.pendingApprovals[0].id, 'evt-1');
  assert.equal(result.verificationOutcomes[0].id, 'evt-2');
  assert.equal(result.artifactReferences[0].reference, '.tmp/check.log');
  assert.equal(result.updatedAt, '2026-07-12T10:03:00.000Z');
});

test('adapter returns an explicit unavailable state without leaking secret-bearing failures', async () => {
  const secret = 'top-secret-token';
  const client = { async callTool() { throw new Error(`Authorization: Bearer ${secret} at http://internal/mcp`); } };

  const result = await createCoordinationAdapter({ client }).getControlCenter();

  assert.equal(result.available, false);
  assert.equal(result.reason, 'coordination_service_unreachable');
  assert.deepEqual(result.providers, []);
  assert.doesNotMatch(JSON.stringify(result), /top-secret-token|Authorization|internal\/mcp/);
});

test('adapter returns not-configured without making a request', async () => {
  const result = await createCoordinationAdapter({ client: null }).getControlCenter();
  assert.equal(result.available, false);
  assert.equal(result.reason, 'not_configured');
});

test('protected route handler returns adapter projection and a stable 503 unavailable response', async () => {
  const okHandler = createControlCenterHandler({ getControlCenter: async () => ({ available: true, providers: [] }) });
  const unavailableHandler = createControlCenterHandler({ getControlCenter: async () => ({ available: false, reason: 'not_configured', providers: [] }) });
  const capture = () => {
    const state = { statusCode: 200, body: null };
    return { state, res: { status(code) { state.statusCode = code; return this; }, json(body) { state.body = body; return this; } } };
  };

  const ok = capture();
  await okHandler({}, ok.res);
  assert.equal(ok.state.statusCode, 200);
  assert.equal(ok.state.body.available, true);

  const down = capture();
  await unavailableHandler({}, down.res);
  assert.equal(down.state.statusCode, 503);
  assert.equal(down.state.body.reason, 'not_configured');
});
