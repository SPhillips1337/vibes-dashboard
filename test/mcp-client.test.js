'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpClient } = require('../server/coordination-adapter');

test('MCP client initializes once, forwards bearer auth, and calls configured tools', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push({ headers: options.headers, body: JSON.parse(options.body) });
    const body = JSON.parse(options.body);
    const result = body.method === 'tools/call' ? { structuredContent: { providers: [] } } : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: body.method === 'notifications/initialized' ? 202 : 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' }
    });
  };
  const client = createMcpClient({ url: 'http://127.0.0.1/mcp', token: 'fixture-token', fetchImpl });

  await client.callTool('first_tool');
  await client.callTool('second_tool');

  assert.deepEqual(requests.map(request => request.body.method), ['initialize', 'notifications/initialized', 'tools/call', 'tools/call']);
  assert.equal(requests[0].headers.Authorization, 'Bearer fixture-token');
  assert.equal(requests[2].headers['Mcp-Session-Id'], 'session-1');
  assert.equal(requests[3].body.params.name, 'second_tool');
});

test('MCP client aborts a request at the configured timeout', async () => {
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const client = createMcpClient({ url: 'http://127.0.0.1/mcp', token: 'fixture-token', timeoutMs: 5, fetchImpl });
  await assert.rejects(client.callTool('slow_tool'), { name: 'AbortError' });
});
