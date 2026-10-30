'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('installed agent survives an initial app/CLI update gap without touching real client or data', {timeout:10000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-startup-integration-'));
  let child,output='';
  async function stop(){if(!child||child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;}
  t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
  for(const name of ['agent.cjs','platform.cjs','recovery.cjs','tools-ui.cjs','tools-store.cjs'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(root,name));
  const token='12345678-1234-1234-1234-123456789abc';
  fs.writeFileSync(path.join(root,'install.json'),JSON.stringify({owner:'codex-sidebar-tools',token,status:'installed'}));
  const data=path.join(root,'data/state.json');
  require('../tools-store.cjs').createToolsStore({filePath:data}).getState();
  const before=fs.readFileSync(data,'utf8');
  const preload=path.join(root,'fixture-preload.cjs');
  fs.writeFileSync(preload,`
    const p=require('./platform.cjs');
    p.getPaths=()=>({installDir:${JSON.stringify(root)}});
    p.createRuntimeLocator=()=>()=>{throw Error('fixture app update gap');};
    p.listProcesses=()=>[];
    globalThis.fetch=async()=>({ok:true,json:async()=>[]});
  `);
  child=spawn(process.execPath,['--require',preload,path.join(root,'agent.cjs'),'--app',path.join(root,'temporarily-missing.app'),
    '--codex-bin',path.join(root,'missing-cli'),'--data-dir',root,'--instance-token',token],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  const receipt=path.join(root,'runtime/agent.json'),recovery=path.join(root,'runtime/recovery.json');
  const deadline=Date.now()+4000;
  while(Date.now()<deadline&&!fs.existsSync(recovery)&&child.exitCode===null)await delay(40);
  assert.equal(child.exitCode,null,output);assert.equal(fs.existsSync(receipt),true,output);
  assert.equal(fs.existsSync(recovery),true,output);assert.equal(JSON.parse(fs.readFileSync(recovery,'utf8')).pending,null);
  assert.equal(fs.readFileSync(data,'utf8'),before);
  await stop();
  // Windows task termination may be forced; the manager/next agent reclaims its
  // own stale receipt, already covered by the ownership tests.
  if(process.platform!=='win32')assert.equal(fs.existsSync(receipt),false);
});
