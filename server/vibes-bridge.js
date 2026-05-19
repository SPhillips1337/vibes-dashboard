/* ═══════════════════════════════════════
   Vibes Bridge — Spawns and manages
   Vibes MCP server instances as child
   processes, communicating via JSON-RPC
   ═══════════════════════════════════════ */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const env = {};
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        env[key] = val;
      }
    });
    return env;
  } catch (err) {
    console.error(`[Vibes Bridge] Error parsing env file ${filePath}:`, err.message);
    return {};
  }
}

class VibesBridge extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, VibessInstance>} */
    this.instances = new Map();
  }

  /**
   * Spawn a new Vibes MCP server instance for a mission.
   * @param {string} id - Unique agent ID.
   * @param {string} cwd - Working directory for the agent.
   * @param {string} mission - Mission description.
   * @returns {Promise<object>} The planned mission with tasks.
   */
  async createAgent(id, cwd, mission, llmPrefs) {
    const instance = new VibesInstance(id, cwd, llmPrefs);
    this.instances.set(id, instance);

    instance.on('status', (data) => this.emit('agent-status', { id, ...data }));
    instance.on('error', (err) => this.emit('agent-error', { id, error: err.message }));
    instance.on('exit', (code) => {
      this.emit('agent-exit', { id, code });
      this.instances.delete(id);
    });

    try {
      await instance.start();
      const plan = await instance.planMission(mission);
      return plan;
    } catch (err) {
      this.instances.delete(id);
      throw err;
    }
  }

  /**
   * Execute the mission that was already planned.
   * @param {string} id
   * @returns {Promise<object>} The execution result.
   */
  async executePlannedMission(id) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error('Agent not found.');
    return await instance.executeMission();
  }

  /**
   * Query the status of an active agent.
   * @param {string} id
   * @returns {Promise<string>}
   */
  async queryStatus(id) {
    const instance = this.instances.get(id);
    if (!instance) return 'Agent not found.';
    try {
      return await instance.queryStatus();
    } catch {
      return 'Unable to query agent status.';
    }
  }

  /**
   * Resolve a pending user intervention request.
   * @param {string} id
   * @param {string} action
   * @param {string} [message]
   * @param {string} [retryFromTaskId]
   * @returns {Promise<any>}
   */
  async resolveIntervention(id, action, message, retryFromTaskId) {
    const instance = this.instances.get(id);
    if (!instance) throw new Error('Agent not found.');
    return await instance.resolveIntervention(action, message, retryFromTaskId);
  }

  /**
   * Terminate an agent.
   * @param {string} id
   */
  terminate(id) {
    const instance = this.instances.get(id);
    if (instance) {
      instance.shutdown();
      this.instances.delete(id);
    }
  }

  /**
   * Terminate all agents.
   */
  terminateAll() {
    this.instances.forEach((inst) => inst.shutdown());
    this.instances.clear();
  }

  getActiveCount() {
    return this.instances.size;
  }
}

class VibesInstance extends EventEmitter {
  constructor(id, cwd, llmPrefs) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.llmPrefs = llmPrefs;
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.buffer = '';
  }

  /**
   * Start the Vibes MCP server process.
   */
  async start() {
    const vibesRoot = process.env.VIBES_PATH || path.join(require('os').homedir(), 'Vibes');
    const serverScript = path.join(vibesRoot, 'src', 'mcp', 'server.ts');

    // 1. Start with the dashboard server's process environment
    const envVars = { ...process.env };

    // 2. Load the Vibes repository's own .env file to get core environment variables (like model, keys, etc.)
    const vibesDotEnvPath = path.join(vibesRoot, '.env');
    const vibesEnv = parseEnvFile(vibesDotEnvPath);
    Object.assign(envVars, vibesEnv);

    // 3. Override with dynamic LLM preferences configured in the user's browser, if available
    if (this.llmPrefs && this.llmPrefs.provider !== 'disabled') {
      envVars.OLLAMA_BASE_URL = this.llmPrefs.hostUrl;
      envVars.OLLAMA_MODEL = this.llmPrefs.model;
      if (this.llmPrefs.apiKey) {
        envVars.OLLAMA_API_KEY = this.llmPrefs.apiKey;
      }
      if (this.llmPrefs.maxTokens) {
        envVars.CONTEXT_WINDOW = String(this.llmPrefs.maxTokens * 32);
      }
    }

    // Resolve local Vibes tsx binary for robustness
    let tsxBinary = 'tsx';
    const localTsx = path.join(vibesRoot, 'node_modules', '.bin', 'tsx');
    if (fs.existsSync(localTsx)) {
      tsxBinary = localTsx;
    }

    this.process = spawn(tsxBinary, ['--no-warnings', serverScript], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...envVars,
        VIBES_LAUNCH_DIR: this.cwd,
      },
    });

    this.process.stdout.on('data', (data) => {
      this.buffer += data.toString();
      // Split on newlines — each line should be a JSON-RPC message
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) this.handleMessage(line.trim());
      }
    });

    this.stderrBuffer = '';
    this.process.stderr.on('data', (data) => {
      this.stderrBuffer += data.toString();
      const lines = this.stderrBuffer.split('\n');
      this.stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this.emit('status', { log: trimmed });
      }
    });

    this.process.on('error', (err) => this.emit('error', err));
    this.process.on('exit', (code) => this.emit('exit', code));

    // Initialize the MCP protocol handshake
    await this.initialize();
  }

  async initialize() {
    try {
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'glass-vibes-dashboard', version: '1.0.0' },
      });
      this.initialized = true;
      return result;
    } catch (err) {
      throw new Error(`Failed to initialize Vibes MCP: ${err.message}`);
    }
  }

  async planMission(description) {
    return this.sendRequest('tools/call', {
      name: 'plan_mission',
      arguments: {
        description,
        workspace_root: this.cwd,
      },
    }, 600000); // 10 minute timeout for planning
  }

  async executeMission() {
    return this.sendRequest('tools/call', {
      name: 'start_execution',
      arguments: {},
    }, 600000); // 10 minute timeout for missions
  }

  async queryStatus() {
    const result = await this.sendRequest('tools/call', {
      name: 'query_status',
      arguments: {},
    });
    return result;
  }

  async resolveIntervention(action, message, retryFromTaskId) {
    return this.sendRequest('tools/call', {
      name: 'resolve_intervention',
      arguments: {
        action,
        message,
        retryFromTaskId,
      },
    });
  }

  sendRequest(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin.writable) {
        reject(new Error('Vibes process not running'));
        return;
      }

      const id = ++this.requestId;
      const request = { jsonrpc: '2.0', id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      const cleanup = () => {
        if (this.process) {
          this.process.removeListener('error', onError);
          this.process.removeListener('exit', onExit);
        }
      };

      const onError = (err) => {
        cleanup();
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Vibes process spawn error: ${err.message}`));
        }
      };

      const onExit = (code) => {
        cleanup();
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Vibes process exited with code ${code}`));
        }
      };

      this.process.once('error', onError);
      this.process.once('exit', onExit);

      this.process.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
        cleanup();
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);
    });
  }

  handleMessage(data) {
    try {
      const response = JSON.parse(data);
      if (response.id && this.pendingRequests.has(response.id)) {
        const { resolve, reject } = this.pendingRequests.get(response.id);
        this.pendingRequests.delete(response.id);
        if (response.error) {
          reject(new Error(response.error.message || 'MCP error'));
        } else {
          resolve(response.result);
        }
      }
    } catch {
      // Non-JSON output, treat as log
      if (data.trim()) {
        this.emit('status', { log: data });
      }
    }
  }

  shutdown() {
    if (this.process) {
      try {
        this.process.stdin.end();
        this.process.kill('SIGTERM');
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
        }, 3000);
      } catch {
        // Already dead
      }
      this.process = null;
    }
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Agent terminated')));
    this.pendingRequests.clear();
    this.initialized = false;
  }
}

module.exports = { VibesBridge };
