const test = require('node:test');
const assert = require('node:assert/strict');

const { createAccessControl, normalizeIp } = require('../server/access-control');

function request(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    connection: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
  };
}

test('disabled allowlist permits requests and normalizes mapped IPv4 addresses', () => {
  const control = createAccessControl({});
  assert.equal(control.isAllowed('203.0.113.4'), true);
  assert.equal(normalizeIp('::ffff:203.0.113.4'), '203.0.113.4');
});

test('allowlist supports exact IPv4, IPv6, and CIDR ranges', () => {
  const control = createAccessControl({ allowedIps: '203.0.113.7,10.20.0.0/16,2001:db8::/32' });
  assert.equal(control.isAllowed('203.0.113.7'), true);
  assert.equal(control.isAllowed('10.20.4.9'), true);
  assert.equal(control.isAllowed('2001:db8::123'), true);
  assert.equal(control.isAllowed('10.21.4.9'), false);
  assert.equal(control.isAllowed('2001:db9::1'), false);
});

test('trusted reverse proxy supplies the client IP', () => {
  const control = createAccessControl({
    allowedIps: '198.51.100.9',
    trustedProxies: '127.0.0.1,::1'
  });
  const req = request('127.0.0.1', '198.51.100.9');
  assert.equal(control.getClientIp(req), '198.51.100.9');
  assert.equal(control.isRequestAllowed(req), true);
});

test('an untrusted peer cannot spoof an allowed X-Forwarded-For value', () => {
  const control = createAccessControl({
    allowedIps: '198.51.100.9',
    trustedProxies: '127.0.0.1,::1'
  });
  const req = request('203.0.113.200', '198.51.100.9');
  assert.equal(control.getClientIp(req), '203.0.113.200');
  assert.equal(control.isRequestAllowed(req), false);
});

test('middleware rejects a disallowed request without revealing policy', () => {
  const control = createAccessControl({ allowedIps: '10.0.0.0/8' });
  const req = request('203.0.113.8');
  let status;
  let body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  control.middleware(req, res, () => assert.fail('next must not be called'));
  assert.equal(status, 403);
  assert.deepEqual(body, { error: 'Access denied' });
});

test('Node HTTP middleware also protects Socket.io handshakes', () => {
  const control = createAccessControl({ allowedIps: '10.0.0.0/8' });
  const req = request('203.0.113.8');
  let status;
  let body;
  const res = {
    writeHead(value) { status = value; },
    end(value) { body = value; }
  };
  control.nodeMiddleware(req, res, () => assert.fail('next must not be called'));
  assert.equal(status, 403);
  assert.equal(JSON.parse(body).error, 'Access denied');
});

test('invalid allowlist configuration fails at startup', () => {
  assert.throws(() => createAccessControl({ allowedIps: 'not-an-ip' }), /invalid/i);
  assert.throws(() => createAccessControl({ trustedProxies: '10.0.0.0/99' }), /invalid/i);
});
