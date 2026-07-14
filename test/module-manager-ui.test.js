const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('module cards render manifest icons as allowlisted SVG instead of escaped source text', () => {
  const source = read('modules/module-manager/script.js');

  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /escapeHtml\(mod\.icon/);
  assert.match(source, /function renderModuleIcon\(/);
  assert.match(source, /ALLOWED_SVG_ELEMENTS/);
  assert.match(source, /ALLOWED_SVG_ATTRIBUTES/);
  assert.match(source, /UNSAFE_SVG_VALUE/);
  assert.match(source, /appendChild\(renderModuleIcon\([^)]*\.icon\)\)/);
});

test('module manager uses a bounded responsive grid with contained icons', () => {
  const styles = read('modules/module-manager/style.css');

  assert.match(styles, /max-width:\s*1800px/);
  assert.match(styles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1400px\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.module-icon \{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.module-info \{[^}]*min-width:\s*0/s);
  assert.match(styles, /\.module-card \{[^}]*background:[^;]*0\.96/s);
});
