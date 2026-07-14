'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadVerificationPolicy, selectVerification } = require('../../server/harness/verification-policy');

const executable = process.execPath;
const base = { executablePaths:[executable], recipes:{ unit:{ command:executable,args:['--version'],timeoutMs:1000,maxOutputBytes:2048,artifacts:['dist/result.json'] } } };

test('loads injected object or server-controlled path and selects only requested allowlisted recipe ids', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verification-policy-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'policy.json'); await fs.writeFile(file,JSON.stringify(base)); await fs.chmod(file,0o600);
  for (const policy of [await loadVerificationPolicy({policy:base}),await loadVerificationPolicy({policyPath:file,trustedPolicyRoots:[dir]})]) {
    const selected=selectVerification(policy,{requestedChecks:['unit','agent-supplied']});
    assert.deepEqual(selected.recipeIds,['unit']);
    assert.equal(selected.recipes[0].command,executable);
    assert.equal(selected.recipes[0].cwdPolicy,'run_workspace');
  }
});

test('policy loading canonicalizes executable identity and rejects symlink, writable, and nonregular executables', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verification-policy-exec-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const exe=path.join(dir,'tool'); await fs.copyFile(process.execPath,exe); await fs.chmod(exe,0o700);
  const loaded=await loadVerificationPolicy({policy:{executablePaths:[exe],recipes:{unit:{command:exe,args:['--version']}}}});
  assert.equal(loaded.recipes.unit.command,await fs.realpath(exe));
  assert.equal(typeof loaded.executableIdentities[loaded.recipes.unit.command].ino,'number');
  const link=path.join(dir,'link'); await fs.symlink(exe,link);
  await assert.rejects(()=>loadVerificationPolicy({policy:{executablePaths:[link],recipes:{unit:{command:link,args:[]}}}}),/symlink|regular|writable/i);
  await fs.chmod(exe,0o777);
  await assert.rejects(()=>loadVerificationPolicy({policy:{executablePaths:[exe],recipes:{unit:{command:exe,args:[]}}}}),/writable/i);
  await assert.rejects(()=>loadVerificationPolicy({policy:{executablePaths:[dir],recipes:{unit:{command:dir,args:[]}}}}),/regular/i);
});

test('policy path must be canonical trusted nonsymlink regular file outside harness workspaces', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'trusted-policy-root-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'run-workspace-')); t.after(()=>fs.rm(workspace,{recursive:true,force:true}));
  const file=path.join(root,'policy.json'); await fs.writeFile(file,JSON.stringify(base)); await fs.chmod(file,0o600);
  await assert.rejects(()=>loadVerificationPolicy({policyPath:file}),/trusted policy root/i);
  await assert.doesNotReject(()=>loadVerificationPolicy({policyPath:file,trustedPolicyRoots:[root],harnessWorkspaces:[workspace]}));
  await fs.writeFile(path.join(workspace,'policy.json'),JSON.stringify(base)); await fs.chmod(path.join(workspace,'policy.json'),0o600);
  await assert.rejects(()=>loadVerificationPolicy({policyPath:path.join(workspace,'policy.json'),trustedPolicyRoots:[root],harnessWorkspaces:[workspace]}),/trusted|workspace|policy path/i);
  const link=path.join(root,'policy-link.json'); await fs.symlink(file,link);
  await assert.rejects(()=>loadVerificationPolicy({policyPath:link,trustedPolicyRoots:[root]}),/symlink|regular/i);
  await fs.chmod(file,0o666);
  await assert.rejects(()=>loadVerificationPolicy({policyPath:file,trustedPolicyRoots:[root]}),/writable/i);
});

test('selection reads strict persisted plan only and never accepts policy commands or paths from run data', async () => {
  const policy=await loadVerificationPolicy({policy:base});
  const selected=selectVerification(policy,{plan:{tasks:[{id:'t'}],verificationChecks:['unit'],declaredArtifacts:['reports/out.json'],policyPath:'/tmp/evil',recipes:{unit:{command:'/bin/sh'}}}});
  assert.deepEqual(selected.recipeIds,['unit']);
  assert.deepEqual(selected.artifacts,['reports/out.json','dist/result.json']);
  assert.equal(selected.recipes[0].command,executable);
  assert.equal(selectVerification(policy,{plan:{tasks:'bad',verificationChecks:['unit']}}).noChecksConfigured,true);
});

test('safe default executes no command and validates declared artifacts only', async () => {
  const policy=await loadVerificationPolicy();
  const selected=selectVerification(policy,{requestedChecks:['anything'],declaredArtifacts:['report.txt']});
  assert.deepEqual(selected.recipes,[]);
  assert.deepEqual(selected.artifacts,['report.txt']);
  assert.equal(selected.noChecksConfigured,false);
  assert.equal(selectVerification(policy,{}).noChecksConfigured,true);
});

test('rejects shell strings, metacharacters, unapproved executables, unsafe limits, and traversal artifacts', async () => {
  const invalid = [
    {...base,recipes:{bad:{command:`${executable} --version`,args:[]}}},
    {...base,recipes:{bad:{command:executable,args:['ok;rm','x']}}},
    {...base,recipes:{bad:{command:'/bin/sh',args:['-c','true']}}},
    {...base,recipes:{bad:{command:executable,args:[],timeoutMs:0}}},
    {...base,recipes:{bad:{command:executable,args:[],maxOutputBytes:99}}},
    {...base,recipes:{bad:{command:executable,args:[],artifacts:['../secret']}}},
    {...base,recipes:{bad:{command:executable,args:[],artifacts:['/etc/passwd']}}}
  ];
  for (const value of invalid) await assert.rejects(()=>loadVerificationPolicy({policy:value}),/invalid|allowlisted|unsafe|artifact|limit|regular/i);
});

test('policy path cannot be supplied through run selection payload', async () => {
  const policy=await loadVerificationPolicy({policy:base});
  const selected=selectVerification(policy,{requestedChecks:['unit'],policyPath:'/tmp/evil',recipes:{unit:{command:'/bin/sh'}}});
  assert.equal(selected.recipes[0].command,executable);
});
