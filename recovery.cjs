'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {DEFAULT_PORT,createRuntimeLocator,listProcesses,systemRun}=require('./platform.cjs');
const OWNER='codex-sidebar-tools';
const MAX_AGE=86400000;

function readOwned(file,token,{missing=true}={}) {
  try {
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Unsafe recovery metadata');
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(value.owner!==OWNER||value.token!==token)throw Error('Recovery metadata belongs to another installation');
    return value;
  } catch(error) {if(missing&&error.code==='ENOENT')return null;throw error;}
}
function createRecoveryStore(dataDir,token) {
  const directory=path.join(dataDir,'runtime'),file=path.join(directory,'recovery.json'),requestFile=path.join(directory,'recovery-request.json');
  return {
    load:()=>readOwned(file,token),
    save(value) {
      readOwned(file,token);fs.mkdirSync(directory,{recursive:true,mode:0o700});
      const temporary=file+'.'+randomUUID()+'.tmp';
      try {fs.writeFileSync(temporary,JSON.stringify({...value,owner:OWNER,token},null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
      finally {try {fs.unlinkSync(temporary);} catch(error) {if(error.code!=='ENOENT')throw error;}}
    },
    request:()=>readOwned(requestFile,token),
    consume(id) {if(readOwned(requestFile,token)?.id===id)fs.unlinkSync(requestFile);}
  };
}
function validPending(pending,now) {
  return pending&&typeof pending==='object'&&typeof pending.key==='string'&&pending.key.length>0&&
    ['missing-debug-port','app-updated','manual-repair'].includes(pending.reason)&&
    Number.isFinite(pending.requestedAt)&&pending.requestedAt<=now&&Number.isFinite(pending.expiresAt)&&
    pending.expiresAt>now&&pending.expiresAt-pending.requestedAt<=MAX_AGE;
}
class RecoveryController {
  constructor(adapter,{store,now=Date.now,bootAt=Date.now()-os.uptime()*1000,settleMs=2000,stableMs=1500}={}) {
    Object.assign(this,{adapter,store,now,bootAt,settleMs,stableMs});
    const saved=store.load();
    const sameBoot=saved&&Number.isFinite(saved.bootAt)&&Math.abs(saved.bootAt-bootAt)<10000;
    this.state=sameBoot?{...saved}:{bootAt,pending:null,bundle:null,lastSeen:null,lastExitAt:null,event:'watching'};
    if(!validPending(this.state.pending,now()))this.state.pending=null;
    this.needsSave=!sameBoot||Boolean(saved?.pending&&!this.state.pending);
    this.busy=false;this.stopped=false;this.absentSince=null;this.nextCheckMs=5000;
  }
  stop(){this.stopped=true;}
  async persist(event,changes={}) {
    const next={...this.state,...changes,event,updatedAt:this.now()};
    await this.store.save(next);this.state=next;
  }
  async arm(app,reason) {
    if(this.state.pending?.key===app.key&&this.state.pending.reason===reason)return;
    await this.persist('waiting-for-exit',{pending:{key:app.key,reason,requestedAt:this.now(),expiresAt:this.now()+MAX_AGE}});
    this.absentSince=null;
  }
  async clear(event){await this.persist(event,{pending:null});this.absentSince=null;}
  async poll() {
    if(this.busy||this.stopped)return;
    this.busy=true;this.nextCheckMs=5000;
    try {
      if(this.needsSave) {await this.persist(this.state.event);this.needsSave=false;}
      const snapshot=await this.adapter.snapshot();
      if(this.stopped)return;
      if(snapshot.blocked) {if(this.state.pending)await this.clear('blocked-by-other-addon');return;}
      const apps=snapshot.apps,previous=this.state.lastSeen;
      const request=await this.store.request?.();
      if(request) {
        const valid=typeof request.id==='string'&&Number.isFinite(request.requestedAt)&&
          request.requestedAt>=this.bootAt-5000&&request.requestedAt<=this.now()&&this.now()-request.requestedAt<MAX_AGE;
        if(valid&&apps.length===1&&apps[0].known&&apps[0].debugPort===null)await this.arm(apps[0],'manual-repair');
        else if(valid&&apps.length===0)await this.arm({key:'request:'+request.id},'manual-repair');
        // A requested repair is never permission to close an open client. If it
        // is already enabled, the normal injector will reconnect without restart.
        await this.store.consume(request.id);
      }
      const bundle=snapshot.bundle;
      if(bundle?.fingerprint&&bundle.fingerprint!==this.state.bundle?.fingerprint) {
        const changed=Boolean(this.state.bundle);
        const candidate=apps.length===1?apps[0]:apps.length===0&&this.state.lastExitAt!==null&&
          this.now()-this.state.lastExitAt<30000?previous:null;
        await this.persist(changed?'app-updated':'bundle-observed',{bundle:{...bundle,observedAt:this.now()}});
        // A newly opened, already-enabled replacement has completed its own
        // handoff. A changed bundle under the SAME running process needs repair.
        if(changed&&candidate&&candidate.known&&[null,DEFAULT_PORT].includes(candidate.debugPort)&&
          (candidate.debugPort!==DEFAULT_PORT||candidate.key===previous?.key))
          await this.arm(candidate,'app-updated');
      }
      if(apps.length===1&&apps[0].key!==previous?.key)await this.persist(this.state.event,{lastSeen:{...apps[0]},lastExitAt:null});
      if(apps.length===0&&previous&&this.state.lastExitAt===null)await this.persist(this.state.event,{lastExitAt:this.now()});
      if(this.state.pending&&!validPending(this.state.pending,this.now()))await this.clear('recovery-expired');
      if(apps.length) {
        this.absentSince=null;
        if(apps.length!==1)return;
        const app=apps[0],pending=this.state.pending;
        if(app.debugPort===DEFAULT_PORT||snapshot.connected) {
          if(pending&&(pending.key!==app.key||pending.reason!=='app-updated'))await this.clear('connection-restored');
          return;
        }
        if(!app.known||app.debugPort!==null) {
          if(pending&&pending.key!==app.key)await this.clear('replacement-unverified');
          return;
        }
        if(!pending||pending.key!==app.key)await this.arm(app,'missing-debug-port');
        return;
      }
      if(!this.state.pending)return;
      if(this.absentSince===null)this.absentSince=this.now();
      if(this.now()-this.absentSince<this.settleMs) {this.nextCheckMs=this.settleMs;return;}
      if(!bundle?.ready||!bundle.fingerprint||this.now()-(this.state.bundle?.observedAt??this.now())<this.stableMs) {
        if(this.now()-this.absentSince>120000)await this.clear('app-update-timeout');
        else this.nextCheckMs=2000;
        return;
      }
      if(await this.adapter.portInUse()) {await this.clear('port-in-use');return;}
      const fresh=await this.adapter.snapshot({force:true});
      if(this.stopped)return;
      if(fresh.blocked||fresh.apps.length) {this.nextCheckMs=1000;return;}
      if(!fresh.bundle?.ready||fresh.bundle.fingerprint!==bundle.fingerprint) {this.nextCheckMs=2000;return;}
      // A durable, consumed receipt comes before any OS launch. Failure or an
      // abrupt helper exit can never repeatedly reopen a client the user quits.
      await this.clear('recovery-launching');
      if(this.stopped)return;
      await this.adapter.launch(fresh.runtime);
      if(!this.stopped)await this.persist('recovery-open-requested');
    } catch(error) {
      // Failing closed preserves the pending request. An app update can briefly
      // remove paths; retry later instead of terminating the Windows background.
      if(!this.stopped)try {await this.persist('retrying',{error:String(error.code||error.message).slice(0,160)});}catch{}
    } finally {this.busy=false;}
  }
}
function mainProcesses(rows,apps,platform=process.platform) {
  const p=platform==='win32'?path.win32:path;
  const normal=value=>platform==='win32'?p.normalize(value).toLowerCase():value;
  return rows.flatMap(row=>{
    // Windows Electron renderer/GPU/utility children reuse the desktop EXE.
    // They are not additional client windows and must not suppress recovery.
    if(/(?:^|\s)["']?--type(?:=|\s)/.test(row.commandLine||''))return [];
    const matched=apps.find(app=>platform==='win32'?normal(row.executable||'')===normal(app):
      ['ChatGPT','Codex'].some(name=>row.commandLine===app+'/Contents/MacOS/'+name||row.commandLine.startsWith(app+'/Contents/MacOS/'+name+' ')));
    if(!matched)return [];
    const port=/--remote-debugging-port(?:=|\s+)(\d+)(?=\s|$)/.exec(row.commandLine||'');
    return [{key:row.pid+':'+normal(matched),pid:row.pid,path:matched,known:Boolean(row.commandLine),debugPort:port?Number(port[1]):null}];
  });
}
function appFingerprint(app,platform=process.platform) {
  try {
    const files=platform==='win32'?[app]:[path.join(app,'Contents/Info.plist'),
      ['ChatGPT','Codex'].map(name=>path.join(app,'Contents/MacOS',name)).find(file=>fs.existsSync(file))];
    if(files.some(file=>!file))return null;
    return files.map(file=>{
      const stat=fs.statSync(file);if(!stat.isFile()||!stat.size)throw Error('Incomplete client');
      return [file,stat.dev,stat.ino,stat.size,stat.mtimeMs].join(':');
    }).join('|');
  } catch{return null;}
}
function localPortInUse() {
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port:DEFAULT_PORT});let ended=false;
    const done=value=>{if(ended)return;ended=true;socket.destroy();resolve(value);};
    socket.once('connect',()=>done(true));socket.once('error',error=>done(error.code!=='ECONNREFUSED'));socket.setTimeout(500,()=>done(true));
  });
}
function createSystemAdapter({app,cli,dataDir,token,platform=process.platform,home=os.homedir(),env=process.env,
  now=Date.now,run=systemRun,spawnImpl=spawn,connected=()=>false,locate=createRuntimeLocator({app,cli,platform,home,env,run}),
  processes=()=>listProcesses({platform,run}),fingerprint=target=>appFingerprint(target,platform),portInUse=localPortInUse}={}) {
  let cached=null,lastResolve=-Infinity;const knownApps=new Set(app?[app]:[]);
  return {
    async snapshot({force=false}={}) {
      let runtime=cached;
      if(force||!cached||now()-lastResolve>30000||!fs.existsSync(cached.app)||!fs.existsSync(cached.cli)) {
        lastResolve=now();try {runtime=cached=locate();knownApps.add(runtime.app);}catch {runtime=cached=null;}
      }
      const installation=readOwned(path.join(dataDir,'install.json'),token);
      const rows=processes();
      let legacy=false;
      if(platform==='darwin')try {legacy=/\b(?:pid = \d+|state = running)/.test(String(run('/bin/launchctl',['print',`gui/${process.getuid?.()||0}/com.codexusagebadge.agent`])));}catch{}
      else legacy=rows.some(row=>/CodexUsageBadge/i.test(row.commandLine)&&/agent\.cjs/i.test(row.commandLine));
      const current=runtime?.app||[...knownApps].at(-1)||app;
      return {apps:mainProcesses(rows,[...knownApps],platform),connected:connected(),runtime,
        bundle:{fingerprint:current?fingerprint(current):null,ready:Boolean(runtime)},
        blocked:!installation||installation.status==='uninstalled'||legacy};
    },
    portInUse,
    async launch(runtime) {
      if(!runtime)throw Error('Client update incomplete');
      const args=['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${DEFAULT_PORT}`];
      if(platform==='darwin')run('/usr/bin/open',['-g','-a',runtime.app,'--args',...args]);
      else await new Promise((resolve,reject)=>{
        const child=spawnImpl(runtime.app,args,{detached:true,stdio:'ignore',windowsHide:false,env});
        child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
      });
    }
  };
}
module.exports={RecoveryController,createRecoveryStore,createSystemAdapter,mainProcesses,appFingerprint,validPending};
