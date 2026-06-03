const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { VibesBridge } = require('./vibes-bridge');
const { spawn } = require('child_process');

const app = express();
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

const PORT = process.env.PORT || 9000;
const HOST = process.env.HOST || '0.0.0.0';

const vibesRoot = process.env.VIBES_PATH || path.join(require('os').homedir(), 'Vibes');
const serverScript = path.join(vibesRoot, 'src', 'mcp', 'server.ts');
const hasVibes = fs.existsSync(serverScript);

// Auto-enable real vibes mode if the Vibes repository exists and USE_VIBES is not explicitly disabled
const USE_VIBES = process.env.USE_VIBES === 'true' || (hasVibes && process.env.USE_VIBES !== 'false');

// Serve static files from public/
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/modules', express.static(path.join(__dirname, '..', 'modules')));
app.use(express.json());

// In-memory agent registry
const agents = new Map();

// Vibes Bridge (real orchestration)
const vibesBridge = new VibesBridge();

vibesBridge.on('agent-status', (data) => {
  const agent = agents.get(data.id);
  if (agent && data.log) {
    // Intercept task status events
    if (data.log.startsWith('[TASK_STATUS] ')) {
      try {
        const taskStatus = JSON.parse(data.log.substring(14));
        if (agent.tasks) {
          const taskIdx = agent.tasks.findIndex(t => t.name === taskStatus.name);
          if (taskIdx >= 0) {
            agent.tasks[taskIdx].status = taskStatus.status;
            if (taskStatus.status === 'complete') {
              const completedCount = agent.tasks.filter(t => t.status === 'complete').length;
              agent.completedTasks = completedCount;
              agent.progress = Math.round((completedCount / agent.totalTasks) * 100);
            } else if (taskStatus.status === 'failed') {
              agent.status = 'error';
            }
            io.emit('agent-updated', { id: data.id, ...agent });
          }
        }
      } catch (e) { }
      return; // Do not push internal status to live logs
    }

    if (!agent.logs) agent.logs = [];
    agent.logs.push({ time: new Date().toISOString(), message: data.log });
    // Keep only last 200 log lines
    if (agent.logs.length > 200) agent.logs = agent.logs.slice(-200);
    io.emit('agent-log', { id: data.id, log: data.log });
  }
});

vibesBridge.on('agent-error', (data) => {
  const agent = agents.get(data.id);
  if (agent) {
    agent.status = 'error';
    agent.error = data.error;
    io.emit('agent-updated', { id: data.id, ...agent });
  }
});

vibesBridge.on('agent-exit', (data) => {
  const agent = agents.get(data.id);
  if (agent && agent.status === 'executing') {
    agent.status = data.code === 0 ? 'complete' : 'error';
    io.emit('agent-updated', { id: data.id, ...agent });
  }
});

// REST API — list agents
app.get('/api/agents', (req, res) => {
  const list = [];
  agents.forEach((agent, id) => {
    list.push({ id, ...agent });
  });
  res.json(list);
});

// ── Audio API ──
app.get('/api/audio', (req, res) => {
  const audioDir = path.join(__dirname, '..', 'public', 'audio');
  try {
    if (!fs.existsSync(audioDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(audioDir);
    const tracks = files
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
    res.json(tracks);
  } catch (err) {
    console.error('Error reading audio directory:', err);
    res.status(500).json({ error: 'Failed to list audio' });
  }
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
    
    res.json(modules);
  } catch (err) {
    console.error('[Modules] Error loading modules:', err);
    res.status(500).json({ error: 'Failed to load modules' });
  }
});

// Helper function to rewrite CSS url(...) declarations
function rewriteCss(css, baseUrl, dashboardOrigin) {
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
      return `url(${quote}/api/proxy?url=${encodeURIComponent(resolvedUrl)}${quote})`;
    } catch (e) {
      return match;
    }
  });
}

// Helper function to rewrite HTML attributes (href, src, action) and styling
function rewriteHtml(html, baseUrl, dashboardOrigin) {
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
      return `${attr}=${quote}/api/proxy?url=${encodeURIComponent(resolvedUrl)}${quote}`;
    } catch (e) {
      return match;
    }
  });

  // Rewrite <style> blocks
  rewritten = rewritten.replace(/<style([\s\S]*?)>([\s\S]*?)<\/style>/gi, (match, attrs, cssContent) => {
    const rewrittenCss = rewriteCss(cssContent, baseUrl, dashboardOrigin);
    return `<style${attrs}>${rewrittenCss}</style>`;
  });

  // Rewrite inline style attributes
  rewritten = rewritten.replace(/style\s*=\s*(['"])(.*?)\1/gi, (match, quote, styleContent) => {
    const rewrittenStyle = rewriteCss(styleContent, baseUrl, dashboardOrigin);
    return `style=${quote}${rewrittenStyle}${quote}`;
  });

  return rewritten;
}

// REST API — proxy external web requests to bypass Content Security Policy (CSP) and X-Frame-Options framing restrictions
app.get('/api/proxy', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  // Normalize localhost to 127.0.0.1 to avoid IPv6 resolution issues with Node fetch
  try {
    const urlObj = new URL(targetUrl);
    if (urlObj.hostname === 'localhost') {
      urlObj.hostname = '127.0.0.1';
      targetUrl = urlObj.href;
    }
  } catch (e) {}

  try {
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return res.status(400).send('Invalid url');
    }

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
      html = rewriteHtml(html, finalUrl, dashboardOrigin);

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
      css = rewriteCss(css, finalUrl, dashboardOrigin);
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

// WebSocket events
io.on('connection', (socket) => {
  console.log(`[Dashboard] Client connected: ${socket.id}`);

  // Send current agent state on connect
  const snapshot = [];
  agents.forEach((agent, id) => snapshot.push({ id, ...agent }));
  socket.emit('agents-snapshot', snapshot);

  // Create a new agent
  socket.on('agent-create', (data) => {
    const id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    // Dynamically decide whether to run a real Vibes agent or simulated demo
    const hasLlmPrefs = data.llmPrefs && data.llmPrefs.provider && data.llmPrefs.provider !== 'disabled';
    const isExplicitlyDisabled = data.llmPrefs && data.llmPrefs.provider === 'disabled';
    const useRealVibes = process.env.USE_VIBES === 'true' || (hasVibes && process.env.USE_VIBES !== 'false' && !isExplicitlyDisabled);

    const agent = {
      mission: data.mission || 'Unnamed Mission',
      cwd: data.cwd || '~/',
      status: 'planning',
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
      tasks: [],
      logs: [],
      createdAt: new Date().toISOString(),
      useVibes: useRealVibes,
      llmPrefs: data.llmPrefs,
    };
    agents.set(id, agent);
    io.emit('agent-created', { id, ...agent });
    console.log(`[Agent] Created: ${id} — "${agent.mission}" (mode: ${useRealVibes ? 'vibes' : 'demo'})`);

    if (useRealVibes) {
      // Real Vibes integration
      handleVibesAgent(id, agent, data.llmPrefs);
    } else {
      // Demo simulation
      handleDemoAgent(id, agent);
    }
  });

  // Accept proposed tasks
  socket.on('agent-accept', (data) => {
    const agent = agents.get(data.id);
    if (!agent) return;
    agent.status = 'executing';
    io.emit('agent-updated', { id: data.id, ...agent });

    if (!agent.useVibes) {
      simulateExecution(data.id, agent);
    } else {
      handleVibesExecution(data.id, agent);
    }
  });

  // Decline proposed tasks
  socket.on('agent-decline', (data) => {
    vibesBridge.terminate(data.id);
    agents.delete(data.id);
    io.emit('agent-removed', { id: data.id });
  });

  // Terminate agent
  socket.on('agent-terminate', (data) => {
    const agent = agents.get(data.id);
    if (agent) {
      agent.status = 'terminated';
      vibesBridge.terminate(data.id);
      if (activeIntervals.has(data.id)) {
        clearInterval(activeIntervals.get(data.id));
        activeIntervals.delete(data.id);
      }
      io.emit('agent-updated', { id: data.id, ...agent });
      setTimeout(() => {
        agents.delete(data.id);
        io.emit('agent-removed', { id: data.id });
      }, 800);
    }
  });

  // Retry full agent execution
  socket.on('agent-retry', (data) => {
    const agent = agents.get(data.id);
    if (!agent) return;
    
    if (activeIntervals.has(data.id)) {
      clearInterval(activeIntervals.get(data.id));
      activeIntervals.delete(data.id);
    }
    
    agent.status = 'planning';
    agent.progress = 0;
    agent.completedTasks = 0;
    agent.tasks = [];
    agent.logs = [];
    agent.error = null;
    io.emit('agent-updated', { id: data.id, ...agent });

    if (!agent.useVibes) {
      handleDemoAgent(data.id, agent, true);
    } else {
      // Terminate any existing instance first
      vibesBridge.terminate(data.id);
      // Start a new instance
      handleVibesAgent(data.id, agent, agent.llmPrefs, true);
    }
  });

  // Retry from a specific task index
  socket.on('agent-retry-task', (data) => {
    const agent = agents.get(data.id);
    if (!agent || !agent.tasks) return;
    const taskIdx = agent.tasks.findIndex(t => t.id === data.taskId);
    if (taskIdx === -1) return;

    // Reset this task and all subsequent tasks to pending
    for (let i = taskIdx; i < agent.tasks.length; i++) {
      agent.tasks[i].status = 'pending';
    }

    agent.status = 'executing';
    
    // Recalculate progress/completedTasks
    const completedCount = agent.tasks.filter(t => t.status === 'complete').length;
    agent.completedTasks = completedCount;
    agent.progress = Math.round((completedCount / agent.totalTasks) * 100);

    io.emit('agent-updated', { id: data.id, ...agent });

    if (!agent.useVibes) {
      simulateExecution(data.id, agent, taskIdx);
    } else {
      const instance = vibesBridge.instances.get(data.id);
      if (instance) {
        // Resolve the pending intervention with 'retry' action and the taskId
        instance.resolveIntervention('retry', undefined, data.taskId)
          .catch(err => {
            console.error(`[Vibes] Failed to resolve intervention for task retry:`, err.message);
          });
      } else {
        // Process is dead. Let's restart the agent.
        console.warn(`[Vibes] Process not running. Performing full retry instead.`);
        agent.status = 'planning';
        agent.progress = 0;
        agent.completedTasks = 0;
        agent.tasks = [];
        agent.logs = [];
        io.emit('agent-updated', { id: data.id, ...agent });
        handleVibesAgent(data.id, agent, agent.llmPrefs);
      }
    }
  });

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

// ── Real Vibes Agent Handler ──
async function handleVibesAgent(id, agent, llmPrefs, autoLaunch = false) {
  try {
    console.log(`[Vibes] Starting real agent planning for: ${agent.mission}`);
    const result = await vibesBridge.createAgent(id, agent.cwd, agent.mission, llmPrefs);

    if (result && result.content) {
      const text = typeof result.content === 'string'
        ? result.content
        : (result.content[0]?.text || JSON.stringify(result.content));

      try {
        const tasks = JSON.parse(text);
        agent.tasks = tasks;
        agent.totalTasks = tasks.length;
        if (autoLaunch) {
          agent.status = 'executing';
          io.emit('agent-updated', { id, ...agent });
          handleVibesExecution(id, agent);
        } else {
          agent.status = 'review';
          io.emit('agent-updated', { id, ...agent });
        }
      } catch (e) {
        agent.status = 'error';
        agent.error = 'Failed to parse mission plan JSON.';
        io.emit('agent-updated', { id, ...agent });
      }
    }
  } catch (err) {
    console.error(`[Vibes] Agent ${id} failed:`, err.message);
    agent.status = 'error';
    agent.error = err.message;
    io.emit('agent-updated', { id, ...agent });
  }
}

async function handleVibesExecution(id, agent) {
  try {
    const result = await vibesBridge.executePlannedMission(id);
    if (result && result.content) {
      const text = typeof result.content === 'string'
        ? result.content
        : (result.content[0]?.text || JSON.stringify(result.content));

      agent.status = 'complete';
      agent.progress = 100;
      agent.completedTasks = agent.totalTasks;
      agent.logs.push({ time: new Date().toISOString(), message: `Mission result: ${text}` });
      io.emit('agent-updated', { id, ...agent });
    }
  } catch (err) {
    console.error(`[Vibes] Agent execution failed:`, err.message);
    agent.status = 'error';
    agent.error = err.message;
    io.emit('agent-updated', { id, ...agent });
  }
}

// ── Demo Agent Handler ──
function handleDemoAgent(id, agent, autoLaunch = false) {
  setTimeout(() => {
    if (!agents.has(id)) return;
    const tasks = generateDemoTasks(agent.mission);
    agent.tasks = tasks;
    agent.totalTasks = tasks.length;
    if (autoLaunch) {
      agent.status = 'executing';
      io.emit('agent-updated', { id, ...agent });
      simulateExecution(id, agent, 0);
    } else {
      agent.status = 'review';
      io.emit('agent-updated', { id, ...agent });
    }
  }, 2500);
}

// Demo task generation
function generateDemoTasks(mission) {
  const taskTemplates = [
    'Analyze project structure and dependencies',
    'Create implementation plan',
    'Setup core module scaffolding',
    'Implement primary logic',
    'Write unit tests',
    'Integrate with existing codebase',
    'Run validation suite',
    'Polish and finalize',
  ];
  const count = 4 + Math.floor(Math.random() * 5);
  return taskTemplates.slice(0, count).map((name, i) => ({
    id: i + 1,
    name,
    status: 'pending',
  }));
}

// Keep track of active simulation intervals
const activeIntervals = new Map();

// Simulated execution starting from a specific task index
function simulateExecution(id, agent, startIdx = 0) {
  if (activeIntervals.has(id)) {
    clearInterval(activeIntervals.get(id));
  }

  let taskIndex = startIdx;
  const interval = setInterval(() => {
    const currentAgent = agents.get(id);
    if (!currentAgent || currentAgent.status === 'terminated' || currentAgent.status === 'complete') {
      clearInterval(interval);
      activeIntervals.delete(id);
      return;
    }

    if (currentAgent.tasks && taskIndex < currentAgent.tasks.length) {
      const currentIdx = taskIndex;
      taskIndex++; // Increment immediately for the next interval iteration

      currentAgent.tasks[currentIdx].status = 'in-progress';
      io.emit('agent-updated', { id, ...currentAgent });

      setTimeout(() => {
        const liveAgent = agents.get(id);
        if (!liveAgent || !liveAgent.tasks || !liveAgent.tasks[currentIdx]) return;

        liveAgent.tasks[currentIdx].status = 'complete';
        const completedCount = liveAgent.tasks.filter(t => t.status === 'complete').length;
        liveAgent.completedTasks = completedCount;
        liveAgent.progress = Math.round((completedCount / liveAgent.totalTasks) * 100);

        if (liveAgent.completedTasks >= liveAgent.totalTasks) {
          liveAgent.status = 'complete';
        }

        io.emit('agent-updated', { id, ...liveAgent });
      }, 2000 + Math.random() * 3000);
    } else if (currentAgent.tasks && taskIndex >= currentAgent.tasks.length) {
      clearInterval(interval);
      activeIntervals.delete(id);
    }
  }, 4000 + Math.random() * 2000);

  activeIntervals.set(id, interval);
}

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

server.listen(PORT, HOST, () => {
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
});
