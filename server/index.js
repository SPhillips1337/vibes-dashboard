const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { VibesBridge } = require('./vibes-bridge');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const USE_VIBES = process.env.USE_VIBES === 'true';

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
      useVibes: USE_VIBES,
    };
    agents.set(id, agent);
    io.emit('agent-created', { id, ...agent });
    console.log(`[Agent] Created: ${id} — "${agent.mission}" (mode: ${USE_VIBES ? 'vibes' : 'demo'})`);

    if (USE_VIBES) {
      // Real Vibes integration
      handleVibesAgent(id, agent);
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

    if (!USE_VIBES) {
      simulateExecution(data.id, agent);
    }
    // For real Vibes, execution already started with the mission
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
async function handleVibesAgent(id, agent) {
  try {
    console.log(`[Vibes] Starting real agent for: ${agent.mission}`);
    const result = await vibesBridge.createAgent(id, agent.cwd, agent.mission);

    // Parse the result — the execute_mission tool returns a summary string
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
    console.error(`[Vibes] Agent ${id} failed:`, err.message);
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

server.listen(PORT, () => {
  console.log(`\n  🌌 Glass Vibes Dashboard`);
  console.log(`  ━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✦ Server running at http://localhost:${PORT}`);
  console.log(`  ✦ WebSocket ready`);
  console.log(`  ✦ Mode: ${USE_VIBES ? '🤖 Real Vibes Agents' : '🎭 Demo Simulation'}`);
  console.log(`  ✦ Set USE_VIBES=true to connect to real Vibes\n`);
});
