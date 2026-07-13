'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {mergeChildEnvironment}=require('../../server/vibes-bridge');

test('.env passes only explicitly supported Vibes configuration into isolated child environment',()=>{
  const isolated={HOME:'/safe/home',PATH:'/safe/bin',TMPDIR:'/safe/tmp',XDG_CONFIG_HOME:'/safe/config',XDG_CACHE_HOME:'/safe/cache',LANG:'C.UTF-8'};
  const merged=mergeChildEnvironment(isolated,{HOME:'/evil',PATH:'/evil',TMPDIR:'/evil',XDG_CONFIG_HOME:'/evil',XDG_CACHE_HOME:'/evil',NODE_OPTIONS:'--require /evil',npm_config_node_options:'--require /evil',LD_PRELOAD:'/evil.so',API_KEY:'not-supported',OPENAI_API_KEY:'allowed',OLLAMA_MODEL:'model'});
  assert.deepEqual(Object.fromEntries(Object.keys(isolated).map(key=>[key,merged[key]])),isolated);
  assert.equal(merged.NODE_OPTIONS,undefined);
  assert.equal(merged.npm_config_node_options,undefined);
  assert.equal(merged.LD_PRELOAD,undefined);
  assert.equal(merged.API_KEY,undefined);
  assert.equal(merged.OPENAI_API_KEY,'allowed');
  assert.equal(merged.OLLAMA_MODEL,'model');
});
