'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync, execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const asyncRun = promisify(execFile);
const DEFAULT_PORT = 39223;
function fault(code, message) { const error = new Error(message); error.code = code; return error; }
function getPaths({platform = process.platform, home = os.homedir(), env = process.env} = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw fault('UNSUPPORTED_PLATFORM', '仅支持 macOS 和原生 Windows。');
  const p = platform === 'win32' ? path.win32 : path.posix;
  const installDir = platform === 'win32' ? p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'CodexSidebarTools') : p.join(home, 'Library', 'Application Support', 'CodexSidebarTools');
  const startupDir = platform === 'win32' ? p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
  return {installDir, configPath:p.join(installDir, 'settings.json'), manifestPath:p.join(installDir, 'install.json'),
    pidPath:p.join(installDir, 'runtime', 'agent.json'), logPath:p.join(installDir, 'runtime', 'agent.log'),
    servicePath: platform === 'win32' ? p.join(startupDir, 'CodexSidebarTools.vbs') : p.join(home, 'Library', 'LaunchAgents', 'com.buerhe.codex-sidebar-tools.plist'),
    legacyServicePath:platform === 'win32' ? p.join(startupDir, 'CodexUsageBadge.vbs') : p.join(home, 'Library', 'LaunchAgents', 'com.codexusagebadge.agent.plist')};
}
function systemRun(file, args, options = {}) { return execFileSync(file, args, {encoding:'utf8', timeout:12000, windowsHide:true, ...options}); }
function validPath(value, p, kind) {
  const fullWindowsPath=p!==path.win32||/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value||'');
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !p.isAbsolute(value) || !fullWindowsPath) throw fault('INVALID_PATH', `${kind}需要使用有效的绝对路径。`);
  return value;
}
function psJson(script, run = systemRun) {
  const value = String(run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); '+script])).replace(/^\uFEFF/, '').trim();
  if (!value) return [];
  const parsed = JSON.parse(value); return parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed];
}
function appCandidates({platform=process.platform, home=os.homedir(), env=process.env, run=systemRun}={}) {
  if (platform === 'darwin') return ['/Applications/Codex.app', '/Applications/ChatGPT.app', path.join(home,'Applications/Codex.app'), path.join(home,'Applications/ChatGPT.app')];
  if (platform !== 'win32') throw fault('UNSUPPORTED_PLATFORM', '仅支持 macOS 和原生 Windows。');
  const p=path.win32, local=env.LOCALAPPDATA || p.join(home,'AppData/Local');
  let store=[];
  try { store=psJson("Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('OpenAI.Codex','OpenAI.ChatGPT') } | Sort-Object Version -Descending | Select-Object -ExpandProperty InstallLocation | ConvertTo-Json -Compress",run).filter(x=>typeof x==='string'); } catch {}
  return [...store.flatMap(root=>['ChatGPT.exe','Codex.exe'].map(name=>p.join(root,'app',name))),
    p.join(local,'Programs','Codex','Codex.exe'), p.join(local,'Programs','ChatGPT','ChatGPT.exe'),
    p.join(local,'OpenAI','Codex','Codex.exe'),p.join(env.ProgramFiles || 'C:\\Program Files','Codex','Codex.exe')];
}
function cliCandidates(app,{platform=process.platform,home=os.homedir(),env=process.env,readdir=fs.readdirSync,stat=fs.statSync}={}) {
  if(platform==='darwin')return [path.join(app,'Contents/Resources/codex-cli/bin/codex'),path.join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),path.join(app,'Contents/Resources/codex')];
  const p=path.win32,root=p.dirname(app),local=env.LOCALAPPDATA || p.join(home,'AppData/Local'),managed=p.join(local,'OpenAI','Codex','bin');
  let versions=[];
  try{versions=readdir(managed,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>p.join(managed,entry.name,'codex.exe')).sort((a,b)=>{try{return stat(b).mtimeMs-stat(a).mtimeMs;}catch{return 0;}});}catch{}
  // Never use the desktop Codex.exe/ChatGPT.exe as app-server, even on case-insensitive filesystems.
  return [...versions,p.join(managed,'codex.exe'),p.join(root,'resources','codex.exe'),p.join(root,'resources','codex-cli','bin','codex.exe'),p.join(root,'resources','codex-cli','codex.exe')];
}
function discoverApp({platform=process.platform,home=os.homedir(),env=process.env,explicit,exists=fs.existsSync,run=systemRun}={}) {
  const p=platform==='win32'?path.win32:path.posix;
  if(explicit){validPath(explicit,p,'客户端');if(!exists(explicit))throw fault('APP_NOT_FOUND','指定的客户端路径不存在。');return explicit;}
  const app=appCandidates({platform,home,env,run}).find(candidate=>exists(candidate)&&cliCandidates(candidate,{platform,home,env}).some(exists));
  if(!app)throw fault('APP_NOT_FOUND','未找到支持的 Codex/ChatGPT 桌面客户端。请使用 --app 指定 .app 或桌面 .exe 的完整路径。');
  return app;
}
function discoverCli(app,{platform=process.platform,home=os.homedir(),env=process.env,explicit,exists=fs.existsSync,readdir=fs.readdirSync,stat=fs.statSync}={}) {
  const p=platform==='win32'?path.win32:path.posix;
  if(explicit){validPath(explicit,p,'Codex CLI');if(!exists(explicit))throw fault('CLI_NOT_FOUND','指定的 Codex CLI 路径不存在。');if(platform==='win32'&&p.normalize(explicit).toLowerCase()===p.normalize(app).toLowerCase())throw fault('INVALID_CLI','桌面客户端 exe 不能作为 Codex CLI。请选择 resources/codex.exe 或托管的 CLI。');return explicit;}
  const cli=cliCandidates(app,{platform,home,env,readdir,stat}).find(exists);
  if(!cli)throw fault('CLI_NOT_FOUND','找不到客户端内置 Codex CLI，请使用 --codex-bin 指定 CLI 的完整路径。');
  return cli;
}
function chromeCandidates(env=process.env,home=os.homedir()) {
  const p=path.win32;return [p.join(env.ProgramFiles||'C:\\Program Files','Google/Chrome/Application/chrome.exe'),p.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Google/Chrome/Application/chrome.exe'),p.join(env.LOCALAPPDATA||p.join(home,'AppData/Local'),'Google/Chrome/Application/chrome.exe')];
}
function launchDetached(file,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{...options,detached:true,stdio:'ignore'});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({started:true});});
  });
}
async function openTarget(kind,target,{platform=process.platform,env=process.env,home=os.homedir(),run,exists=fs.existsSync}={}) {
  if(typeof target!=='string'||/[\x00-\x1f\x7f]/.test(target))throw fault('INVALID_TARGET','入口目标格式不正确。');
  let normalized=target;
  if(kind==='web'){
    let u;try{u=new URL(target);}catch{throw fault('INVALID_URL','请输入完整的 http 或 https 网址。');}
    if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password)throw fault('INVALID_URL','仅支持不含用户名和密码的 http 或 https 网址。');
    normalized=u.href;
  }else if(kind==='folder')validPath(target,platform==='win32'?path.win32:path.posix,'文件夹');
  else throw fault('INVALID_TARGET','不支持的入口类型。');
  if(platform==='darwin')return (run||asyncRun)('/usr/bin/open',kind==='web'?['-a','Google Chrome',normalized]:[normalized],{timeout:10000,maxBuffer:16384,windowsHide:true});
  if(platform!=='win32')throw fault('UNSUPPORTED_PLATFORM','仅支持 macOS 和原生 Windows。');
  if(kind==='folder')return (run||launchDetached)(path.win32.join(env.SystemRoot||'C:\\Windows','explorer.exe'),[normalized],{windowsHide:true});
  const chrome=chromeCandidates(env,home).find(exists);
  if(!chrome)throw fault('CHROME_NOT_FOUND','未找到 Google Chrome，请先安装 Chrome。');
  return (run||launchDetached)(chrome,[normalized],{windowsHide:true});
}
function listProcesses({platform=process.platform,run=systemRun}={}) {
  if(platform==='win32')return psJson("Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",run).map(x=>({pid:Number(x.ProcessId),executable:x.ExecutablePath||'',commandLine:x.CommandLine||''}));
  return String(run('/bin/ps',['-Ao','pid=,command='])).split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(.+)$/.exec(line);return m?[{pid:Number(m[1]),executable:'',commandLine:m[2]}]:[];});
}
module.exports={DEFAULT_PORT,getPaths,discoverApp,discoverCli,openTarget,appCandidates,cliCandidates,listProcesses,systemRun,fault};
