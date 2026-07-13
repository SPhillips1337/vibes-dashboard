'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { buildTimelineModel, buildEvidenceModel }=require('../modules/orchestrator/script');

test('timeline model labels typed events concisely in append order',()=>{
  const model=buildTimelineModel([{eventId:'e1',type:'verification.started',timestamp:'2026-07-12T10:00:00Z',actor:{id:'harness'},data:{attempt:2}},{eventId:'e2',type:'verification.passed',timestamp:'2026-07-12T10:00:01Z',actor:{id:'harness'},data:{}}]);
  assert.deepEqual(model.map(item=>item.id),['e1','e2']); assert.equal(model[0].attempt,'2'); assert.equal(model[1].statusLabel,'Verified');
});

test('evidence model never promotes demo fixtures to verified evidence',()=>{
  assert.equal(buildEvidenceModel({status:'passed',demo:true,checks:[],artifacts:[]}).statusLabel,'Demo fixture only');
  assert.equal(buildEvidenceModel({status:'failed',checks:[],artifacts:[]}).statusLabel,'Verification failed');
  assert.equal(buildEvidenceModel({status:'pending',checks:[],artifacts:[]}).statusLabel,'Awaiting verification');
  assert.equal(buildEvidenceModel({status:'interrupted',checks:[],artifacts:[]}).statusLabel,'Interrupted');
});

test('orchestrator live-data paths prohibit innerHTML and use scoped panel queries',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','modules','orchestrator','script.js'),'utf8');
  assert.doesNotMatch(source,/\.innerHTML\s*=/); assert.match(source,/timelinePanel\.querySelector/); assert.match(source,/\.textContent\s*=/);
});

test('production orchestrator has race-safe paging, focus fallback, and accessible tab visibility',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','modules','orchestrator','script.js'),'utf8');
  assert.match(source,/new AbortController/); assert.match(source,/nextOffset/); assert.match(source,/dataset\.eventId/);
  assert.match(source,/Evidence event not in loaded timeline/); assert.doesNotMatch(source,/CSS\.escape/);
  assert.match(source,/aria-hidden/); assert.match(source,/\.hidden\s*=/); assert.match(source,/Args/);
});
