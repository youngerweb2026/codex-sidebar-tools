'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {createManager,parseArgs,winQuote,spawnDetached}=require('../manage.cjs');
const {getPaths}=require('../platform.cjs');
function fixture(t,{fetchImpl=async()=>{throw Error('offline');},leaveReceiptOnStop=false,afterStop}={}){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-manager-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const platform=process.platform==='win32'?'win32':'darwin',env={...process.env,LOCALAPPDATA:path.join(home,'Local'),APPDATA:path.join(home,'Roaming')};
  const paths=getPaths({platform,home,env});const app=platform==='win32'?path.join(home,'Custom App','ChatGPT.exe'):path.join(home,'Custom App','Codex.app');
  const cli=platform==='win32'?path.join(path.dirname(app),'resources','codex.exe'):path.join(app,'Contents','Resources','codex');
  fs.mkdirSync(path.dirname(cli),{recursive:true});fs.writeFileSync(cli,'fixture');if(platform==='win32')fs.writeFileSync(app,'desktop');
  let processes=[],legacy=false,active=false;const calls=[],spawnFailures=new Set();
  function start(){
    const m=JSON.parse(fs.readFileSync(paths.manifestPath,'utf8'));
    fs.mkdirSync(path.dirname(paths.pidPath),{recursive:true});fs.writeFileSync(paths.pidPath,JSON.stringify({pid:9001,token:m.token,startedAt:Date.now()}));
    processes=[{pid:9001,executable:process.execPath,commandLine:`${process.execPath} "${path.join(paths.installDir,'agent.cjs')}" --data-dir "${paths.installDir}" --instance-token ${m.token}`}];active=true;
  }
  function stop(){processes=[];active=false;if(afterStop)afterStop(paths);if(!leaveReceiptOnStop){try{fs.unlinkSync(paths.pidPath);}catch{}}}
  function run(file,args){
    calls.push({file,args});if(file===cli)return 'codex-cli test-version';
    if(file==='/bin/ps')return processes.map(p=>p.pid+' '+p.commandLine).join('\n');
    if(file==='powershell.exe')return JSON.stringify(processes.map(p=>({ProcessId:p.pid,ExecutablePath:p.executable,CommandLine:p.commandLine})));
    if(file==='taskkill.exe'){stop();return '';}
    if(file==='/bin/launchctl'){
      if(args.join(' ').includes('com.codexusagebadge.agent')){if(legacy)return 'state = running\npid = 777';throw Error('not loaded');}
      if(args[0]==='print'){if(active)return 'state = running\npid = 9001';throw Error('not loaded');}
      if(args[0]==='bootstrap'||args[0]==='kickstart'){start();return '';}
      if(args[0]==='bootout'){stop();return '';}
    }
    return '';
  }
  const spawn=(file,args)=>{
    calls.push({file,args});const child=new EventEmitter();child.pid=9001;child.unref=()=>{};
    queueMicrotask(()=>{
      if(spawnFailures.has(file)){const error=Error('spawn '+file+' ENOENT');error.code='ENOENT';child.emit('error',error);return;}
      if(file===process.execPath)start();child.emit('spawn');
    });return child;
  };
  const manager=createManager({platform,home,env,paths,sourceDir:path.join(__dirname,'..'),nodePath:process.execPath,run,spawn,wait:async()=>{},kill:stop,fetchImpl});
  return {home,platform,paths,app,cli,manager,calls,setLegacy(value){legacy=value;if(platform==='win32')processes=value?[{pid:777,executable:'node.exe',commandLine:'node CodexUsageBadge/agent.cjs'}]:[];},setProcesses(value){processes=value;},setSpawnFailure(file){spawnFailures.add(file);}};
}
test('CLI arguments preserve explicit paths and reject unknown options',()=>{
  assert.deepEqual(parseArgs(['install','--app','C:\\Custom App\\Codex.exe','--codex-bin','C:\\CLI\\codex.exe']),{action:'install',options:{app:'C:\\Custom App\\Codex.exe',cli:'C:\\CLI\\codex.exe'}});
  assert.deepEqual(parseArgs(['recover']),{action:'recover',options:{}});
  assert.throws(()=>parseArgs(['delete-everything']),{code:'INVALID_ACTION'});assert.throws(()=>parseArgs(['launch','--unsafe']),{code:'INVALID_ARGUMENT'});
  assert.equal(winQuote('C:\\space dir\\'),'"C:\\space dir\\\\"');
});
test('installation uses its own files and stops only its proven background process',async t=>{
  const f=fixture(t);const result=await f.manager.install({app:f.app,cli:f.cli});assert.equal(result.running,true);
  assert.match(fs.readFileSync(f.paths.servicePath,'utf8'),/codex-sidebar-tools:/);
  const status=await f.manager.status();assert.equal(status.running,true);assert.equal(status.port,39223);
  assert.equal(fs.existsSync(f.paths.legacyServicePath),false);
  await f.manager.stopAgent();assert.equal((await f.manager.status()).running,false);
  assert.equal(f.calls.some(c=>c.args.includes('/F')&&c.args.includes('777')),false);
});
test('uninstall removes owned startup only and preserves personal data',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const data=path.join(f.paths.installDir,'data','state.json');fs.mkdirSync(path.dirname(data));fs.writeFileSync(data,'private note fixture');
  const result=await f.manager.uninstall();assert.equal(result.dataPreserved,true);assert.equal(fs.readFileSync(data,'utf8'),'private note fixture');
  assert.equal(fs.existsSync(f.paths.servicePath),false);assert.equal(fs.existsSync(path.join(f.paths.installDir,'agent.cjs')),false);assert.equal(fs.existsSync(path.join(f.paths.installDir,'backups')),true);
  assert.equal((await f.manager.status()).installed,false);
});
test('a changed startup entry and reused PID are never deleted or killed',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  fs.appendFileSync(f.paths.servicePath,'\nuser replacement');await assert.rejects(f.manager.uninstall(),{code:'NOT_OWNED'});
  f.setProcesses([{pid:9001,executable:'unrelated',commandLine:'other application'}]);await assert.rejects(f.manager.stopAgent(),{code:'PROCESS_NOT_OWNED'});
});
test('launch never closes the old add-on or an existing non-debug client',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});await f.manager.stopAgent();
  f.setLegacy(true);await assert.rejects(f.manager.launch(),{code:'LEGACY_ACTIVE'});f.setLegacy(false);
  f.setProcesses([{pid:4321,executable:f.app,commandLine:f.platform==='win32'?f.app:f.app+'/Contents/MacOS/Codex'}]);
  await assert.rejects(f.manager.launch(),{code:'CLIENT_RUNNING'});
  assert.equal(f.calls.some(c=>c.file==='/usr/bin/osascript'||c.args.includes('4321')),false);
});
test('HTTP failures and malformed CDP responses are occupied ports, never a reason to launch again',async t=>{
  for(const response of [{ok:false,status:404},{ok:true,json:async()=>{throw SyntaxError('malformed');}},{ok:true,json:async()=>({not:'a list'})}]){
    const f=fixture(t,{fetchImpl:async()=>response});await f.manager.install({app:f.app,cli:f.cli});await f.manager.stopAgent();
    await assert.rejects(f.manager.launch(),{code:'PORT_IN_USE'});
    assert.equal(f.calls.some(c=>c.file==='/usr/bin/open'||c.file===f.app),false);
  }
});
test('reinstallation uses the currently invoked Node executable, not a stale old path',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const m=JSON.parse(fs.readFileSync(f.paths.manifestPath,'utf8'));m.nodePath=path.join(f.home,'removed-node');fs.writeFileSync(f.paths.manifestPath,JSON.stringify(m));
  assert.equal(f.manager.configuration().nodePath,process.execPath);
});
test('a forced agent exit removes only its own matching stale receipt after PID exit',async t=>{
  const f=fixture(t,{leaveReceiptOnStop:true});await f.manager.install({app:f.app,cli:f.cli});
  assert.equal(fs.existsSync(f.paths.pidPath),true);await f.manager.stopAgent();
  assert.equal(fs.existsSync(f.paths.pidPath),false);
  if(f.platform==='win32')assert.equal(f.calls.some(c=>c.file==='taskkill.exe'&&c.args.includes('/T')),true);
});
test('stop-agent leaves a replacement receipt owned by another instance untouched',async t=>{
  const replacement={pid:123456,token:'00000000-0000-0000-0000-000000000000',startedAt:1};
  const f=fixture(t,{leaveReceiptOnStop:true,afterStop:paths=>fs.writeFileSync(paths.pidPath,JSON.stringify(replacement))});
  await f.manager.install({app:f.app,cli:f.cli});await f.manager.stopAgent();
  assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.pidPath,'utf8')),replacement);
});
test('recover queues an owned one-shot request and preserves the active client',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const background=JSON.parse(fs.readFileSync(f.paths.pidPath,'utf8'));
  f.setProcesses([{pid:background.pid,executable:process.execPath,commandLine:`node "${path.join(f.paths.installDir,'agent.cjs')}" --instance-token ${background.token}`},
    {pid:4321,executable:f.app,commandLine:f.platform==='win32'?f.app:f.app+'/Contents/MacOS/Codex'}]);
  const prior=f.calls.length,result=await f.manager.recover();assert.equal(result.recoveryPending,true);
  const request=JSON.parse(fs.readFileSync(path.join(f.paths.installDir,'runtime','recovery-request.json'),'utf8'));
  assert.equal(request.owner,'codex-sidebar-tools');assert.equal(request.token,background.token);assert.match(request.id,/^[a-f0-9-]{36}$/);
  assert.equal((await f.manager.status()).recoveryPending,true);
  assert.equal(f.calls.slice(prior).some(c=>c.file==='/usr/bin/open'||c.file===f.app||c.file==='taskkill.exe'||c.args.includes('bootout')),false);
});
test('recover launches a fully closed client through the existing launch entry',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const result=await f.manager.recover();assert.equal(result.launched,true);
  assert.equal(f.calls.some(c=>c.file==='/usr/bin/open'||c.file===f.app),true);
  assert.equal(fs.existsSync(path.join(f.paths.installDir,'runtime','recovery-request.json')),false);
});
test('recover refuses legacy activity and a foreign recovery request',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  f.setLegacy(true);await assert.rejects(f.manager.recover(),{code:'LEGACY_ACTIVE'});f.setLegacy(false);
  f.setProcesses([{pid:4321,executable:f.app,commandLine:f.platform==='win32'?f.app:f.app+'/Contents/MacOS/Codex'}]);
  const file=path.join(f.paths.installDir,'runtime','recovery-request.json');
  fs.writeFileSync(file,JSON.stringify({owner:'unrelated',token:'foreign',id:'foreign'}));
  await assert.rejects(f.manager.recover(),{code:'NOT_OWNED'});
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).owner,'unrelated');
});
test('background startup tolerates app/CLI replacement gaps without executing the stale CLI',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});await f.manager.stopAgent();
  fs.unlinkSync(f.cli);if(f.platform==='win32')fs.unlinkSync(f.app);else fs.rmSync(f.app,{recursive:true});
  const prior=f.calls.length;assert.equal((await f.manager.startAgent()).running,true);
  assert.equal(f.calls.slice(prior).some(c=>c.file===f.cli),false);
});
test('upgrade keeps personal data and token while backing up previous program/settings',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const token=JSON.parse(fs.readFileSync(f.paths.manifestPath,'utf8')).token;
  const data=path.join(f.paths.installDir,'data','state.json');fs.mkdirSync(path.dirname(data));fs.writeFileSync(data,'private saved note');
  fs.appendFileSync(path.join(f.paths.installDir,'agent.cjs'),'\n// prior fixture program');
  await f.manager.install();
  assert.equal(fs.readFileSync(data,'utf8'),'private saved note');
  assert.equal(JSON.parse(fs.readFileSync(f.paths.manifestPath,'utf8')).token,token);
  const backup=fs.readdirSync(path.join(f.paths.installDir,'backups')).find(name=>name.startsWith('upgrade-'));
  assert.match(fs.readFileSync(path.join(f.paths.installDir,'backups',backup,'agent.cjs'),'utf8'),/prior fixture program/);
  assert.equal(fs.existsSync(path.join(f.paths.installDir,'backups',backup,'settings.json')),true);
  assert.equal(fs.existsSync(path.join(f.paths.installDir,'backups',backup,'data')),false);
});
test('uninstall removes only matching recovery metadata while preserving personal state',async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const m=JSON.parse(fs.readFileSync(f.paths.manifestPath,'utf8'));
  const recovery=path.join(f.paths.installDir,'runtime','recovery.json'),request=path.join(f.paths.installDir,'runtime','recovery-request.json');
  fs.writeFileSync(recovery,JSON.stringify({owner:m.owner,token:m.token,pending:{reason:'missing-debug-port'}}));
  fs.writeFileSync(request,JSON.stringify({owner:'foreign',token:'other'}));
  await f.manager.uninstall();assert.equal(fs.existsSync(recovery),false);assert.equal(fs.existsSync(request),true);
});
test('detached spawning waits for spawn before unref and rejects missing executables cleanly',async()=>{
  const calls=[];
  const successful=()=>{
    const child=new EventEmitter();child.pid=1234;child.unref=()=>calls.push('unref');
    queueMicrotask(()=>{calls.push('spawn');child.emit('spawn');});return child;
  };
  assert.equal(await spawnDetached('desktop',[],{detached:true},successful),1234);
  assert.deepEqual(calls,['spawn','unref']);
  for(const file of ['C:\\Removed App\\ChatGPT.exe','C:\\Removed Node\\node.exe']){
    const missing=()=>{
      const child=new EventEmitter();child.unref=()=>assert.fail('failed executable cannot be detached');
      queueMicrotask(()=>{const error=Error('Executable disappeared during update');error.code='ENOENT';child.emit('error',error);});return child;
    };
    await assert.rejects(spawnDetached(file,[],{detached:true},missing),{code:'ENOENT'});
  }
});
test('Windows background startup reports a missing Node executable and preserves user data',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-missing-node-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const paths={installDir:root,manifestPath:path.join(root,'install.json'),configPath:path.join(root,'settings.json'),
    pidPath:path.join(root,'runtime','agent.json'),logPath:path.join(root,'runtime','agent.log'),servicePath:path.join(root,'startup.vbs')};
  const token='12345678-1234-1234-1234-123456789abc';
  fs.writeFileSync(paths.manifestPath,JSON.stringify({owner:'codex-sidebar-tools',token}));
  fs.writeFileSync(paths.configPath,JSON.stringify({owner:'codex-sidebar-tools',app:'C:\\App\\ChatGPT.exe',cli:'C:\\App\\resources\\codex.exe'}));
  const data=path.join(root,'data','state.json');fs.mkdirSync(path.dirname(data));fs.writeFileSync(data,'saved note');
  let unref=false;
  const spawn=()=>{const child=new EventEmitter();child.unref=()=>{unref=true;};queueMicrotask(()=>{const e=Error('Node removed');e.code='ENOENT';child.emit('error',e);});return child;};
  const manager=createManager({platform:'win32',paths,nodePath:'C:\\Removed Node\\node.exe',run:()=> '[]',spawn});
  await assert.rejects(manager.startAgent(),{code:'ENOENT'});
  assert.equal(unref,false);assert.equal(fs.existsSync(paths.pidPath),false);assert.equal(fs.readFileSync(data,'utf8'),'saved note');
});
test('Windows desktop launch reports an update-time missing executable while leaving the agent and data intact',{skip:process.platform!=='win32'},async t=>{
  const f=fixture(t);await f.manager.install({app:f.app,cli:f.cli});
  const data=path.join(f.paths.installDir,'data','state.json');fs.mkdirSync(path.dirname(data));fs.writeFileSync(data,'saved note');
  f.setSpawnFailure(f.app);await assert.rejects(f.manager.launch(),{code:'ENOENT'});
  assert.equal((await f.manager.status()).running,true);assert.equal(fs.readFileSync(data,'utf8'),'saved note');
  assert.equal(f.calls.some(c=>c.file==='taskkill.exe'),false);
});
