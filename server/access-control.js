const net = require('node:net');
const proxyaddr = require('proxy-addr');

function splitAddresses(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeIp(value) {
  const ip = String(value || '').trim();
  if (ip.toLowerCase().startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4) return ip.slice(7);
  return ip;
}

function compile(addresses, label) {
  if (!addresses.length) return null;
  try {
    return proxyaddr.compile(addresses);
  } catch (error) {
    throw new Error(`Invalid ${label} configuration: ${error.message}`);
  }
}

function createAccessControl(options = {}) {
  const allowedAddresses = splitAddresses(options.allowedIps);
  const trustedAddresses = splitAddresses(options.trustedProxies);
  const allowed = compile(allowedAddresses, 'ACCESS_ALLOWED_IPS');
  const trustProxy = compile(trustedAddresses, 'TRUSTED_PROXY_IPS') || (() => false);

  function getClientIp(req) {
    return normalizeIp(proxyaddr(req, trustProxy));
  }

  function isAllowed(ip) {
    if (!allowed) return true;
    const normalized = normalizeIp(ip);
    try {
      return allowed(normalized, 0);
    } catch {
      return false;
    }
  }

  function isRequestAllowed(req) {
    return isAllowed(getClientIp(req));
  }

  function middleware(req, res, next) {
    if (isRequestAllowed(req)) return next();
    return res.status(403).json({ error: 'Access denied' });
  }

  function nodeMiddleware(req, res, next) {
    if (isRequestAllowed(req)) return next();
    res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Access denied' }));
  }

  return {
    enabled: Boolean(allowed),
    trustProxy,
    getClientIp,
    isAllowed,
    isRequestAllowed,
    middleware,
    nodeMiddleware
  };
}

module.exports = { createAccessControl, normalizeIp, splitAddresses };
