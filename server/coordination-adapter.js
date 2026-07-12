'use strict';

const DEFAULT_MCP_URL = 'http://127.0.0.1:8767/mcp';
const DEFAULT_TIMEOUT_MS = 5000;

// Keep upstream naming changes isolated from adapter and UI code.
const TOOL_NAMES = Object.freeze({
  controlCenter: 'get_control_center'
});

const EMPTY_PROJECTION = Object.freeze({
  providers: [], activity: [], pendingApprovals: [], verificationOutcomes: [], artifactReferences: []
});

function text(value, fallback = '') {
  return value === null || value === undefined ? fallback : String(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unwrapToolResult(result) {
  if (!result || typeof result !== 'object') return {};
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  if (result.result && typeof result.result === 'object') return unwrapToolResult(result.result);
  const content = list(result.content);
  const jsonText = content.find(item => item && item.type === 'text' && typeof item.text === 'string')?.text;
  if (jsonText) {
    try { return JSON.parse(jsonText); } catch (_) { return {}; }
  }
  return result;
}

function normalizeProvider(provider) {
  const diagnostics = Array.isArray(provider.diagnostics)
    ? provider.diagnostics
    : Object.entries(provider.diagnostics || {}).map(([key, value]) => `${key}: ${value}`);
  return {
    id: text(provider.id || provider.provider_id, 'unknown'),
    displayName: text(provider.displayName || provider.display_name || provider.name, 'Unknown provider'),
    binaryAvailable: Boolean(provider.binaryAvailable ?? provider.binary_available ?? provider.executable_available ?? provider.available),
    readiness: text(provider.readiness || provider.readiness_state || provider.auth_state || provider.state || provider.status, 'unknown'),
    capabilities: list(provider.capabilities).map(value => text(value)).filter(Boolean),
    diagnostics: diagnostics.map(value => text(value)).filter(Boolean),
    checkedAt: provider.checkedAt || provider.checked_at || null
  };
}

function normalizeArtifact(artifact, activityId) {
  if (typeof artifact === 'string') return { activityId, label: 'Artifact', reference: artifact };
  return {
    activityId,
    label: text(artifact?.label || artifact?.name || artifact?.type, 'Artifact'),
    reference: text(artifact?.reference || artifact?.path || artifact?.uri || artifact?.url)
  };
}

function normalizeActivity(item) {
  const id = text(item.id || item.event_id || item.activity_id, 'unknown');
  const artifacts = list(item.artifactReferences || item.artifact_references || item.artifact_refs || item.artifacts)
    .map(artifact => normalizeArtifact(artifact, id)).filter(artifact => artifact.reference);
  return {
    id,
    taskId: item.taskId || item.task_id || item.task_ref || null,
    agentId: item.agentId || item.agent_id || item.agent_ref || null,
    project: item.project || item.project_ref || null,
    state: text(item.state || item.status, 'unknown'),
    summary: text(item.summary || item.message, 'No summary supplied'),
    timestamp: item.timestamp || item.created_at || item.updated_at || null,
    approvalRequired: Boolean(item.approvalRequired ?? item.approval_required),
    artifacts
  };
}

function isVerification(item) {
  return /pass|fail|verif|check|test|validat/i.test(`${item.state} ${item.summary}`);
}

function unavailable(reason) {
  return { available: false, reason, ...EMPTY_PROJECTION, updatedAt: null };
}

function createCoordinationAdapter({ client, now = () => new Date() } = {}) {
  return {
    async getControlCenter() {
      if (!client) return unavailable('not_configured');
      try {
        const controlCenterData = unwrapToolResult(await client.callTool(TOOL_NAMES.controlCenter, {}));
        const providers = list(controlCenterData.providers).map(normalizeProvider);
        const activityEnvelope = controlCenterData.activity || {};
        const activity = list(activityEnvelope.activities || activityEnvelope.items || activityEnvelope)
          .map(normalizeActivity)
          .sort((a, b) => text(b.timestamp).localeCompare(text(a.timestamp)) || a.id.localeCompare(b.id));
        return {
          available: true,
          providers,
          activity,
          pendingApprovals: activity.filter(item => item.approvalRequired),
          verificationOutcomes: activity.filter(isVerification),
          artifactReferences: activity.flatMap(item => item.artifacts),
          updatedAt: now().toISOString()
        };
      } catch (_) {
        return unavailable('coordination_service_unreachable');
      }
    }
  };
}

function parseMcpResponse(responseText, contentType) {
  if (contentType.includes('text/event-stream')) {
    const payloads = responseText.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
    const last = payloads.filter(payload => payload && payload !== '[DONE]').at(-1);
    return last ? JSON.parse(last) : {};
  }
  return responseText ? JSON.parse(responseText) : {};
}

function createMcpClient({ url, token, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !token || typeof fetchImpl !== 'function') return null;
  let requestId = 0;
  let sessionId = null;
  let initialized = false;

  async function request(method, params, notification = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = { jsonrpc: '2.0', method };
    if (!notification) body.id = ++requestId;
    if (params !== undefined) body.params = params;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new Error('MCP request failed');
      sessionId = response.headers.get('mcp-session-id') || sessionId;
      if (notification && response.status === 202) return {};
      const parsed = parseMcpResponse(await response.text(), response.headers.get('content-type') || '');
      if (parsed.error) throw new Error('MCP tool failed');
      return parsed.result || parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async callTool(name, args = {}) {
      if (!initialized) {
        await request('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'vibes-dashboard', version: '1.0.0' }
        });
        await request('notifications/initialized', undefined, true);
        initialized = true;
      }
      return request('tools/call', { name, arguments: args });
    }
  };
}

function createControlCenterHandler(adapter) {
  return async (_req, res) => {
    const projection = await adapter.getControlCenter();
    return res.status(projection.available ? 200 : 503).json(projection);
  };
}

function createAdapterFromEnv(env = process.env, options = {}) {
  const token = env.AGENT_COMM_MCP_TOKEN;
  const url = env.AGENT_COMM_MCP_URL || DEFAULT_MCP_URL;
  const parsedTimeout = Number.parseInt(env.AGENT_COMM_MCP_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;
  const client = token ? createMcpClient({ url, token, timeoutMs, fetchImpl: options.fetchImpl }) : null;
  return createCoordinationAdapter({ client, now: options.now });
}

module.exports = {
  DEFAULT_MCP_URL,
  DEFAULT_TIMEOUT_MS,
  TOOL_NAMES,
  createAdapterFromEnv,
  createControlCenterHandler,
  createCoordinationAdapter,
  createMcpClient,
  normalizeActivity,
  normalizeProvider,
  unwrapToolResult
};
