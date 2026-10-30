'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {spawn:systemSpawn}=require('node:child_process');
const {getPaths,discoverApp,discoverCli,listProcesses,systemRun,DEFAULT_PORT,fault}=require('./platform.cjs');
const OWNER='codex-sidebar-tools';
const VERSION='0.1.0-beta.1';
const LABEL='com.buerhe.codex-sidebar-tools';
const RUNTIME_FILES=['agent.cjs','tools-ui.cjs','tools-store.cjs','platform.cjs','manage.cjs','LICENSE'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const vbString=value=>'"'+String(value).replaceAll('"','""')+'"';
function winQuote(value){return '"'+String(value).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
function parseArgs(argv){
  const action=argv[0]||'status',options={};
  if(!['install','uninstall','status','launch','start-agent','stop-agent'].includes(action))throw fault('INVALID_ACTION','用法：node manage.cjs install|launch|status|uninstall|start-agent|stop-agent [--app 路径] [--codex-bin 路径]');
  for(let i=1;i<argv.length;i++){
    const key=argv[i];if(!['--app','--codex-bin'].includes(key)||!argv[i+1])throw fault('INVALID_ARGUMENT','不支持的参数：'+key);
    options[key==='--app'?'app':'cli']=argv[++i];
  }
  return {action,options};
}
function createManager({platform=process.platform,home=os.homedir(),env=process.env,sourceDir=__dirname,nodePath=process.execPath,
  paths=getPaths({platform,home,env}),run=systemRun,spawn=systemSpawn,kill=process.kill,fetchImpl=globalThis.fetch,wait=sleep,uid=process.getuid?.()||0}={}){
  const root=paths.installDir,service=`gui/${uid}/${LABEL}`;
  function readJson(file){
    const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>131072)throw fault('UNSAFE_FILE','本地管理文件格式或路径异常。');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
  function manifest(required=true){
    try{const m=readJson(paths.manifestPath);if(m.owner!==OWNER||typeof m.token!=='string'||!/^[a-f0-9-]{36}$/.test(m.token))throw fault('NOT_OWNED','目录不是本项目创建的安装目录，已停止操作。');return m;}
    catch(error){if(!required&&error.code==='ENOENT')return null;throw error;}
  }
  function receipt(){try{const value=readJson(paths.pidPath);return Number.isSafeInteger(value.pid)&&value.pid>0?value:null;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  function processList(){return listProcesses({platform,run});}
  function ownedProcess(m){
    const record=receipt();if(!record||record.token!==m.token)return null;
    const row=processList().find(p=>p.pid===record.pid);if(!row)return null;
    const line=platform==='win32'?row.commandLine.toLowerCase():row.commandLine;
    const needle=platform==='win32'?path.join(root,'agent.cjs').toLowerCase():path.join(root,'agent.cjs');
    if(!line.includes(needle)||!line.includes('--instance-token')||!line.includes(m.token))throw fault('PROCESS_NOT_OWNED','后台 PID 已不属于本项目，拒绝结束该进程。');
    return record;
  }
  function removeStoppedReceipt(record,m){
    if(!record||record.token!==m.token||processList().some(row=>row.pid===record.pid))return;
    try{
      const before=fs.lstatSync(paths.pidPath);
      if(before.isSymbolicLink()||!before.isFile()||before.size>2048)return;
      const current=JSON.parse(fs.readFileSync(paths.pidPath,'utf8'));
      if(current.pid!==record.pid||current.token!==record.token)return;
      const after=fs.lstatSync(paths.pidPath);
      if(after.isSymbolicLink()||!after.isFile()||['dev','ino','size','mtimeMs'].some(key=>before[key]!==after[key]))return;
      fs.unlinkSync(paths.pidPath);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function legacyActive(){
    if(platform==='darwin'){try{return /\b(?:pid = \d+|state = running)/.test(String(run('/bin/launchctl',['print',`gui/${uid}/com.codexusagebadge.agent`])));}catch{return false;}}
    return processList().some(p=>/codexusagebadge/i.test(p.commandLine)&&/agent\.cjs/i.test(p.commandLine));
  }
  function configuration(options={}){
    manifest(false);let saved={};try{saved=readJson(paths.configPath);}catch(error){if(error.code!=='ENOENT')throw error;}
    const app=discoverApp({platform,home,env,explicit:options.app||(saved.app&&fs.existsSync(saved.app)?saved.app:undefined),run});
    const cli=discoverCli(app,{platform,home,env,explicit:options.cli||(saved.app===app&&saved.cli&&fs.existsSync(saved.cli)?saved.cli:undefined)});
    if(/\.cmd$|\.bat$/i.test(cli))throw fault('INVALID_CLI','请指定原生 Codex CLI 可执行文件，不使用 .cmd/.bat 包装脚本。');
    const output=String(run(cli,['--version'])).trim();if(!/codex/i.test(output))throw fault('INVALID_CLI','所选可执行文件未返回 Codex CLI 版本信息。');
    return {owner:OWNER,app,cli,port:DEFAULT_PORT,nodePath};
  }
  function agentArgs(config,m){return [path.join(root,'agent.cjs'),'--port',String(DEFAULT_PORT),'--app',config.app,'--codex-bin',config.cli,'--data-dir',root,'--instance-token',m.token];}
  function serviceContent(config,m){
    if(platform==='darwin'){
      const args=[config.nodePath,...agentArgs(config,m)].map(x=>`<string>${xml(x)}</string>`).join('');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${OWNER}:${m.token} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${args}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${xml(paths.logPath)}</string><key>StandardErrorPath</key><string>${xml(paths.logPath)}</string></dict></plist>\n`;
    }
    const command=[config.nodePath,path.join(root,'manage.cjs'),'start-agent'].map(winQuote).join(' ');
    return `' ${OWNER}:${m.token}\r\nOption Explicit\r\nDim shell\r\nSet shell = CreateObject("WScript.Shell")\r\nshell.Run ${vbString(command)}, 0, False\r\n`;
  }
  function checkService(m,{allowMissing=false}={}){
    try{const stat=fs.lstatSync(paths.servicePath);if(stat.isSymbolicLink()||!stat.isFile())throw fault('NOT_OWNED','后台入口路径被其他内容占用。');const text=fs.readFileSync(paths.servicePath,'utf8');if(!m.serviceHash||hash(text)!==m.serviceHash||!text.includes(`${OWNER}:${m.token}`))throw fault('NOT_OWNED','后台入口已被修改，拒绝覆盖或删除。');return true;}
    catch(error){if(error.code==='ENOENT'&&allowMissing)return false;throw error;}
  }
  function saveService(config,m){
    checkService(m,{allowMissing:true});const text=serviceContent(config,m);
    fs.mkdirSync(path.dirname(paths.servicePath),{recursive:true,mode:0o700});fs.writeFileSync(paths.servicePath,text,{mode:0o600});
    return {...m,serviceHash:hash(text)};
  }
  async function startAgent(options={}){
    let m=manifest();if(ownedProcess(m))return {running:true,alreadyRunning:true};
    const config=configuration(options);
    fs.mkdirSync(path.dirname(paths.pidPath),{recursive:true,mode:0o700});
    if(platform==='darwin'){
      m=saveService(config,m);writeJson(paths.configPath,config);writeJson(paths.manifestPath,m);
      try{run('/bin/launchctl',['print',service]);run('/bin/launchctl',['kickstart',service]);}
      catch{run('/bin/launchctl',['bootstrap',`gui/${uid}`,paths.servicePath]);}
    }else{
      const descriptor=fs.openSync(paths.logPath,'a',0o600);
      try{const child=spawn(config.nodePath,agentArgs(config,m),{detached:true,windowsHide:true,stdio:['ignore',descriptor,descriptor],env});child.unref();}
      finally{fs.closeSync(descriptor);}
    }
    for(let n=0;n<40;n++){const record=ownedProcess(m);if(record)return {running:true,pid:record.pid};await wait(100);}
    throw fault('AGENT_NOT_READY','后台尚未确认运行。请查看安装目录 runtime/agent.log，解决问题后重试 start-agent。');
  }
  async function stopAgent(){
    const m=manifest(),record=ownedProcess(m);
    if(platform==='darwin'&&checkService(m,{allowMissing:true})){
      try{run('/bin/launchctl',['print',service]);run('/bin/launchctl',['bootout',service]);}catch(error){if(record)throw fault('STOP_FAILED','后台任务未能退出，请稍后重试。');}
    }else if(record){
      if(platform==='win32')run('taskkill.exe',['/PID',String(record.pid),'/T','/F']);else kill(record.pid,'SIGTERM');
    }
    for(let n=0;n<40;n++){
      if(!ownedProcess(m)){removeStoppedReceipt(record,m);return {running:false};}await wait(100);
    }
    throw fault('STOP_FAILED','后台任务未能退出，请稍后重试。');
  }
  async function install(options={}){
    if(Number(process.versions.node.split('.')[0])<24)throw fault('NODE_VERSION','需要 Node.js 24 或更新版本。');
    const prior=manifest(false),config=configuration(options);
    if(!prior&&fs.existsSync(root)&&fs.readdirSync(root).length)throw fault('NOT_OWNED','目标安装目录已有其他文件，未做覆盖。');
    for(const name of RUNTIME_FILES)if(!fs.existsSync(path.join(sourceDir,name)))throw fault('INCOMPLETE_PACKAGE','安装包缺少 '+name);
    const m=prior||{owner:OWNER,version:VERSION,token:randomUUID(),nodePath,createdAt:new Date().toISOString()};
    checkService(m,{allowMissing:true});
    if(prior)await stopAgent();
    fs.mkdirSync(root,{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(paths.pidPath),{recursive:true,mode:0o700});
    for(const name of RUNTIME_FILES){const from=path.join(sourceDir,name),to=path.join(root,name);if(path.resolve(from)!==path.resolve(to))fs.copyFileSync(from,to);fs.chmodSync(to,0o600);}
    const scripts=path.join(sourceDir,'scripts');
    if(fs.existsSync(scripts)){fs.mkdirSync(path.join(root,'scripts'),{recursive:true});for(const name of fs.readdirSync(scripts)){if(!/\.(command|cmd|ps1|sh)$/.test(name))continue;const from=path.join(scripts,name),to=path.join(root,'scripts',name);if(path.resolve(from)!==path.resolve(to))fs.copyFileSync(from,to);fs.chmodSync(to,name.endsWith('.command')||name.endsWith('.sh')?0o700:0o600);}}
    writeJson(paths.configPath,config);const updated=saveService(config,{...m,version:VERSION,status:'installed',nodePath:config.nodePath});writeJson(paths.manifestPath,updated);
    const result=await startAgent();return {...result,installDir:root,message:'安装完成。请保存工作并手动完全退出客户端，再运行“打开Codex”入口。安装不会替你关闭客户端或处理旧版。'};
  }
  async function status(){
    const m=manifest(false);if(!m)return {installed:false,running:false,platform,port:DEFAULT_PORT};
    const record=ownedProcess(m);return {installed:m.status!=='uninstalled',version:m.version,platform,running:Boolean(record),pid:record?.pid||null,port:DEFAULT_PORT,installDir:root,dataPreserved:true};
  }
  async function launch(options={}){
    let m=manifest();
    if(legacyActive())throw fault('LEGACY_ACTIVE','检测到旧版 Codex Usage Badge 后台仍在运行。请先自行停用旧版再运行新版；本程序不会关闭或修改旧版。');
    const config=configuration(options);
    try{
      const response=await fetchImpl(`http://127.0.0.1:${DEFAULT_PORT}/json/list`,{signal:AbortSignal.timeout(1500)});
      if(response.ok){let pages;try{pages=await response.json();}catch{throw fault('PORT_IN_USE','本机调试端口返回了无法识别的数据，请先检查。');}if(Array.isArray(pages)&&pages.some(p=>typeof p.url==='string'&&/^app:\/\/-\/index\.html(?:[?#]|$)/.test(p.url))){await startAgent(options);return {alreadyOpen:true,message:'客户端已经通过新版入口打开。'};}throw fault('PORT_IN_USE','本机调试端口被其他程序占用，请先检查。');}
      throw fault('PORT_IN_USE','本机调试端口已被占用，且未返回可用的客户端连接。');
    }catch(error){if(error.code==='PORT_IN_USE')throw error;}
    const appNeedle=platform==='win32'?config.app.toLowerCase():config.app+'/Contents/MacOS/';
    const running=processList().some(p=>platform==='win32'?p.executable.toLowerCase()===appNeedle:p.commandLine.startsWith(appNeedle));
    if(running)throw fault('CLIENT_RUNNING','客户端已经打开，但没有启用新版需要的本机连接。请保存工作并手动完全退出客户端，再运行“打开Codex”。本程序不会自动退出或重启工作窗口。');
    const saved=readJson(paths.configPath);
    if(saved.app!==config.app||saved.cli!==config.cli){await stopAgent();m=saveService(config,m);writeJson(paths.configPath,config);writeJson(paths.manifestPath,m);}
    await startAgent(options);
    const args=['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${DEFAULT_PORT}`];
    if(platform==='darwin')run('/usr/bin/open',['-a',config.app,'--args',...args]);
    else{const child=spawn(config.app,args,{detached:true,stdio:'ignore',windowsHide:false});child.unref();}
    return {launched:true,message:'已请求打开客户端。请等待侧栏组件连接；显示效果仍取决于客户端内部界面兼容性。'};
  }
  async function uninstall(){
    const m=manifest();checkService(m,{allowMissing:true});await stopAgent();
    if(checkService(m,{allowMissing:true}))fs.unlinkSync(paths.servicePath);
    const archive=path.join(root,'backups','uninstalled-'+Date.now());fs.mkdirSync(archive,{recursive:true,mode:0o700});
    for(const name of [...RUNTIME_FILES,'scripts']){const file=path.join(root,name);if(fs.existsSync(file))fs.renameSync(file,path.join(archive,name));}
    writeJson(paths.manifestPath,{...m,status:'uninstalled',uninstalledAt:new Date().toISOString()});
    return {uninstalled:true,dataPreserved:true,installDir:root,message:'已停用并移除本项目启动入口。会员日期、便签和快捷入口保留在安装目录的 data 中；程序文件移入 backups。不会处理旧版插件或退出客户端，已注入的显示将在客户端下次退出后消失。'};
  }
  return {install,uninstall,status,launch,startAgent,stopAgent,configuration,serviceContent,legacyActive};
}
module.exports={OWNER,VERSION,LABEL,RUNTIME_FILES,parseArgs,createManager,winQuote};
if(require.main===module)(async()=>{const {action,options}=parseArgs(process.argv.slice(2));const manager=createManager();const method={'start-agent':'startAgent','stop-agent':'stopAgent'}[action]||action;const result=await manager[method](options);console.log(result.message||JSON.stringify(result,null,2));})().catch(error=>{console.error(`${error.code||'ERROR'}: ${error.message}`);process.exitCode=1;});
