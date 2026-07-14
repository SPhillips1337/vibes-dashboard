const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRemoveTrackHandler, removeSavedTrack } = require('../server/music-library');

function fixture(tracks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibes-music-library-'));
  const playlistPath = path.join(root, 'saved_playlist.json');
  fs.writeFileSync(playlistPath, JSON.stringify(tracks, null, 2));
  return { root, playlistPath };
}

test('removing a saved track persists the remaining library in order', () => {
  const { root, playlistPath } = fixture([
    { id: 'one', name: 'One', url: 'https://example.test/one.mp3' },
    { id: 'two', name: 'Two', url: 'https://example.test/two.mp3' }
  ]);
  try {
    const result = removeSavedTrack({ playlistPath, id: 'one' });
    assert.equal(result.removed.id, 'one');
    assert.deepEqual(JSON.parse(fs.readFileSync(playlistPath, 'utf8')), [
      { id: 'two', name: 'Two', url: 'https://example.test/two.mp3' }
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DELETE handler returns 404 without mutating the library when the saved track is absent', () => {
  const { root, playlistPath } = fixture([{ id: 'one', name: 'One' }]);
  try {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; }
    };
    createRemoveTrackHandler(playlistPath)({ params: { id: 'missing' } }, response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.payload, { error: 'Saved track not found' });
    assert.deepEqual(JSON.parse(fs.readFileSync(playlistPath, 'utf8')), [{ id: 'one', name: 'One' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
