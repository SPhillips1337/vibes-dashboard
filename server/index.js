const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const { VibesBridge } = require('./vibes-bridge');

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
            }
            io.emit('agent-updated', { id: data.id, ...agent });
          }
        }
      } catch (e) {}
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
      io.emit('agent-updated', { id: data.id, ...agent });
      setTimeout(() => {
        agents.delete(data.id);
        io.emit('agent-removed', { id: data.id });
      }, 800);
    }
  });

  // Request logs for an agent
  socket.on('agent-logs', (data) => {
    const agent = agents.get(data.id);
    if (agent) {
      socket.emit('agent-logs-response', { id: data.id, logs: agent.logs || [] });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Dashboard] Client disconnected: ${socket.id}`);
  });
});

// ── Real Vibes Agent Handler ──
async function handleVibesAgent(id, agent, llmPrefs) {
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
        agent.status = 'review';
        io.emit('agent-updated', { id, ...agent });
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
function handleDemoAgent(id, agent) {
  setTimeout(() => {
    if (!agents.has(id)) return;
    const tasks = generateDemoTasks(agent.mission);
    agent.tasks = tasks;
    agent.totalTasks = tasks.length;
    agent.status = 'review';
    io.emit('agent-updated', { id, ...agent });
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

// Simulated execution
function simulateExecution(id, agent) {
  let taskIndex = 0;
  const interval = setInterval(() => {
    if (!agents.has(id) || agent.status === 'terminated' || agent.status === 'complete') {
      clearInterval(interval);
      return;
    }

    if (agent.tasks && taskIndex < agent.tasks.length) {
      const currentIdx = taskIndex;
      taskIndex++; // Increment immediately for the next interval iteration

      agent.tasks[currentIdx].status = 'in-progress';
      io.emit('agent-updated', { id, ...agent });

      setTimeout(() => {
        const currentAgent = agents.get(id);
        if (!currentAgent || !currentAgent.tasks || !currentAgent.tasks[currentIdx]) return;

        currentAgent.tasks[currentIdx].status = 'complete';
        currentAgent.completedTasks = currentIdx + 1;
        currentAgent.progress = Math.round(((currentIdx + 1) / currentAgent.totalTasks) * 100);

        if (currentAgent.completedTasks >= currentAgent.totalTasks) {
          currentAgent.status = 'complete';
        }

        io.emit('agent-updated', { id, ...currentAgent });
      }, 2000 + Math.random() * 3000);
    } else if (agent.tasks && taskIndex >= agent.tasks.length) {
      clearInterval(interval);
    }
  }, 4000 + Math.random() * 2000);
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
  console.log(`\n  🌌 Glass Vibes Dashboard`);
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
