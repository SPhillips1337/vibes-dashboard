'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildViewModel } = require('../modules/control-center/script');

test('rendering view model exposes real counts and deterministic empty messages', () => {
  const model = buildViewModel({
    available: true,
    providers: [{ readiness: 'ready' }, { readiness: 'degraded' }],
    activity: [], pendingApprovals: [], verificationOutcomes: [], artifactReferences: [],
    updatedAt: '2026-07-12T10:00:00Z'
  });
  assert.deepEqual(model.metrics, { readyProviders: '1 / 2', recentActivity: '0', pendingApprovals: '0', verificationOutcomes: '0' });
  assert.equal(model.activity.empty, 'No recent coordination activity.');
  assert.equal(model.approvals.empty, 'No approvals are waiting.');
});

test('rendering view model clearly represents unavailable data', () => {
  const model = buildViewModel({ available: false, reason: 'not_configured' });
  assert.equal(model.available, false);
  assert.match(model.statusMessage, /not configured/i);
  assert.equal(model.metrics.readyProviders, '—');
});

test('control-center browser script does not use innerHTML for live data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'control-center', 'script.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /\.textContent\s*=/);
});
