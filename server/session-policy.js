function isSessionValid(session, options = {}) {
  if (!session || typeof session !== 'object') return false;
  const now = options.now ?? Date.now();
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  if (options.mfaRequired === true && session.mfaVerified !== true) return false;
  return true;
}

module.exports = { isSessionValid };
