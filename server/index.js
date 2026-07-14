const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { VibesBridge } = require('./vibes-bridge');
const { createAdapterFromEnv, createControlCenterHandler } = require('./coordination-adapter');
const { RunStore } = require('./harness/run-store');
const { RunService } = require('./harness/run-service');
const { toAgentProjection, parseTaskStatus } = require('./harness/agent-compat');
const { AgentController, safeSocketHandler } = require('./harness/agent-controller');
const { loadVerificationPolicy, selectVerification } = require('./harness/verification-policy');
const { createVerifier } = require('./harness/verifier');
const { createHarnessHandlers } = require('./harness-api');
const { spawn, spawnSync } = require('child_process');
const QRCode = require('qrcode');
const { createMfaChallengeService } = require('./mfa-challenges');
const { parseEncryptionKey } = require('./mfa');
const { createAccessControl } = require('./access-control');
const { isSessionValid } = require('./session-policy');
const { createRemoveTrackHandler } = require('./music-library');

const app = express();
const accessControl = createAccessControl({
  allowedIps: process.env.ACCESS_ALLOWED_IPS,
  trustedProxies: process.env.TRUSTED_PROXY_IPS
});
app.set('trust proxy', accessControl.trustProxy);
app.use(accessControl.middleware);
const certDir = path.join(__dirname, '..', 'certs');
const certPath = path.join(certDir, 'cert.pem');
const keyPath = path.join(certDir, 'key.pem');

let server;
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const sslOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  server = https.createServer(sslOptions, app);
  console.log('[SSL] HTTPS enabled with self-signed certificate');
} else {
  const http = require('http');
  server = http.createServer(app);
  console.log('[SSL] No certificates found — falling back to HTTP (microphone may not work)');
  console.log('[SSL] Run generate_cert.sh to create self-signed certificates');
}

const io = new Server(server);
io.engine.use(accessControl.nodeMiddleware);

const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';

const vibesRoot = process.env.VIBES_PATH || path.join(require('os').homedir(), 'Vibes');
const serverScript = path.join(vibesRoot, 'src', 'mcp', 'server.ts');
const hasVibes = fs.existsSync(serverScript);

// Auto-enable real vibes mode if the Vibes repository exists and USE_VIBES is not explicitly disabled
const USE_VIBES = process.env.USE_VIBES === 'true' || (hasVibes && process.env.USE_VIBES !== 'false');

const auth = require('./auth');
const coordinationAdapter = createAdapterFromEnv();
const MFA_REQUIRED = process.env.MFA_REQUIRED === 'true';
const mfaService = createMfaChallengeService({
  required: MFA_REQUIRED,
  encryptionKey: MFA_REQUIRED ? parseEncryptionKey(process.env.MFA_ENCRYPTION_KEY) : undefined,
  issuer: process.env.MFA_ISSUER || 'Vibes Dashboard',
  saveUser: () => auth.saveUsers()
});

// Custom Cookie Parser Middleware
app.use((req, res, next) => {
  req.cookies = {};
  const rawCookies = req.headers.cookie;
  if (rawCookies) {
    rawCookies.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        req.cookies[name] = decodeURIComponent(value);
      }
    });
  }
  next();
});

app.use(express.json());

// Prevent browser caching of index.html for security back-button protection
app.get('/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Secure static modules directory
app.use('/modules', (req, res, next) => {
  const sessionId = req.cookies['__Host-session-id'];
  if (sessionId && isSessionValid(auth.sessions[sessionId], { mfaRequired: MFA_REQUIRED })) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}, express.static(path.join(__dirname, '..', 'modules')));

// In-memory agent registry
const agents = new Map();
const harnessRoot = process.env.HARNESSES_ROOT || path.join(__dirname, '..', 'data', 'harness', 'runs');
const runService = new RunService({
  store: new RunStore({ root: harnessRoot }),
  enableDestructiveRetention: process.env.HARNESSES_RETENTION_DELETE_ENABLED === 'true',
  emit: (event, run) => {
    const projection = toAgentProjection(run);
    agents.set(run.id, projection);
    io.emit('harness-event', event);
    io.emit('agent-updated', projection);
  },
  onEmitError: (error, event) => console.error(`[Harness] Failed to emit ${event.type} for ${event.runId}:`, error)
});
const restorePromise = runService.restoreRuns().then(runs => {
  for (const run of runs) agents.set(run.id, toAgentProjection(run));
  console.log(`[Harness] Restored ${runs.length} durable run(s) from ${harnessRoot}`);
}).catch(error => { console.error('[Harness] Restore failed:', error); throw error; });

// Vibes Bridge (real orchestration)
const vibesBridge = new VibesBridge({ onSensitiveValues: (id, values) => runService.registerSensitiveValues(id, values) });
const policyPath = process.env.HARNESSES_VERIFICATION_POLICY;
const policyRoot = path.resolve(process.env.HARNESSES_VERIFICATION_POLICY_ROOT || path.join(__dirname, '..', 'config', 'verification'));
const verificationPolicy = policyPath
  ? loadVerificationPolicy({ policyPath, trustedPolicyRoots: [policyRoot], harnessWorkspaces: [harnessRoot] })
  : loadVerificationPolicy({ policy: { executablePaths: [], recipes: {} } });
const verifier = createVerifier();
const agentController = new AgentController({
  runService,
  vibesBridge,
  project: toAgentProjection,
  emit: (event, payload) => io.emit(event, payload),
  verify: async run => run.plan?.demo_fixture_only
    ? { passed:true, cause:'demo_fixture_only', checks:[], artifacts:[], demo_fixture_only:true }
    : verifier.verify({
      workspace: path.resolve(String(run.cwd || '').replace(/^~(?=$|\/)/, require('os').homedir())),
      selection: selectVerification(await verificationPolicy, {
        plan: run.plan,
        declaredArtifacts: (run.artifacts || []).map(artifact => artifact.path).filter(Boolean)
      })
    })
});

vibesBridge.on('agent-status', async (data) => {
  const agent = agents.get(data.id);
  if (agent && data.log) {
    // Intercept task status events
    const taskStatus = parseTaskStatus(data.log);
    if (taskStatus) {
      await runService.recordTaskStatus(data.id, taskStatus).catch(error => console.warn('[Harness] Task status rejected:', error.message));
      return; // Do not push internal status to live logs
    }
    const safeLog = runService.redactForRun(data.id, data.log);
    await runService.recordLog(data.id, { message: safeLog }).catch(error => console.warn('[Harness] Log rejected:', error.message));
    io.emit('agent-log', { id: data.id, log: safeLog });
  }
});

vibesBridge.on('agent-error', async (data) => {
  await runService.failExecution(data.id, { stage: 'process', reason: data.error, operationKey: `bridge-error:${data.error}` }).catch(error => console.warn('[Harness] Agent error rejected:', error.message));
});

vibesBridge.on('agent-exit', data => agentController.onExit(data).catch(error => console.warn('[Harness] Exit rejected:', error.message)));

// =========================================================================
// AUTHENTICATION & USER MANAGEMENT API
// =========================================================================

const crypto = require('crypto');

// PUBLIC AUTH ENDPOINTS
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip;
  if (auth.isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many failed login attempts. Try again in 10 minutes.' });
  }

  const { username, password, mfaChallengeId, mfaCode } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = auth.users.find(u => u.username === username.toLowerCase());
  if (!user) {
    auth.recordLoginAttempt(ip, false);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = await auth.verifyPassword(password, user.passwordHash);
  if (!valid) {
    auth.recordLoginAttempt(ip, false);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  let recoveryCodes;
  if (MFA_REQUIRED) {
    if (!mfaChallengeId || !mfaCode) {
      const challenge = mfaService.begin(user);
      const qrCodeDataUrl = challenge.enrollmentRequired
        ? await QRCode.toDataURL(challenge.otpauthUri, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
        : undefined;
      return res.status(202).json({ ...challenge, qrCodeDataUrl });
    }

    const mfaResult = mfaService.verify(user, mfaChallengeId, mfaCode);
    if (!mfaResult.ok) {
      auth.recordLoginAttempt(ip, false);
      return res.status(401).json({ error: 'Invalid or expired authentication code' });
    }
    recoveryCodes = mfaResult.recoveryCodes;
  }

  auth.recordLoginAttempt(ip, true);

  const { sessionId, csrfToken } = auth.createSession(user.id, user.username, user.role, MFA_REQUIRED);

  res.cookie('__Host-session-id', sessionId, {
    httpOnly: true,
    secure: true, // Requires HTTPS (self-signed certs generated via generate_cert.sh)
    sameSite: 'Strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  res.json({
    success: true,
    user: {
      username: user.username,
      name: user.name,
      role: user.role
    },
    ...(recoveryCodes ? { recoveryCodes } : {})
  });
});

app.get('/api/auth/status', (req, res) => {
  const sessionId = req.cookies['__Host-session-id'];
  if (sessionId && isSessionValid(auth.sessions[sessionId], { mfaRequired: MFA_REQUIRED })) {
    const session = auth.sessions[sessionId];
    return res.json({
      authenticated: true,
      user: {
        username: session.username,
        role: session.role
      }
    });
  }
  res.json({ authenticated: false });
});

// ROUTE GUARD: Require authentication and CSRF token for all other /api/* endpoints
app.use('/api', (req, res, next) => {
  // Bypassing /api/proxy because it implements custom session/csrf validation to support sandboxed iframe requests
  if (req.path === '/proxy') {
    return next();
  }

  const sessionId = req.cookies['__Host-session-id'];
  if (sessionId && isSessionValid(auth.sessions[sessionId], { mfaRequired: MFA_REQUIRED })) {
    req.session = auth.sessions[sessionId];

    // CSRF Check for all state-changing HTTP requests
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const csrfToken = req.headers['x-csrf-token'];
    if (csrfToken && req.session.csrfToken === csrfToken) {
      return next();
    }
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

// SECURE AUTH ENDPOINTS (Protected)
app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.cookies['__Host-session-id'];
  auth.destroySession(sessionId);
  res.clearCookie('__Host-session-id', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/'
  });
  res.json({ success: true });
});

app.get('/api/auth/csrf', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

app.post('/api/auth/mfa/setup', async (req, res) => {
  if (!MFA_REQUIRED) return res.status(409).json({ error: 'Two-factor authentication is not enabled on this server' });
  const user = auth.users.find(candidate => candidate.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.mfa?.secretEncrypted) return res.status(409).json({ error: 'Two-factor authentication is already enabled' });

  const challenge = mfaService.begin(user);
  const qrCodeDataUrl = await QRCode.toDataURL(challenge.otpauthUri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220
  });
  res.json({ ...challenge, qrCodeDataUrl });
});

app.post('/api/auth/mfa/enable', (req, res) => {
  if (!MFA_REQUIRED) return res.status(409).json({ error: 'Two-factor authentication is not enabled on this server' });
  const user = auth.users.find(candidate => candidate.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const result = mfaService.verify(user, req.body.challengeId, req.body.code);
  if (!result.ok || !result.enrolled) return res.status(400).json({ error: 'Invalid or expired authentication code' });

  req.session.mfaVerified = true;
  auth.saveSessions();
  res.json({ success: true, recoveryCodes: result.recoveryCodes });
});

// ROLE-BASED ACCESS CONTROL (RBAC) MIDDLEWARE
const requireAdmin = (req, res, next) => {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Forbidden' });
};

// USER MANAGEMENT ENDPOINTS (Admin Only)
app.get('/api/users', requireAdmin, (req, res) => {
  const safeUsers = auth.users.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    mfaEnabled: Boolean(u.mfa?.secretEncrypted)
  }));
  res.json(safeUsers);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (role !== 'admin' && role !== 'operator') {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }
  if (auth.users.some(u => u.username === username.toLowerCase())) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const hashedPassword = await auth.hashPassword(password);
  const newUser = {
    id: 'u_' + crypto.randomBytes(8).toString('hex'),
    username: username.toLowerCase(),
    name,
    role,
    passwordHash: hashedPassword,
    createdAt: new Date().toISOString()
  };

  auth.users.push(newUser);
  auth.saveUsers();

  res.json({
    success: true,
    user: {
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      createdAt: newUser.createdAt,
      mfaEnabled: false
    }
  });
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, role, password } = req.body;

  const user = auth.users.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.username === req.session.username && role && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot change your own administrator role' });
  }

  if (name) user.name = name;
  if (role && (role === 'admin' || role === 'operator')) user.role = role;
  if (password) {
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    user.passwordHash = await auth.hashPassword(password);
  }

  auth.saveUsers();

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      mfaEnabled: Boolean(user.mfa?.secretEncrypted)
    }
  });
});

app.delete('/api/users/:id/mfa', requireAdmin, (req, res) => {
  const user = auth.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  mfaService.reset(user);
  for (const [sid, session] of Object.entries(auth.sessions)) {
    if (session.userId === user.id) auth.destroySession(sid);
  }
  res.json({ success: true, mfaEnabled: false });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const userIndex = auth.users.findIndex(u => u.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = auth.users[userIndex];
  if (user.username === req.session.username) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (user.role === 'admin') {
    const adminCount = auth.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator account' });
    }
  }

  for (const [sid, session] of Object.entries(auth.sessions)) {
    if (session.username === user.username) {
      auth.destroySession(sid);
    }
  }

  auth.users.splice(userIndex, 1);
  auth.saveUsers();
  res.json({ success: true });
});

// =========================================================================

// REST API — list agents
app.get('/api/agents', (req, res) => {
  const list = [];
  agents.forEach((agent, id) => {
    list.push({ id, ...agent });
  });
  res.json(list);
});

// Bounded durable harness read model (authentication is enforced by the /api guard).
const harnessHandlers = createHarnessHandlers(runService);
app.get('/api/harness/runs', harnessHandlers.list);
app.get('/api/harness/runs/:id', harnessHandlers.detail);
app.get('/api/harness/runs/:id/events', harnessHandlers.events);
app.get('/api/harness/runs/:id/evidence', harnessHandlers.evidence);
app.get('/api/harness/runs/:id/children', harnessHandlers.children);
app.get('/api/harness/runs/:id/export', harnessHandlers.exportRun);

// REST API — normalized, read-only local coordination projection
app.get('/api/control-center', createControlCenterHandler(coordinationAdapter));

// ── Audio API ──
app.get('/api/audio', (req, res) => {
  const audioDir = path.join(__dirname, '..', 'public', 'audio');
  let tracks = [];
  try {
    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir);
      tracks = files
        .filter(f => f.endsWith('.mp3'))
        .map(f => {
          // Filename format: artist-title-id.mp3
          const parts = f.replace('.mp3', '').split('-');
          let artist = 'Vibe Artist';
          let name = parts[0];

          if (parts.length >= 2) {
            artist = parts[0].replace(/([A-Z])/g, ' $1').trim();
            name = parts.slice(1, -1).join(' ').replace(/\b\w/g, l => l.toUpperCase());
          }

          return {
            name: name || f,
            artist: artist,
            url: `/audio/${f}`
          };
        });
    }

    // Merge with virtual/saved streaming tracks
    const playlistPath = path.join(__dirname, '..', 'data', 'music', 'saved_playlist.json');
    if (fs.existsSync(playlistPath)) {
      try {
        const savedTracks = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
        if (Array.isArray(savedTracks)) {
          tracks = [...tracks, ...savedTracks];
        }
      } catch (err) {
        console.warn('[Music] Error loading saved playlist:', err.message);
      }
    }

    res.json(tracks);
  } catch (err) {
    console.error('Error reading audio directory:', err);
    res.status(500).json({ error: 'Failed to list audio' });
  }
});

// ── Jamendo Music Discovery API ──
app.get('/api/music/search', async (req, res) => {
  const query = req.query.q || '';

  try {
    const url = `https://api.jamendo.com/v3.0/tracks/?client_id=3dce8b55&format=json&limit=15&namesearch=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const data = await response.json();
    
    // Map Jamendo to the format the frontend expects
    const hits = (data.results || []).map(r => ({
      id: r.id,
      tags: r.name,
      user: r.artist_name,
      duration: r.duration,
      audio: r.audio
    })).filter(h => h.audio); // Only keep results with an audio stream URL

    res.json({ hits });
  } catch (err) {
    console.error('[Jamendo] Search failed:', err);
    res.status(500).json({ error: 'Failed to search Jamendo' });
  }
});

app.post('/api/music/download', async (req, res) => {
  const { url, id, tags, artist } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing track URL' });

  const musicDataDir = path.join(__dirname, '..', 'data', 'music');
  const playlistPath = path.join(musicDataDir, 'saved_playlist.json');

  try {
    if (!fs.existsSync(musicDataDir)) {
      fs.mkdirSync(musicDataDir, { recursive: true });
    }

    let savedTracks = [];
    if (fs.existsSync(playlistPath)) {
      try {
        savedTracks = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
      } catch (err) {
        console.warn('[Music] Error reading saved playlist, resetting:', err.message);
      }
    }

    // Check if duplicate track exists
    const exists = savedTracks.some(t => t.url === url || t.id === id);
    if (!exists) {
      savedTracks.push({
        id: id || Date.now().toString(),
        name: tags || 'Untitled Track',
        artist: artist || 'iTunes Discover',
        url: url
      });
      fs.writeFileSync(playlistPath, JSON.stringify(savedTracks, null, 2), 'utf8');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Music] Saving track failed:', err);
    res.status(500).json({ error: 'Failed to save track to library' });
  }
});

app.delete(
  '/api/music/library/:id',
  createRemoveTrackHandler(path.join(__dirname, '..', 'data', 'music', 'saved_playlist.json'))
);

app.get('/api/music/download-all', (req, res) => {
  const audioDir = path.join(__dirname, '..', 'public', 'audio');
  if (!fs.existsSync(audioDir)) return res.status(404).json({ error: 'No audio found' });

  const { spawn } = require('child_process');
  res.setHeader('Content-Disposition', 'attachment; filename="vibes-playlist.zip"');
  res.setHeader('Content-Type', 'application/zip');

  const zip = spawn('zip', ['-r', '-', '.'], { cwd: audioDir });
  zip.stdout.pipe(res);
  zip.stderr.on('data', (data) => console.error(`[Zip] Error: ${data}`));
});

// REST API — agent status via Vibes bridge
app.get('/api/agents/:id/status', async (req, res) => {
  const status = await vibesBridge.queryStatus(req.params.id);
  res.json({ status });
});

// REST API — FS path suggestions for autocomplete
app.get('/api/fs/suggestions', (req, res) => {
  const query = req.query.path || '';
  if (!query) return res.json([]);
  
  try {
    let dirToRead = query;
    let filePrefix = '';
    
    if (!query.endsWith(path.sep)) {
      dirToRead = path.dirname(query);
      filePrefix = path.basename(query);
    }
    
    if (!fs.existsSync(dirToRead)) {
      return res.json([]);
    }

    const files = fs.readdirSync(dirToRead, { withFileTypes: true });
    const suggestions = files
      .filter(dirent => {
        try {
          return dirent.isDirectory();
        } catch (e) {
          return false;
        }
      })
      .filter(dirent => dirent.name.toLowerCase().startsWith(filePrefix.toLowerCase()))
      .map(dirent => path.join(dirToRead, dirent.name) + path.sep);

    res.json(suggestions.slice(0, 10));
  } catch (err) {
    res.json([]);
  }
});

// REST API — load settings from settings.json in project root
app.get('/api/settings', (req, res) => {
  const settingsPath = path.join(__dirname, '..', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return res.json(JSON.parse(data));
    } catch (err) {
      console.error('[Settings] Error reading settings file:', err);
      return res.status(500).json({ error: 'Failed to read settings' });
    }
  }
  res.json({});
});

// REST API — save settings to settings.json in project root (merging with existing settings)
app.post('/api/settings', (req, res) => {
  const settingsPath = path.join(__dirname, '..', 'settings.json');
  let currentSettings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      currentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (err) {
    console.warn('[Settings] Failed to read existing settings before saving:', err.message);
  }

  const newSettings = { ...currentSettings, ...req.body };

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Error writing settings file:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// REST API — LinkedIn content calendar overview from the local PHP project
app.get('/api/linkedin/overview', (req, res) => {
  const localDataPath = path.join(__dirname, '..', 'data', 'linkedin', 'content_calendar.json');
  const legacyDataPath = '/var/www/html/LinkedIn/data/content_calendar.json';
  const linkedInDataPath = fs.existsSync(localDataPath) ? localDataPath : legacyDataPath;

  try {
    if (!fs.existsSync(linkedInDataPath)) {
      return res.json({
        sourcePath: linkedInDataPath,
        totalPosts: 0,
        statusCounts: {},
        pendingReviewCount: 0,
        latestCreatedAt: null,
        nextScheduled: null,
        recentPosts: [],
        pendingReviewPosts: [],
        updatedAt: null
      });
    }

    const raw = fs.readFileSync(linkedInDataPath, 'utf8');
    const posts = JSON.parse(raw);
    const list = Array.isArray(posts) ? posts : [];
    const statusCounts = {};

    const cleanText = (value, maxLength = 180) => {
      const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return '';
      return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
    };

    const parseDate = (value) => {
      const ts = value ? new Date(value).getTime() : Number.NaN;
      return Number.isFinite(ts) ? ts : null;
    };

    const mapPost = (post) => ({
      id: post.id,
      topic: post.topic || 'Untitled post',
      status: post.status || 'unknown',
      created_at: post.created_at || null,
      scheduled_time: post.scheduled_time || null,
      published_at: post.published_at || null,
      link: post.link || null,
      summaryPreview: cleanText(post.summary || post.content, 260),
      hasImage: Boolean(post.image_path || post.image_url)
    });

    for (const post of list) {
      const status = post.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    const byCreated = [...list].sort((a, b) => {
      const aTs = parseDate(a.created_at) ?? 0;
      const bTs = parseDate(b.created_at) ?? 0;
      return bTs - aTs;
    });

    const pendingReviewPosts = byCreated
      .filter(post => ['pending_review', 'pending'].includes(String(post.status || '').toLowerCase()))
      .slice(0, 8)
      .map(mapPost);

    const scheduled = [...list]
      .filter(post => parseDate(post.scheduled_time) !== null)
      .sort((a, b) => (parseDate(a.scheduled_time) ?? 0) - (parseDate(b.scheduled_time) ?? 0));

    const nextScheduled = scheduled.find(post => (parseDate(post.scheduled_time) ?? 0) >= Date.now()) || scheduled[0] || null;

    const recentPosts = byCreated.slice(0, 8).map(mapPost);

    const stat = fs.statSync(linkedInDataPath);

    res.json({
      sourcePath: linkedInDataPath,
      totalPosts: list.length,
      pendingReviewCount: pendingReviewPosts.length,
      statusCounts,
      latestCreatedAt: byCreated[0]?.created_at || null,
      nextScheduled: nextScheduled
        ? {
            id: nextScheduled.id,
            topic: nextScheduled.topic || 'Untitled post',
            status: nextScheduled.status || 'unknown',
            scheduled_time: nextScheduled.scheduled_time || null,
            link: nextScheduled.link || null
          }
        : null,
      recentPosts,
      pendingReviewPosts,
      updatedAt: stat.mtime.toISOString()
    });
  } catch (err) {
    console.error('[LinkedIn] Failed to build overview:', err);
    res.status(500).json({ error: 'Failed to load LinkedIn overview' });
  }
});

// REST API — update a specific LinkedIn post
app.post('/api/linkedin/posts/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status, topic, content, scheduled_time } = req.body;
  const localDataPath = path.join(__dirname, '..', 'data', 'linkedin', 'content_calendar.json');
  const legacyDataPath = '/var/www/html/LinkedIn/data/content_calendar.json';
  const linkedInDataPath = fs.existsSync(localDataPath) ? localDataPath : legacyDataPath;

  try {
    if (!fs.existsSync(linkedInDataPath)) {
      return res.status(404).json({ error: 'Content calendar not found' });
    }

    const raw = fs.readFileSync(linkedInDataPath, 'utf8');
    const posts = JSON.parse(raw);
    const postIndex = posts.findIndex(p => p.id === id);

    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (status) posts[postIndex].status = status;
    if (topic) posts[postIndex].topic = topic;
    if (content) posts[postIndex].content = content;
    if (scheduled_time) posts[postIndex].scheduled_time = scheduled_time;

    fs.writeFileSync(linkedInDataPath, JSON.stringify(posts, null, 2), 'utf8');
    res.json({ success: true, post: posts[postIndex] });
  } catch (err) {
    console.error('[LinkedIn] Failed to update post:', err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// REST API — current RSS import / trigger status from the local LinkedIn project
app.get('/api/linkedin/rss-status', (req, res) => {
  const localLogsDir = path.join(__dirname, '..', 'data', 'linkedin', 'logs');
  const legacyLogsDir = '/var/www/html/LinkedIn/logs';
  const logsDir = fs.existsSync(localLogsDir) ? localLogsDir : legacyLogsDir;

  try {
    if (!fs.existsSync(logsDir)) {
      return res.json({
        sourceDir: logsDir,
        jobCount: 0,
        latestJob: null,
        updatedAt: null
      });
    }

    const logFiles = fs.readdirSync(logsDir)
      .filter(name => /^rss_job_rss_[0-9a-f.]+\.log$/.test(name))
      .map(name => ({
        name,
        path: path.join(logsDir, name),
        stat: fs.statSync(path.join(logsDir, name))
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (!logFiles.length) {
      return res.json({
        sourceDir: logsDir,
        jobCount: 0,
        latestJob: null,
        updatedAt: fs.statSync(logsDir).mtime.toISOString()
      });
    }

    const latest = logFiles[0];
    const logs = fs.readFileSync(latest.path, 'utf8');
    const recentLogs = logs.length > 9000 ? logs.slice(-9000) : logs;
    const jobId = latest.name.replace(/^rss_job_(rss_[0-9a-f.]+)\.log$/, '$1');
    const psResult = spawnSync('ps', ['aux'], { encoding: 'utf8' });
    const processRunning = Boolean(psResult.stdout && psResult.stdout.includes(latest.name));
    const success = recentLogs.includes('RSS import completed successfully') || recentLogs.includes('Saved to calendar');
    const error = recentLogs.includes('Error generating post:') || recentLogs.includes('Traceback') || recentLogs.includes('Ollama is not available') || recentLogs.includes('Please check the endpoint.');
    const done = success || error || (!processRunning && recentLogs.length > 0);

    const lines = recentLogs.split(/\r?\n/).filter(Boolean);
    const processingCount = lines.filter(line => line.includes('Processing:')).length;
    const savedCount = lines.filter(line => line.includes('Saved to calendar')).length;
    const errorCount = lines.filter(line => line.includes('Error generating post:')).length;
    const errorDetail = error
      ? lines.find(line => /Ollama|Traceback|ModuleNotFoundError|Error generating post|ComfyUI generation failed/i.test(line)) || 'RSS import finished with errors'
      : null;
    const lastMarker = success
      ? 'RSS import completed successfully'
      : error
        ? errorDetail
        : processRunning
          ? 'Running'
          : 'No active process detected';

    res.json({
      sourceDir: logsDir,
      jobCount: logFiles.length,
      latestJob: {
        jobId,
        logPath: latest.path,
        updatedAt: latest.stat.mtime.toISOString(),
        ageSeconds: Math.max(0, Math.round((Date.now() - latest.stat.mtimeMs) / 1000)),
        done,
        running: !done,
        success,
        error,
        processRunning,
        processingCount,
        savedCount,
        errorCount,
        lastMarker,
        logExcerpt: lines.slice(-40).join('\n')
      },
      updatedAt: latest.stat.mtime.toISOString()
    });
  } catch (err) {
    console.error('[LinkedIn] Failed to build RSS status:', err);
    res.status(500).json({ error: 'Failed to load LinkedIn RSS status' });
  }
});

app.post('/api/linkedin/rss-trigger', requireAdmin, (req, res) => {
  const localProjectRoot = path.join(__dirname, '..', 'data', 'linkedin');
  const legacyProjectRoot = '/var/www/html/LinkedIn';
  const projectRoot = fs.existsSync(path.join(localProjectRoot, 'rss_to_linkedin.py')) ? localProjectRoot : legacyProjectRoot;
  
  const scriptPath = path.join(projectRoot, fs.existsSync(path.join(localProjectRoot, 'rss_to_linkedin.py')) ? 'rss_to_linkedin.py' : 'examples/rss_to_linkedin.py');
  const logsDir = path.join(projectRoot, 'logs');
  const requestedCount = Number.parseInt(req.body?.count, 10);
  const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(10, requestedCount)) : 5;

  try {
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: 'RSS script not found' });
    }

    fs.mkdirSync(logsDir, { recursive: true });

    const jobId = `rss_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
    const logFile = path.join(logsDir, `rss_job_${jobId}.log`);
    const logFd = fs.openSync(logFile, 'a');

    const child = spawn('python3', ['-u', scriptPath, '--max-posts', String(count), '--job-id', jobId], {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });

    child.unref();
    fs.closeSync(logFd);

    res.json({
      success: true,
      jobId,
      logPath: logFile,
      count
    });
  } catch (err) {
    console.error('[LinkedIn] Failed to trigger RSS import:', err);
    res.status(500).json({ error: 'Failed to trigger LinkedIn RSS import' });
  }
});

// REST API — discover and load dashboard modules dynamically
app.get('/api/modules', (req, res) => {
  const modulesDir = path.join(__dirname, '..', 'modules');
  try {
    if (!fs.existsSync(modulesDir)) {
      return res.json([]);
    }
    const dirs = fs.readdirSync(modulesDir);
    const modules = [];

    dirs.forEach(dir => {
      const dirPath = path.join(modulesDir, dir);
      const manifestPath = path.join(dirPath, 'manifest.json');
      
      if (fs.statSync(dirPath).isDirectory() && fs.existsSync(manifestPath)) {
        try {
          const manifestContent = fs.readFileSync(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestContent);
          
          if (manifest.css) {
            manifest.css = `/modules/${dir}/${manifest.css}`;
          }
          if (manifest.js) {
            manifest.js = `/modules/${dir}/${manifest.js}`;
          }
          if (manifest.html) {
            const htmlPath = path.join(dirPath, manifest.html);
            if (fs.existsSync(htmlPath)) {
              manifest.htmlContent = fs.readFileSync(htmlPath, 'utf8');
            }
            manifest.html = `/modules/${dir}/${manifest.html}`;
          }
          
          modules.push(manifest);
        } catch (e) {
          console.error(`[Modules] Failed to parse manifest for module ${dir}:`, e.message);
        }
      }
    });
    
    // Sort modules based on user preference if exists
    const user = auth.users.find(u => u.username === req.session.username);
    if (user && user.moduleOrder && Array.isArray(user.moduleOrder)) {
      modules.sort((a, b) => {
        const idxA = user.moduleOrder.indexOf(a.id);
        const idxB = user.moduleOrder.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    res.json(modules);
    } catch (err) {
    console.error('[Modules] Error scanning modules:', err);
    res.status(500).json({ error: 'Failed to list modules' });
    }
    });

    // REST API — discover available themes
    app.get('/api/themes', (req, res) => {
      const themesDir = path.join(__dirname, '..', 'public', 'themes');
      try {
        if (!fs.existsSync(themesDir)) {
          return res.json([]);
        }
        const dirs = fs.readdirSync(themesDir);
        const themes = [];

        dirs.forEach(dir => {
          const dirPath = path.join(themesDir, dir);
          const manifestPath = path.join(dirPath, 'manifest.json');

          if (fs.statSync(dirPath).isDirectory() && fs.existsSync(manifestPath)) {
            try {
              const manifestContent = fs.readFileSync(manifestPath, 'utf8');
              const manifest = JSON.parse(manifestContent);
              manifest.path = `/themes/${dir}/theme.css`;
              themes.push(manifest);
            } catch (e) {
              console.error(`[Themes] Failed to parse manifest for theme ${dir}:`, e.message);
            }
          }
        });

        res.json(themes);
      } catch (err) {
        console.error('[Themes] Error scanning themes:', err);
        res.status(500).json({ error: 'Failed to list themes' });
      }
    });

    // REST API — proxy for LLM connection testing (avoids CORS issues)
    app.post('/api/llm/proxy/models', async (req, res) => {
      const { host, key } = req.body;
      if (!host) return res.status(400).json({ error: 'Host URL is required' });

      try {
        const url = `${host.replace(/\/+$/, '')}/models`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            ...(key ? { 'Authorization': `Bearer ${key}` } : {})
          }
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).send(errText);
        }

        const data = await response.json();
        res.json(data);
      } catch (err) {
        console.error('[LLM Proxy] Connection failed:', err.message);
        res.status(500).json({ error: `Connection failed: ${err.message}` });
      }
    });

    app.post('/api/llm/proxy/ollama-tags', async (req, res) => {
      const { host } = req.body;
      if (!host) return res.status(400).json({ error: 'Host URL is required' });

      try {
        const url = `${host.replace(/\/+$/, '')}/api/tags`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        res.json(data);
      } catch (err) {
        console.error('[Ollama Proxy] Connection failed:', err.message);
        res.status(500).json({ error: `Connection failed: ${err.message}` });
      }
    });

// REST API — save user sidebar modules order preference
app.post('/api/users/module-order', (req, res) => {
  const { moduleOrder } = req.body;
  if (!moduleOrder || !Array.isArray(moduleOrder)) {
    return res.status(400).json({ error: 'Invalid module order format' });
  }

  const success = auth.saveUserPreference(req.session.username, 'moduleOrder', moduleOrder);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'User profile not found' });
  }
});

// Helper function to rewrite CSS url(...) declarations
function rewriteCss(css, baseUrl, dashboardOrigin, csrfToken) {
  return css.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, val) => {
    const cleanVal = val.trim();
    if (!cleanVal || cleanVal.startsWith('data:') || cleanVal.startsWith('javascript:') || cleanVal.startsWith('#')) {
      return match;
    }
    try {
      const resolvedUrl = new URL(cleanVal, baseUrl).href;
      if (resolvedUrl.startsWith(dashboardOrigin)) {
        return match;
      }
      let proxyUrl = `/api/proxy?url=${encodeURIComponent(resolvedUrl)}`;
      if (csrfToken) {
        proxyUrl += `&csrf=${encodeURIComponent(csrfToken)}`;
      }
      return `url(${quote}${proxyUrl}${quote})`;
    } catch (e) {
      return match;
    }
  });
}

// Helper function to rewrite HTML attributes (href, src, action) and styling
function rewriteHtml(html, baseUrl, dashboardOrigin, csrfToken) {
  // Rewrite href, src, action attributes
  let rewritten = html.replace(/(href|src|action)\s*=\s*(['"])(.*?)\2/gi, (match, attr, quote, value) => {
    const cleanValue = value.trim();
    if (!cleanValue || cleanValue.startsWith('javascript:') || cleanValue.startsWith('mailto:') || cleanValue.startsWith('data:') || cleanValue.startsWith('#')) {
      return match;
    }
    if (cleanValue.includes('/api/proxy?url=')) {
      return match;
    }
    try {
      const resolvedUrl = new URL(cleanValue, baseUrl).href;
      if (resolvedUrl.startsWith(dashboardOrigin)) {
        return match;
      }
      let proxyUrl = `/api/proxy?url=${encodeURIComponent(resolvedUrl)}`;
      if (csrfToken) {
        proxyUrl += `&csrf=${encodeURIComponent(csrfToken)}`;
      }
      return `${attr}=${quote}${proxyUrl}${quote}`;
    } catch (e) {
      return match;
    }
  });

  // Rewrite <style> blocks
  rewritten = rewritten.replace(/<style([\s\S]*?)>([\s\S]*?)<\/style>/gi, (match, attrs, cssContent) => {
    const rewrittenCss = rewriteCss(cssContent, baseUrl, dashboardOrigin, csrfToken);
    return `<style${attrs}>${rewrittenCss}</style>`;
  });

  // Rewrite inline style attributes
  rewritten = rewritten.replace(/style\s*=\s*(['"])(.*?)\1/gi, (match, quote, styleContent) => {
    const rewrittenStyle = rewriteCss(styleContent, baseUrl, dashboardOrigin, csrfToken);
    return `style=${quote}${rewrittenStyle}${quote}`;
  });

  return rewritten;
}

// Helper to check if an IP address is a local/private/reserved IP (for SSRF mitigation)
function isPrivateIp(ip) {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase().trim();
    if (normalized === '::1' || normalized === '::') {
      return true;
    }
    // fe80::/10 (Link-local)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }
    // fc00::/7 (ULA)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    // IPv4-mapped IPv6 (::ffff:127.0.0.1 etc.)
    if (normalized.startsWith('::ffff:')) {
      const ipv4Part = normalized.substring(7);
      return isPrivateIp(ipv4Part);
    }
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return true; // Treat malformed IPs as unsafe
  }
  const [p0, p1, p2, p3] = parts;

  // 127.0.0.0/8 (Loopback)
  if (p0 === 127) return true;
  // 10.0.0.0/8 (Private)
  if (p0 === 10) return true;
  // 172.16.0.0/12 (Private)
  if (p0 === 172 && (p1 >= 16 && p1 <= 31)) return true;
  // 192.168.0.0/16 (Private)
  if (p0 === 192 && p1 === 168) return true;
  // 169.254.0.0/16 (Link-local)
  if (p0 === 169 && p1 === 254) return true;
  // 0.0.0.0/8 (Broadcast/Any)
  if (p0 === 0) return true;
  // 224.0.0.0/4 (Multicast)
  if (p0 >= 224 && p0 <= 239) return true;
  // 255.255.255.255/32 (Broadcast)
  if (p0 === 255) return true;

  return false;
}

// REST API — proxy external web requests to bypass Content Security Policy (CSP) and X-Frame-Options framing restrictions
app.get('/api/proxy', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  // Authenticate session securely using cookies or query-based csrf token (to support sandboxed iframe subresources)
  let session = null;
  const sessionId = req.cookies['__Host-session-id'];
  if (sessionId && isSessionValid(auth.sessions[sessionId], { mfaRequired: MFA_REQUIRED })) {
    session = auth.sessions[sessionId];
  } else {
    const queryCsrf = req.query.csrf;
    if (queryCsrf) {
      for (const s of Object.values(auth.sessions)) {
        if (s.csrfToken === queryCsrf && isSessionValid(s, { mfaRequired: MFA_REQUIRED })) {
          session = s;
          break;
        }
      }
    }
  }

  if (!session) {
    return res.status(401).send('Unauthorized');
  }

  const csrfToken = session.csrfToken;

  // Normalize and validate target URL to prevent SSRF (Server-Side Request Forgery)
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).send('Invalid url');
  }

  // Normalize localhost to 127.0.0.1 to avoid IPv6 resolution issues with Node fetch
  if (parsedUrl.hostname === 'localhost') {
    parsedUrl.hostname = '127.0.0.1';
    targetUrl = parsedUrl.href;
  }

  // SSRF Protection: Resolve hostname and verify resolved IPs are not private/loopback/multicast
  try {
    const dns = require('dns').promises;
    const dnsLookup = await dns.lookup(parsedUrl.hostname, { all: true });
    const ips = dnsLookup.map(r => r.address);
    
    const hasPrivate = ips.some(ip => isPrivateIp(ip));
    if (hasPrivate) {
      const allowLocal = process.env.ALLOW_LOCAL_PROXY === 'true' || process.env.NODE_ENV !== 'production';
      if (!allowLocal) {
        console.warn(`[Proxy] Blocked SSRF attempt to private IP(s) ${ips.join(', ')} for hostname: ${parsedUrl.hostname}`);
        return res.status(403).send('Access to local/private network addresses is forbidden.');
      } else {
        console.log(`[Proxy] Allowing proxy request to private IP(s) ${ips.join(', ')} in development/local mode`);
      }
    }
  } catch (err) {
    const allowLocal = process.env.ALLOW_LOCAL_PROXY === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowLocal) {
      console.warn(`[Proxy] DNS resolution failed for hostname ${parsedUrl.hostname}: ${err.message}`);
      return res.status(400).send('Invalid target hostname or DNS resolution failed');
    }
  }

  try {

    let response;
    try {
      response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
    } catch (err) {
      const isLocalTarget = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === '::1' || parsedUrl.hostname.endsWith('.local');
      if (isLocalTarget && targetUrl.startsWith('https://')) {
        const fallbackUrl = targetUrl.replace(/^https:\/\//i, 'http://');
        console.log(`[Proxy] HTTPS fetch failed for local target ${targetUrl}. Falling back to HTTP: ${fallbackUrl}`);
        try {
          parsedUrl = new URL(fallbackUrl);
          response = await fetch(fallbackUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
        } catch (fallbackErr) {
          throw new Error(`HTTPS failed (${err.message}) and fallback HTTP failed: ${fallbackErr.message}`);
        }
      } else {
        throw err;
      }
    }

    const finalUrl = response.url || targetUrl;
    const finalParsedUrl = new URL(finalUrl);

    // Copy Content-Type header if present
    let contentType = response.headers.get('content-type');
    if (contentType) {
      // Clean up Content-Type (handle multiple/comma-separated media types e.g. from CDNs)
      contentType = contentType.split(',')[0].trim();
      res.setHeader('content-type', contentType);
    }

    // Strip framing-related headers from target response
    res.removeHeader('content-security-policy');
    res.removeHeader('content-security-policy-report-only');
    res.removeHeader('x-frame-options');

    const dashboardOrigin = `${req.protocol}://${req.get('host')}`;

    if (contentType && contentType.includes('text/html')) {
      let html = await response.text();
      html = rewriteHtml(html, finalUrl, dashboardOrigin, csrfToken);

      // Inject secure sandbox-to-parent communication script
      const scriptToInject = `
<!-- Sandbox communication script -->
<script>
  (function() {
    if (window.parent && window.parent !== window) {
      // Sync address bar on page load
      window.parent.postMessage({ type: 'browser-load', url: window.location.href }, window.location.origin);
      
      // Intercept link clicks to navigate inside the parent frame
      document.addEventListener('click', function(e) {
        var anchor = e.target.closest('a');
        if (anchor) {
          var href = anchor.getAttribute('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
            e.preventDefault();
            window.parent.postMessage({ type: 'browser-navigate', url: anchor.href }, window.location.origin);
          }
        }
      }, true);
    }
  })();
</script>
`;

      if (html.includes('</body>')) {
        html = html.replace('</body>', scriptToInject + '</body>');
      } else if (html.includes('</BODY>')) {
        html = html.replace('</BODY>', scriptToInject + '</BODY>');
      } else {
        html = html + scriptToInject;
      }

      res.send(html);
    } else if (contentType && (contentType.includes('text/css') || finalParsedUrl.pathname.endsWith('.css'))) {
      let css = await response.text();
      css = rewriteCss(css, finalUrl, dashboardOrigin, csrfToken);
      res.send(css);
    } else {
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    console.error(`[Proxy] Error fetching ${targetUrl}:`, err.message);
    res.removeHeader('content-type'); // Prevent Express crash if content-type was invalid
    res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

// Authenticate socket connections
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  let sessionId = null;
  if (cookieHeader) {
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        cookies[name] = decodeURIComponent(val);
      }
    });
    sessionId = cookies['__Host-session-id'];
  }
  
  if (sessionId && isSessionValid(auth.sessions[sessionId], { mfaRequired: MFA_REQUIRED })) {
    socket.session = auth.sessions[sessionId];
    next();
  } else {
    next(new Error('Unauthorized socket connection'));
  }
});

// WebSocket events
io.on('connection', (socket) => {
  console.log(`[Dashboard] Client connected: ${socket.id}`);

  // Send current agent state on connect
  const snapshot = [];
  agents.forEach((agent, id) => snapshot.push({ id, ...agent }));
  socket.emit('agents-snapshot', snapshot);

  // Durable lifecycle handlers share one tested error boundary and controller seam.
  socket.on('agent-create', safeSocketHandler(socket, 'agent-create', async data => {
    const isExplicitlyDisabled = data.llmPrefs?.provider === 'disabled';
    const useRealVibes = process.env.USE_VIBES === 'true' || (hasVibes && process.env.USE_VIBES !== 'false' && !isExplicitlyDisabled);
    return agentController.create(data, useRealVibes);
  }));
  socket.on('agent-accept', safeSocketHandler(socket, 'agent-accept', data => agentController.accept(data.id)));
  socket.on('agent-decline', safeSocketHandler(socket, 'agent-decline', async data => {
    vibesBridge.terminate(data.id);
    await runService.declinePlan(data.id, { reason: data.reason || 'operator declined', operationKey: `decline:${data.id}` });
    io.emit('agent-removed', { id: data.id });
  }));
  socket.on('agent-terminate', safeSocketHandler(socket, 'agent-terminate', data => agentController.terminate(data.id)));
  socket.on('agent-retry', safeSocketHandler(socket, 'agent-retry', data => agentController.retry(data.id)));
  socket.on('agent-retry-task', safeSocketHandler(socket, 'agent-retry-task', data => agentController.retryTask(data.id, data.taskId)));

  // Request logs for an agent
  socket.on('agent-logs', (data) => {
    const agent = agents.get(data.id);
    if (agent) {
      socket.emit('agent-logs-response', { id: data.id, logs: agent.logs || [] });
    }
  });

  // ── Terminal Exec Socket Listeners ──
  socket.activeTerminalProcess = null;

  socket.on('terminal-run', ({ command, cwd }) => {
    const args = command.trim().split(/\s+/);
    if (args[0] === 'cd') {
      let targetDir = args[1] || '';
      if (!targetDir) {
        targetDir = process.env.HOME || '/';
      } else {
        if (targetDir.startsWith('~')) {
          targetDir = targetDir.replace('~', process.env.HOME || '/');
        }
        targetDir = path.resolve(cwd, targetDir);
      }

      if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
        socket.emit('terminal-output', { type: 'cwd-update', cwd: targetDir });
        socket.emit('terminal-output', { type: 'exit', code: 0 });
      } else {
        socket.emit('terminal-output', { type: 'stderr', data: `cd: no such file or directory: ${args[1] || ''}\n` });
        socket.emit('terminal-output', { type: 'exit', code: 1 });
      }
      return;
    }

    try {
      const child = spawn(command, [], {
        shell: true,
        cwd: cwd || process.cwd(),
        env: { ...process.env, FORCE_COLOR: '1' }
      });

      socket.activeTerminalProcess = child;

      child.stdout.on('data', (data) => {
        socket.emit('terminal-output', { type: 'stdout', data: data.toString() });
      });

      child.stderr.on('data', (data) => {
        socket.emit('terminal-output', { type: 'stderr', data: data.toString() });
      });

      child.on('close', (code) => {
        socket.activeTerminalProcess = null;
        socket.emit('terminal-output', { type: 'exit', code: code });
      });

      child.on('error', (err) => {
        socket.activeTerminalProcess = null;
        socket.emit('terminal-output', { type: 'stderr', data: `System Error: ${err.message}\n` });
        socket.emit('terminal-output', { type: 'exit', code: 1 });
      });

    } catch (err) {
      socket.activeTerminalProcess = null;
      socket.emit('terminal-output', { type: 'stderr', data: `Failed to spawn process: ${err.message}\n` });
      socket.emit('terminal-output', { type: 'exit', code: 1 });
    }
  });

  socket.on('terminal-kill', () => {
    if (socket.activeTerminalProcess) {
      socket.activeTerminalProcess.kill();
      socket.activeTerminalProcess = null;
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Dashboard] Client disconnected: ${socket.id}`);
    if (socket.activeTerminalProcess) {
      socket.activeTerminalProcess.kill();
      socket.activeTerminalProcess = null;
    }
  });
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n[Dashboard] Shutting down...');
  vibesBridge.terminateAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  vibesBridge.terminateAll();
  process.exit(0);
});

const startupPromise = Promise.all([auth.initializationPromise, restorePromise, verificationPolicy]);

startupPromise.then(() => server.listen(PORT, HOST, () => {
  const usingHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);
  const httpsProt = usingHttps ? 'https' : 'http';
  const httpProt = 'http';
  console.log(`\n  🌌 Vibes Dashboard`);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✦ ${usingHttps ? 'HTTPS' : 'HTTP'} server running on port ${PORT}`);
  console.log(`  ✦ Local:    ${usingHttps ? httpsProt : httpProt}://localhost:${PORT}  (use for microphone)`);
  console.log(`  ✦ Network:  ${httpsProt}://192.168.5.215:${PORT}`);
  console.log(`  ✦ WebSocket ready`);
  console.log(`  ✦ Mode: ${USE_VIBES ? '🤖 Real Vibes Agents' : '🎭 Demo Simulation'}`);
  if (usingHttps) {
    console.log(`  ✦ SSL: self-signed cert — accept browser warning on first visit`);
  } else {
    console.log(`  ✦ No SSL certs found. Mic may not work on LAN. Run generate_cert.sh`);
  }
  console.log();
})).catch(error => {
  console.error('[Harness] Startup failed:', error);
  process.exitCode = 1;
});
