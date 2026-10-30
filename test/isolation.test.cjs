'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {membershipStatus,buildToolsScript}=require('../tools-ui.cjs');
const {CdpSession,acquireRuntimeReceipt}=require('../agent.cjs');
test('unconfigured public membership does not invent an expiry date',()=>{
  assert.equal(membershipStatus(null),null);
  const script=buildToolsScript({revision:0,membership:{expiresOn:null,timeZone:'Asia/Shanghai'},notes:'',shortcuts:[]});
  assert.doesNotThrow(()=>new Function(script));
  assert.equal(script.includes('st-pins'),false);
  assert.equal(script.includes('前两个入口'),false);
  assert.equal(script.includes('course-materials'),false);
  assert.match(script,/__codexSidebarToolsV1/);
});
test('CDP never connects to the installed legacy port or remote endpoints',async()=>{
  for(const url of ['ws://127.0.0.1:39222/test','ws://example.com:39223/test','ws://user:secret@127.0.0.1:39223/test','wss://127.0.0.1:39223/test']){
    await assert.rejects(new CdpSession({webSocketDebuggerUrl:url}).connect(),/loopback port 39223/);
  }
});
test('runtime receipt only releases its own process record',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-receipt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const token='12345678-1234-1234-1234-123456789abc';
  const release=acquireRuntimeReceipt(dir,token),file=path.join(dir,'runtime/agent.json');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pid,process.pid);
  assert.throws(()=>acquireRuntimeReceipt(dir,token),/already running/);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,token:'87654321-4321-4321-4321-cba987654321'}));
  release();assert.equal(fs.existsSync(file),true);
});
test('a reused PID does not block startup or terminate the unrelated process',async t=>{
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  t.after(()=>{child.kill();});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-reused-pid-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'runtime/agent.json'),token='12345678-1234-1234-1234-123456789abc';
  fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,JSON.stringify({pid:child.pid,token,startedAt:1}));
  const release=acquireRuntimeReceipt(dir,token,{processes:options=>{
    assert.equal(options.pid,child.pid);
    return [{pid:child.pid,commandLine:process.execPath+' -e fixture-unrelated-process'}];
  }});
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).pid,process.pid);
  assert.doesNotThrow(()=>process.kill(child.pid,0));release();
});
