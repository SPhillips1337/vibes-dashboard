'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarnessHandlers } = require('../../server/harness-api');

function capture() {
  const state = { statusCode: 200, body: null };
  return { state, res: { status(code) { state.statusCode = code; return this; }, json(body) { state.body = body; return this; } } };
}

const run = { id: 'run-1', createdAt: '2026-07-12T10:00:00.000Z', status: 'completed', mission: 'Test', cwd: '/workspace', verification: { status: 'passed' } };

test('run list validates bounded pagination and returns a stable envelope', async () => {
  const calls = [];
  const handlers = createHarnessHandlers({ listRuns: async options => { calls.push(options); return { items: [run], total: 1, offset: options.offset, limit: options.limit, hasMore: false }; } });
  const ok = capture(); await handlers.list({ query: {} }, ok.res);
  assert.deepEqual(calls[0], { offset: 0, limit: 25 });
  assert.equal(ok.state.body.items[0].id, 'run-1');
  const max = capture(); await handlers.list({ query: { limit: '101' } }, max.res);
  assert.equal(max.state.statusCode, 400); assert.deepEqual(max.state.body, { error: 'Invalid pagination' });
});

test('detail rejects traversal and translates missing/internal failures without leaking details', async () => {
  const handlers = createHarnessHandlers({
    getRun: async id => { if (id === 'missing') { const error = new Error('/secret/root/missing'); error.code = 'ENOENT'; throw error; } throw new Error('token=supersecret /private/path'); }
  });
  const bad = capture(); await handlers.detail({ params: { id: '../etc' } }, bad.res);
  assert.equal(bad.state.statusCode, 400); assert.deepEqual(bad.state.body, { error: 'Invalid run id' });
  const missing = capture(); await handlers.detail({ params: { id: 'missing' } }, missing.res);
  assert.equal(missing.state.statusCode, 404); assert.deepEqual(missing.state.body, { error: 'Run not found' });
  const failed = capture(); await handlers.detail({ params: { id: 'run-1' } }, failed.res);
  assert.equal(failed.state.statusCode, 500); assert.deepEqual(failed.state.body, { error: 'Unable to read harness run' });
});

test('events endpoint validates page size and uses an opaque decimal byte cursor', async () => {
  const calls=[];
  const handlers = createHarnessHandlers({ getRunEvents: async (_id, options) => { calls.push(options); return { items: [{ eventId: 'e1', type: 'log.emitted', data: { message: 'x'.repeat(9000) } }], cursor:options.cursor, nextCursor:12345678, limit: options.limit, hasMore: false }; } });
  const response = capture(); await handlers.events({ params: { id: 'run-1' }, query: { limit: '200', cursor: '1234567' } }, response.res);
  assert.deepEqual(calls[0],{cursor:1234567,limit:200}); assert.equal(response.state.body.nextCursor,12345678);
  assert.equal(response.state.body.items[0].data.message.length <= 4097, true);
  const legacy = capture(); await handlers.events({params:{id:'run-1'},query:{offset:'99'}},legacy.res); assert.equal(calls[1].cursor,99);
  const bad = capture(); await handlers.events({ params: { id: 'run-1' }, query: { limit: '201' } }, bad.res);
  assert.equal(bad.state.statusCode, 400);
});

test('children and export endpoints remain bounded read-only projections',async()=>{
  const calls=[]; const handlers=createHarnessHandlers({
    getRunChildren:async(id,options)=>{calls.push({id,options});return {items:Array.from({length:options.limit},(_,i)=>({id:`run-${i}`})),limit:options.limit};},
    exportRun:async(_id,options)=>({metadata:{id:'run-1',cwd:'/hidden'},events:[],maxBytes:options.maxBytes})
  });
  const children=capture();await handlers.children({params:{id:'run-1'},query:{limit:'100'}},children.res);assert.equal(children.state.body.items.length,100);
  const exported=capture();await handlers.exportRun({params:{id:'run-1'},query:{maxBytes:'4096'}},exported.res);assert.equal(exported.state.body.metadata.cwd,undefined);assert.equal(exported.state.body.maxBytes,4096);
});

test('evidence exposes checks artifacts and linked failure records only', async () => {
  const evidence = { checks: [{ eventId: 'e2', command: ['npm','test'] }], artifacts: [{ eventId: 'e3', path: 'dist/app.js' }], failureRecord: { evidenceEventIds: ['e2'] }, status: 'failed' };
  const handlers = createHarnessHandlers({ getRunEvidence: async () => evidence });
  const response = capture(); await handlers.evidence({ params: { id: 'run-1' }, query: {} }, response.res);
  assert.deepEqual(response.state.body, evidence);
  assert.equal(JSON.stringify(response.state.body).includes('events.jsonl'), false);
});

test('pagination accepts canonical safe decimals only and caps offset', async () => {
  const handlers=createHarnessHandlers({listRuns:async options=>({items:[],total:0,...options,hasMore:false})});
  for (const value of [' 1','1 ','1e2','0x10','01','9007199254740992','10001']) {
    const response=capture(); await handlers.list({query:{offset:value}},response.res);
    assert.equal(response.state.statusCode,400,value); assert.deepEqual(response.state.body,{error:'Invalid pagination'});
  }
});

test('read DTOs recursively remove legacy secrets and filesystem paths', async () => {
  const legacy={...run,cwd:'/secret/cwd',apiKey:'a',api_key:'b',authorization:'c',cookie:'d',credential:'e',accessToken:'f',authToken:'g',password:'h',secret:'i',token:'j',eventsPath:'/events',nested:{store_path:'/store',policyPath:'/policy',safe:'ok'}};
  const handlers=createHarnessHandlers({getRun:async()=>legacy}); const response=capture();
  await handlers.detail({params:{id:'run-1'}},response.res);
  const text=JSON.stringify(response.state.body); assert.equal(text.includes('/secret'),false); assert.equal(text.includes('apiKey'),false); assert.equal(response.state.body.nested.safe,'ok');
});
