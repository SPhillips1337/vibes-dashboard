'use strict';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function pagination(query, { defaultLimit, maxLimit }) {
  const decimal = /^(0|[1-9]\d*)$/;
  const parse = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !decimal.test(value)) throw new TypeError('pagination');
    const number=Number(value);
    if (!Number.isSafeInteger(number)) throw new TypeError('pagination');
    return number;
  };
  const limit = parse(query.limit, defaultLimit);
  const offset = parse(query.offset, 0);
  if (limit < 1 || limit > maxLimit || offset < 0 || offset > 10000) throw new TypeError('pagination');
  return { offset, limit };
}

function eventPagination(query) {
  const decimal = /^(0|[1-9]\d*)$/;
  const value = query.cursor !== undefined ? query.cursor : query.offset;
  if (value !== undefined && (typeof value !== 'string' || !decimal.test(value) || !Number.isSafeInteger(Number(value)))) throw new TypeError('pagination');
  const base = pagination({ limit: query.limit }, { defaultLimit: 100, maxLimit: 200 });
  return { cursor: value === undefined ? 0 : Number(value), limit: base.limit };
}

function exportBounds(query) {
  const value=query.maxBytes;
  if(value===undefined)return {maxBytes:256*1024};
  if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1024||Number(value)>2*1024*1024) throw new TypeError('pagination');
  return {maxBytes:Number(value)};
}

const SECRET_KEY = /^(?:api_?key|authorization|cookie|credential|access_?token|auth_?token|password|secret|token)$/i;
const INTERNAL_PATH_KEY = /(?:^|_)(?:root|store|events|policy|internal)_?path$|^(?:root|storePath|eventsPath|policyPath|internalPath|cwd)$/i;
function bounded(value) {
  if (typeof value === 'string') return value.length > 4096 ? `${value.slice(-4096)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map(bounded);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEY.test(key) && !INTERNAL_PATH_KEY.test(key)).map(([key, child]) => [key, bounded(child)]));
}

function createHarnessHandlers(service) {
  const invoke = (kind, operation) => async (req, res) => {
    try { return res.json(bounded(await operation(req))); }
    catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ error: error.message === 'run id' ? 'Invalid run id' : 'Invalid pagination' });
      if (error && (error.code === 'ENOENT' || error.code === 'RUN_NOT_FOUND')) return res.status(404).json({ error: 'Run not found' });
      return res.status(500).json({ error: `Unable to read harness ${kind}` });
    }
  };
  const id = req => { const value = req.params && req.params.id; if (!RUN_ID.test(value || '')) throw new TypeError('run id'); return value; };
  return {
    list: invoke('runs', req => service.listRuns(pagination(req.query || {}, { defaultLimit: 25, maxLimit: 100 }))),
    detail: invoke('run', req => service.getRun(id(req))),
    events: invoke('events', req => service.getRunEvents(id(req), eventPagination(req.query || {}))),
    evidence: invoke('evidence', req => service.getRunEvidence(id(req))),
    children: invoke('children', req => service.getRunChildren(id(req),pagination(req.query||{},{defaultLimit:100,maxLimit:100}))),
    exportRun: invoke('export', req => service.exportRun(id(req),exportBounds(req.query||{})))
  };
}

module.exports = { createHarnessHandlers, pagination, bounded };
