const fs = require('node:fs');
const path = require('node:path');

function readSavedTracks(playlistPath) {
  if (!fs.existsSync(playlistPath)) return [];
  const tracks = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
  if (!Array.isArray(tracks)) throw new Error('Saved playlist must be an array');
  return tracks;
}

function writeSavedTracks(playlistPath, tracks) {
  fs.mkdirSync(path.dirname(playlistPath), { recursive: true });
  const temporaryPath = `${playlistPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(tracks, null, 2), 'utf8');
    fs.renameSync(temporaryPath, playlistPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function removeSavedTrack({ playlistPath, id }) {
  const normalizedId = String(id || '');
  const tracks = readSavedTracks(playlistPath);
  const index = tracks.findIndex(track => String(track.id) === normalizedId);
  if (index === -1) return { removed: null, tracks };
  const [removed] = tracks.splice(index, 1);
  writeSavedTracks(playlistPath, tracks);
  return { removed, tracks };
}

function createRemoveTrackHandler(playlistPath) {
  return (req, res) => {
    try {
      const result = removeSavedTrack({ playlistPath, id: req.params.id });
      if (!result.removed) return res.status(404).json({ error: 'Saved track not found' });
      return res.json({ success: true, removed: result.removed });
    } catch (error) {
      console.error('[Music] Removing saved track failed:', error.message);
      return res.status(500).json({ error: 'Failed to remove track from library' });
    }
  };
}

module.exports = { createRemoveTrackHandler, readSavedTracks, removeSavedTrack, writeSavedTracks };
