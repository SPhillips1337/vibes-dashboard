const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const at = relativePath => path.join(root, relativePath);
const read = relativePath => fs.readFileSync(at(relativePath), 'utf8');

const requiredTypes = new Set(['semantic', 'decision', 'procedural']);

function loadIndex() {
  return JSON.parse(read('.agent/memory-index.json'));
}

test('Agents Protocol overlay declares safe source-of-truth and Git boundaries', () => {
  const bootstrap = read('BOOTSTRAP.md');
  const agents = read('AGENTS.md');
  const context = read('CONTEXT.md');

  assert.match(bootstrap, /derived memory/i);
  assert.match(bootstrap, /canonical sources/i);
  assert.match(bootstrap, /commit only when explicitly requested/i);
  assert.match(bootstrap, /never run destructive Git recovery/i);
  assert.match(agents, /\.agent\/memory-index\.json/);
  assert.match(context, /Canonical source precedence/);
  assert.match(read('.gitignore'), /!\.agent\/README\.md/);
});

test('memory index is versioned, unique, source-backed, and complete', () => {
  const index = loadIndex();
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.policy.derived, true);
  assert.equal(index.policy.commitRequiresExplicitRequest, true);
  assert.equal(index.policy.destructiveGitRecovery, 'forbidden');
  assert.ok(Array.isArray(index.canonicalSources));
  assert.ok(index.canonicalSources.length >= 3);
  index.canonicalSources.forEach(source => assert.ok(fs.existsSync(at(source)), `missing canonical source: ${source}`));

  const ids = new Set();
  const types = new Set();
  assert.ok(index.entries.length >= 6);
  for (const entry of index.entries) {
    assert.ok(!ids.has(entry.id), `duplicate memory id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(requiredTypes.has(entry.type), `invalid memory type: ${entry.type}`);
    types.add(entry.type);
    assert.equal(entry.status, 'active');
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0);
    assert.ok(fs.existsSync(at(entry.path)), `missing memory file: ${entry.path}`);
    assert.ok(Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0);
    entry.sourceRefs.forEach(source => assert.ok(fs.existsSync(at(source)), `missing source ref: ${source}`));

    const memory = read(entry.path);
    assert.match(memory, /Status:\s*Active/);
    assert.match(memory, /Last verified:\s*2026-07-14/);
    assert.match(memory, /## Canonical sources/);
  }
  assert.deepEqual(types, requiredTypes);
});

test('ADR records why upstream automatic Ratchet actions are not adopted', () => {
  const adr = read('docs/adr/ADR-0007-derived-agent-memory-overlay.md');
  assert.match(adr, /Status:\s*Accepted/);
  assert.match(adr, /derived/i);
  assert.match(adr, /explicit/i);
  assert.match(adr, /reset --hard/);
});
