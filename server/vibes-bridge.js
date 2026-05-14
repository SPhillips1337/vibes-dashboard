/* ═══════════════════════════════════════
   Vibes Bridge — Spawns and manages
   Vibes MCP server instances as child
   processes, communicating via JSON-RPC
   ═══════════════════════════════════════ */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

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
  async createAgent(id, cwd, mission) {
    const instance = new VibesInstance(id, cwd);
    this.instances.set(id, instance);

    instance.on('status', (data) => this.emit('agent-status', { id, ...data }));
    instance.on('error', (err) => this.emit('agent-error', { id, error: err.message }));
    instance.on('exit', (code) => {
      this.emit('agent-exit', { id, code });
      this.instances.delete(id);
    });

    try {
      await instance.start();
      const plan = await instance.executeMission(mission);
      return plan;
    } catch (err) {
      this.instances.delete(id);
      throw err;
    }
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
  constructor(id, cwd) {
    super();
    this.id = id;
    this.cwd = cwd;
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

    this.process = spawn('tsx', ['--no-warnings', serverScript], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
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

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        this.emit('status', { log: msg });
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

  async executeMission(description) {
    return this.sendRequest('tools/call', {
      name: 'execute_mission',
      arguments: {
        description,
        workspace_root: this.cwd,
      },
    }, 600000); // 10 minute timeout for missions
  }

  async queryStatus() {
    const result = await this.sendRequest('tools/call', {
      name: 'query_status',
      arguments: {},
    });
    return result;
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
      this.process.stdin.write(JSON.stringify(request) + '\n');

      setTimeout(() => {
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
