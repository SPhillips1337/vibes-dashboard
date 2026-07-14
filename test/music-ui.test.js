const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('saved library tracks expose an accessible remove control wired to the protected DELETE endpoint', () => {
  const source = read('modules/music/script.js');
  const styles = read('modules/music/style.css');
  assert.match(source, /track\.id/);
  assert.match(source, /remove-track-btn/);
  assert.match(source, /removeButton\.textContent = 'Remove'/);
  assert.match(source, /aria-label/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /fetch\(`\/api\/music\/library\/\$\{encodeURIComponent\(track\.id\)\}`/);
  assert.match(source, /'X-CSRF-Token': window\.Dashboard\.csrfToken/);
  assert.match(styles, /\.remove-track-btn/);
  assert.doesNotMatch(styles, /\.remove-track-btn \{[^}]*opacity:\s*0/s);
});

test('removing the current or final track updates playback state without indexing an empty playlist', () => {
  const source = read('modules/music/script.js');
  assert.match(source, /PLAYLIST\.splice\(index, 1\)/);
  assert.match(source, /if \(PLAYLIST\.length === 0\)/);
  assert.match(source, /Math\.min\(index, PLAYLIST\.length - 1\)/);
  assert.match(source, /audio\.removeAttribute\('src'\)/);
  assert.match(source, /function nextTrack\(\) \{\s+if \(!PLAYLIST\.length\) return;/);
  assert.match(source, /function prevTrack\(\) \{\s+if \(!PLAYLIST\.length\) return;/);
});
