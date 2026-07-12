'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readStoredEvent } = require('../server/harness/event-contract');

test('committed harness lifecycle fixtures contain valid versioned JSONL events', () => {
  for (const name of ['verified-run', 'failed-run']) {
    const file = path.join(__dirname, `fixtures/harness-runs/${name}/events.jsonl`);
    const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => readStoredEvent(JSON.parse(line)));
    assert.ok(events.length > 0);
    assert.ok(events.every(event => event.runId === name));
  }
});
