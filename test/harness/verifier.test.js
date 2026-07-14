'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const { createVerifier }=require('../../server/harness/verifier');

async function workspace(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verifier-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function recipe(args,extra={}){return {id:'check',command:process.execPath,args,timeoutMs:2000,maxOutputBytes:1024,cwdPolicy:'run_workspace',artifacts:[],...extra};}

test('captures passing and failing command evidence with shell false, fixed cwd, and bounded environment',async t=>{
  const dir=await workspace(t);let options;
  const spawn=require('node:child_process').spawn;
  const verifier=createVerifier({spawnImpl:(command,args,input)=>{options=input;return spawn(command,args,input);},clock:(()=>{let n=0;return()=>new Date(1000+(n++*25));})()});
  const pass=await verifier.verify({workspace:dir,selection:{recipes:[recipe(['-e','process.stdout.write(process.env.PATH?"ok":"bad")'])],artifacts:[]}});
  assert.equal(pass.passed,true);assert.equal(pass.checks[0].stdout,'ok');assert.equal(pass.checks[0].cwd,dir);assert.equal(options.shell,false);assert.deepEqual(Object.keys(options.env).sort(),['HOME','LANG','PATH','TMPDIR','XDG_CACHE_HOME','XDG_CONFIG_HOME']);
  assert.notEqual(options.env.HOME,process.env.HOME);
  assert.notEqual(options.env.TMPDIR,dir);
  assert.ok(options.env.HOME.startsWith(os.tmpdir()));
  assert.ok(options.detached);
  const fail=await verifier.verify({workspace:dir,selection:{recipes:[recipe(['-e','process.stderr.write("no"),process.exit(7)'])],artifacts:[]}});
  assert.equal(fail.passed,false);assert.equal(fail.checks[0].exitCode,7);assert.equal(fail.checks[0].stderr,'no');
});

test('kills timed out checks using injected timers and records timeout',async t=>{
  const dir=await workspace(t);let callback;let killed;
  const {EventEmitter}=require('node:events');
  const verifier=createVerifier({spawnImpl:()=>{const child=new EventEmitter();child.pid=4321;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=signal=>{killed=signal;queueMicrotask(()=>child.emit('close',null,signal));};return child;},platform:'linux',killImpl:(pid,signal)=>{killed=[pid,signal];queueMicrotask(()=>{});},setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{},clock:()=>new Date(0),graceTimeoutMs:1});
  const pending=verifier.verify({workspace:dir,selection:{recipes:[recipe([])],artifacts:[]}});while(!callback)await new Promise(resolve=>setImmediate(resolve));callback();callback();const result=await pending;
  assert.deepEqual(killed,[-4321,'SIGKILL']);assert.equal(result.checks[0].timedOut,true);assert.equal(result.passed,false);
});

test('timeout settles after grace even when child close never arrives and kill errors are caught',async t=>{
  const dir=await workspace(t);let timeout;
  const {EventEmitter}=require('node:events');
  const verifier=createVerifier({spawnImpl:()=>{const child=new EventEmitter();child.pid=123;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{throw new Error('kill failed');};return child;},platform:'win32',killImpl:()=>{throw new Error('kill failed');},setTimer:fn=>{timeout=fn;return 1;},clearTimer:()=>{},clock:()=>new Date(0),graceTimeoutMs:1});
  const pending=verifier.verify({workspace:dir,selection:{recipes:[recipe([])],artifacts:[]}});while(!timeout)await new Promise(resolve=>setImmediate(resolve));timeout();timeout();const result=await pending;
  assert.equal(result.checks[0].timedOut,true);
  assert.equal(result.checks[0].spawnError,null);
});

test('bounds combined stdout and stderr and records truncation',async t=>{
  const dir=await workspace(t);const result=await createVerifier().verify({workspace:dir,selection:{recipes:[recipe(['-e','process.stdout.write("a".repeat(700)),process.stderr.write("b".repeat(700))'],{maxOutputBytes:1024})],artifacts:[]}});
  assert.equal(result.checks[0].truncated,true);assert.ok(Buffer.byteLength(result.checks[0].stdout)+Buffer.byteLength(result.checks[0].stderr)<=1024);
});

test('output truncation is UTF-8 byte safe and scrubs secret-looking values',async t=>{
  const dir=await workspace(t);
  const result=await createVerifier().verify({workspace:dir,selection:{recipes:[recipe(['-e','process.stdout.write("🙂".repeat(400))'],{maxOutputBytes:1024})],artifacts:[]}});
  assert.doesNotThrow(()=>Buffer.from(result.checks[0].stdout,'utf8').toString('utf8'));
  assert.equal(result.checks[0].stdout.includes('\uFFFD'),false);
  const secret=await createVerifier().verify({workspace:dir,selection:{recipes:[recipe(['-e','process.stderr.write("access_token=abc123 and auth_token=def456")'],{maxOutputBytes:1024})],artifacts:[]}});
  assert.match(secret.checks[0].stderr,/access_token=\[REDACTED\]/);
  assert.match(secret.checks[0].stderr,/auth_token=\[REDACTED\]/);
});

test('records signal termination and spawn errors without rejecting',async t=>{
  const dir=await workspace(t);
  const signaled=await createVerifier().verify({workspace:dir,selection:{recipes:[recipe(['-e','process.kill(process.pid,"SIGTERM")'])],artifacts:[]}});
  assert.equal(signaled.passed,false);assert.equal(signaled.checks[0].signal,'SIGTERM');
  const errored=await createVerifier({spawnImpl:()=>{throw new Error('ENOENT fixture');}}).verify({workspace:dir,selection:{recipes:[recipe([])],artifacts:[]}});
  assert.match(errored.checks[0].spawnError,/ENOENT/);assert.equal(errored.passed,false);
});

test('validates artifacts with lstat and realpath and rejects missing files and symlink escapes',async t=>{
  const dir=await workspace(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'ok.txt'),'ok');await fs.writeFile(path.join(outside,'secret'),'x');await fs.symlink(path.join(outside,'secret'),path.join(dir,'link'));
  const result=await createVerifier().verify({workspace:dir,selection:{recipes:[],artifacts:['ok.txt','missing.txt','link']}});
  assert.deepEqual(result.artifacts.map(x=>[x.path,x.valid,x.reason]),[['ok.txt',true,null],['missing.txt',false,'missing'],['link',false,'symbolic_link']]);assert.equal(result.passed,false);
});

test('artifact validation accepts regular files only and records handle-bound evidence',async t=>{
  const dir=await workspace(t);
  await fs.mkdir(path.join(dir,'subdir'));
  await fs.writeFile(path.join(dir,'ok.txt'),'hello');
  const result=await createVerifier().verify({workspace:dir,selection:{recipes:[],artifacts:['ok.txt','subdir']}});
  const ok=result.artifacts[0];
  assert.equal(ok.valid,true);
  assert.equal(ok.size,5);
  assert.match(ok.sha256,/^[a-f0-9]{64}$/);
  assert.equal(typeof ok.dev,'number');
  assert.equal(typeof ok.ino,'number');
  assert.deepEqual(result.artifacts[1],{path:'subdir',valid:false,reason:'not_regular_file'});
});

test('rejects direct injection surfaces even if verifier is called without policy',async t=>{
  const dir=await workspace(t);
  await assert.rejects(()=>createVerifier().verify({workspace:dir,selection:{recipes:[recipe(['ok;rm'])],artifacts:[]}}),/unsafe/i);
});

test('revalidates executable mode and ctime immediately before spawn',async t=>{
  const dir=await workspace(t); const exe=path.join(dir,'node'); await fs.copyFile(process.execPath,exe); await fs.chmod(exe,0o700);
  const stat=await fs.lstat(exe); const configured=recipe(['--version'],{command:exe,executableIdentity:{dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,size:stat.size}});
  await fs.chmod(exe,0o722);
  await assert.rejects(()=>createVerifier().verify({workspace:dir,selection:{recipes:[configured],artifacts:[]}}),/writable|identity changed/i);
});

test('rejects artifact when a parent changes during validation',async t=>{
  const dir=await workspace(t); await fs.mkdir(path.join(dir,'parent')); await fs.writeFile(path.join(dir,'parent','ok.txt'),'ok');
  const realFs={...fs}; let swapped=false;
  const fsOps={...fs,async open(file,...args){if(!swapped&&String(file).endsWith('ok.txt')){swapped=true;await fs.rename(path.join(dir,'parent'),path.join(dir,'old-parent'));await fs.mkdir(path.join(dir,'parent'));await fs.writeFile(path.join(dir,'parent','ok.txt'),'evil');}return realFs.open(file,...args);}};
  const result=await createVerifier({fsOps}).verify({workspace:dir,selection:{recipes:[],artifacts:['parent/ok.txt']}});
  assert.equal(result.artifacts[0].valid,false); assert.match(result.artifacts[0].reason,/changed|race|containment/);
});

test('returns explicit no_checks_configured and fails closed by default',async t=>{
 const dir=await workspace(t);const result=await createVerifier().verify({workspace:dir,selection:{recipes:[],artifacts:[],noChecksConfigured:true}});
 assert.equal(result.passed,false);assert.equal(result.cause,'no_checks_configured');
});
