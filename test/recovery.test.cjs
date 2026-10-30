'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RecoveryController,createRecoveryStore,mainProcesses,appFingerprint,createSystemAdapter}=require('../recovery.cjs');
const TOKEN='12345678-1234-1234-1234-123456789abc';
function fixture({state=null,bootAt=10000}={}) {
  let now=100000,apps=[],fp='app-v1',ready=true,blocked=false,occupied=false,connected=false,request=null,saved=state;
  let diskFailure=false,launchFailure=false,race=null;
  const events=[],calls=[];
  const clone=value=>value===null?null:structuredClone(value);
  const store={load:()=>clone(saved),save(value){if(diskFailure)throw Error('disk full');saved=clone(value);events.push(clone(value));},
    request:()=>request,consume(id){if(request?.id===id)request=null;}};
  const app=(key='original',debugPort=null)=>({key,pid:42,known:true,debugPort,path:'/fixture/Codex.app'});
  const adapter={async snapshot(){const value={apps:clone(apps),connected,blocked,runtime:ready?{app:'/fixture/Codex.app',cli:'/fixture/codex'}:null,bundle:{fingerprint:fp,ready}};if(race){const fn=race;race=null;fn();}return value;},
    async portInUse(){return occupied;},
    async launch(){assert.equal(saved.pending,null);assert.equal(saved.event,'recovery-launching');calls.push('launch');if(launchFailure)throw Error('launch failed');apps=[app('managed',39223)];}
  };
  let controller;
  function restart(options={}){controller=new RecoveryController(adapter,{store,now:()=>now,bootAt,...options});}
  restart();
  return {get controller(){return controller;},adapter,store,app,calls,events,
    poll:()=>controller.poll(),restart,advance:ms=>{now+=ms;},saved:()=>clone(saved),
    setApps:value=>{apps=value;},setFingerprint:value=>{fp=value;},setReady:value=>{ready=value;},
    setBlocked:value=>{blocked=value;},setOccupied:value=>{occupied=value;},setConnected:value=>{connected=value;},
    failDisk:value=>{diskFailure=value;},failLaunch:value=>{launchFailure=value;},
    request:()=>{request={id:'manual-request',requestedAt:now};},requestPresent:()=>request!==null,
    race:fn=>{race=fn;}};
}
async function exitAndSettle(f){f.setApps([]);await f.poll();f.advance(2100);await f.poll();}
test('active missing-port client is preserved; exit restores only once across observer restarts',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();assert.equal(f.saved().pending.reason,'missing-debug-port');assert.deepEqual(f.calls,[]);
  f.restart();await f.poll();await exitAndSettle(f);assert.deepEqual(f.calls,['launch']);
  await f.poll();await exitAndSettle(f);assert.deepEqual(f.calls,['launch']);
});
test('ordinary quit of a connected client leaves it closed',async()=>{
  const f=fixture();f.setApps([f.app('managed',39223)]);await f.poll();await exitAndSettle(f);
  assert.deepEqual(f.calls,[]);assert.equal(f.saved().pending,null);
});
test('update while client runs queues a handoff without closing it',async()=>{
  const f=fixture();f.setApps([f.app('old',39223)]);await f.poll();f.setFingerprint('app-v2');await f.poll();
  assert.equal(f.saved().pending.reason,'app-updated');assert.deepEqual(f.calls,[]);
  await exitAndSettle(f);assert.deepEqual(f.calls,['launch']);
  await f.poll();await exitAndSettle(f);assert.deepEqual(f.calls,['launch']);
});
test('a late bundle observation of an already-enabled replacement does not reopen it again',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setFingerprint('app-v2');f.setApps([f.app('new',39223)]);await f.poll();
  assert.equal(f.saved().pending,null);await exitAndSettle(f);assert.deepEqual(f.calls,[]);
});
test('bundle update shortly after managed client exit can still perform one handoff',async()=>{
  const f=fixture();f.setApps([f.app('old',39223)]);await f.poll();f.setApps([]);await f.poll();
  f.advance(3000);f.setFingerprint('app-v2');await f.poll();f.advance(2100);await f.poll();
  assert.deepEqual(f.calls,['launch']);
});
test('updating an application that was already closed does not start it',async()=>{
  const f=fixture();f.setApps([f.app('managed',39223)]);await f.poll();f.setApps([]);await f.poll();
  f.advance(31000);f.setFingerprint('app-v2');await f.poll();f.advance(3000);await f.poll();assert.deepEqual(f.calls,[]);
});
test('a user-provided enabled replacement cancels deferred recovery',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setApps([]);await f.poll();f.setApps([f.app('user',39223)]);
  await f.poll();await exitAndSettle(f);assert.deepEqual(f.calls,[]);
});
test('manual request survives user quitting before the next observer poll',async()=>{
  const f=fixture();await f.poll();f.request();await f.poll();assert.equal(f.requestPresent(),false);
  f.advance(2100);await f.poll();assert.deepEqual(f.calls,['launch']);
});
test('manual request for an active window only arms recovery',async()=>{
  const f=fixture();f.setApps([f.app()]);f.request();await f.poll();
  assert.equal(f.saved().pending.reason,'manual-repair');assert.deepEqual(f.calls,[]);assert.equal(f.requestPresent(),false);
});
test('foreign debug ports and unknown process arguments do not authorize recovery',async()=>{
  for(const app of [{key:'other',known:true,debugPort:39222},{key:'unknown',known:false,debugPort:null}]) {
    const f=fixture();f.setApps([app]);await f.poll();await exitAndSettle(f);assert.deepEqual(f.calls,[]);
  }
});
test('app update gaps wait for complete files and are bounded',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setReady(false);await exitAndSettle(f);
  assert.deepEqual(f.calls,[]);f.setReady(true);await f.poll();assert.deepEqual(f.calls,['launch']);
  const g=fixture();g.setApps([g.app()]);await g.poll();g.setReady(false);await exitAndSettle(g);
  g.advance(121000);await g.poll();assert.equal(g.saved().pending,null);assert.deepEqual(g.calls,[]);
});
test('an occupied debug port cancels recovery',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setOccupied(true);await exitAndSettle(f);
  assert.equal(f.saved().pending,null);assert.deepEqual(f.calls,[]);
});
test('failed durable write prevents launch; failed launch does not cause a reopen loop',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setApps([]);await f.poll();f.advance(2100);f.failDisk(true);
  await f.poll();assert.deepEqual(f.calls,[]);f.failDisk(false);f.failLaunch(true);await f.poll();await f.poll();
  f.advance(50000);await f.poll();assert.deepEqual(f.calls,['launch']);assert.equal(f.saved().pending,null);
});
test('another process appearing in the final snapshot prevents a competing launch',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setApps([]);await f.poll();f.advance(2100);
  f.race(()=>f.setApps([f.app('user',39223)]));await f.poll();assert.deepEqual(f.calls,[]);
  await f.poll();assert.equal(f.saved().pending,null);
});
test('stopping observation, legacy add-on detection, and a new boot all suppress recovery',async()=>{
  const f=fixture();f.setApps([f.app()]);await f.poll();f.setBlocked(true);await exitAndSettle(f);assert.deepEqual(f.calls,[]);
  const g=fixture();g.setApps([g.app()]);await g.poll();g.controller.stop();await exitAndSettle(g);assert.deepEqual(g.calls,[]);
  const h=fixture();h.setApps([h.app()]);await h.poll();h.setApps([]);h.restart({bootAt:50000});await h.poll();h.advance(3000);await h.poll();assert.deepEqual(h.calls,[]);
});
test('recovery metadata keeps personal state untouched and rejects foreign ownership',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/state.json'),'private fixture');
  const store=createRecoveryStore(root,TOKEN);assert.equal(store.load(),null);store.save({pending:null,bootAt:1});
  assert.equal(store.load().token,TOKEN);assert.equal(fs.readFileSync(path.join(root,'data/state.json'),'utf8'),'private fixture');
  const file=path.join(root,'runtime/recovery.json');fs.writeFileSync(file,JSON.stringify({owner:'someone-else',token:TOKEN}));
  assert.throws(()=>store.load(),/another installation/);assert.throws(()=>store.save({pending:null}),/another installation/);
});
test('process recognition selects only main app paths and reads both platform port forms',()=>{
  const mac='/Applications/Codex.app';
  assert.deepEqual(mainProcesses([{pid:1,commandLine:mac+'/Contents/MacOS/Codex --remote-debugging-port=39223'},
    {pid:2,commandLine:mac+'/Contents/Frameworks/Helper --remote-debugging-port=39223'}],[mac],'darwin').map(x=>[x.pid,x.debugPort]),[[1,39223]]);
  const win='C:\\Program Files\\Codex\\ChatGPT.exe';
  assert.equal(mainProcesses([{pid:3,executable:win.toLowerCase(),commandLine:'"'+win+'" --remote-debugging-port 39223'}],[win],'win32')[0].debugPort,39223);
  const rows=[{pid:1,executable:win,commandLine:'"'+win+'" --remote-debugging-port=39223'},
    ...['renderer','gpu-process','utility'].map((type,i)=>({pid:i+2,executable:win,commandLine:'"'+win+'" --type='+type}))];
  assert.deepEqual(mainProcesses(rows,[win],'win32').map(row=>row.pid),[1]);
});
test('system adapter requires owned installation and launches only loopback parameters',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-recovery-adapter-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'install.json'),JSON.stringify({owner:'codex-sidebar-tools',token:TOKEN,status:'installed'}));
  const calls=[];const app=path.join(root,'Codex.app'),cli=path.join(root,'codex');
  fs.mkdirSync(app);fs.writeFileSync(cli,'fixture');
  const adapter=createSystemAdapter({app,cli,dataDir:root,token:TOKEN,platform:'darwin',locate:()=>({app,cli}),
    processes:()=>[],fingerprint:()=> 'ready',run:(file,args)=>{if(file==='/bin/launchctl')throw Error('not loaded');calls.push({file,args});}});
  assert.equal((await adapter.snapshot()).blocked,false);await adapter.launch({app,cli});
  assert.deepEqual(calls,[{file:'/usr/bin/open',args:['-g','-a',app,'--args','--remote-debugging-address=127.0.0.1','--remote-debugging-port=39223']}]);
  fs.writeFileSync(path.join(root,'install.json'),JSON.stringify({owner:'codex-sidebar-tools',token:TOKEN,status:'uninstalled'}));
  assert.equal((await adapter.snapshot()).blocked,true);
});
