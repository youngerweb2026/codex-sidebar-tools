'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createManager,parseArgs,winQuote}=require('../manage.cjs');
const {getPaths}=require('../platform.cjs');
function fixture(t,{fetchImpl=async()=>{throw Error('offline');},leaveReceiptOnStop=false,afterStop}={}){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-manager-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const platform=process.platform==='win32'?'win32':'darwin',env={...process.env,LOCALAPPDATA:path.join(home,'Local'),APPDATA:path.join(home,'Roaming')};
  const paths=getPaths({platform,home,env});const app=platform==='win32'?path.join(home,'Custom App','ChatGPT.exe'):path.join(home,'Custom App','Codex.app');
  const cli=platform==='win32'?path.join(path.dirname(app),'resources','codex.exe'):path.join(app,'Contents','Resources','codex');
  fs.mkdirSync(path.dirname(cli),{recursive:true});fs.writeFileSync(cli,'fixture');if(platform==='win32')fs.writeFileSync(app,'desktop');
  let processes=[],legacy=false,active=false;const calls=[];
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
  const spawn=(file,args)=>{calls.push({file,args});if(file===process.execPath)start();return {pid:9001,unref(){}};};
  const manager=createManager({platform,home,env,paths,sourceDir:path.join(__dirname,'..'),nodePath:process.execPath,run,spawn,wait:async()=>{},kill:stop,fetchImpl});
  return {home,platform,paths,app,cli,manager,calls,setLegacy(value){legacy=value;if(platform==='win32')processes=value?[{pid:777,executable:'node.exe',commandLine:'node CodexUsageBadge/agent.cjs'}]:[];},setProcesses(value){processes=value;}};
}
test('CLI arguments preserve explicit paths and reject unknown options',()=>{
  assert.deepEqual(parseArgs(['install','--app','C:\\Custom App\\Codex.exe','--codex-bin','C:\\CLI\\codex.exe']),{action:'install',options:{app:'C:\\Custom App\\Codex.exe',cli:'C:\\CLI\\codex.exe'}});
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
