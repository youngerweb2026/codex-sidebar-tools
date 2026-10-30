'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {getPaths,discoverApp,discoverCli,openTarget,listProcesses}=require('../platform.cjs');
test('platform data and startup paths are isolated from the older add-on',()=>{
  const mac=getPaths({platform:'darwin',home:'/Users/test',env:{}});assert.equal(mac.installDir,'/Users/test/Library/Application Support/CodexSidebarTools');assert.match(mac.servicePath,/com\.buerhe\.codex-sidebar-tools\.plist$/);
  const win=getPaths({platform:'win32',home:'C:\\Users\\Test',env:{LOCALAPPDATA:'D:\\Local',APPDATA:'D:\\Roaming'}});assert.equal(win.installDir,'D:\\Local\\CodexSidebarTools');assert.match(win.servicePath,/CodexSidebarTools\.vbs$/);
});
test('Windows Store desktop discovery accepts renamed ChatGPT.exe and does not confuse it with the CLI',()=>{
  const root='C:\\Program Files\\WindowsApps\\OpenAI.Codex_test',app=path.win32.join(root,'app','ChatGPT.exe'),cli=path.win32.join(root,'app','resources','codex.exe');
  const exists=p=>[app,cli].includes(p),run=()=>JSON.stringify(root);
  assert.equal(discoverApp({platform:'win32',home:'C:\\Users\\Test',env:{},exists,run}),app);
  assert.equal(discoverCli(app,{platform:'win32',home:'C:\\Users\\Test',env:{},exists,readdir:()=>[]}),cli);
  assert.throws(()=>discoverCli(app,{platform:'win32',explicit:app,exists}),{code:'INVALID_CLI'});
});
test('Windows managed CLI is preferred over the protected Store source',()=>{
  const app='C:\\Program Files\\WindowsApps\\Codex\\app\\Codex.exe',managed='C:\\Users\\Test\\AppData\\Local\\OpenAI\\Codex\\bin\\abc\\codex.exe';
  const fallback=path.win32.join(path.win32.dirname(app),'resources','codex.exe');
  const value=discoverCli(app,{platform:'win32',home:'C:\\Users\\Test',env:{},exists:p=>[managed,fallback].includes(p),readdir:()=>[{name:'abc',isDirectory:()=>true}],stat:()=>({mtimeMs:1})});
  assert.equal(value,managed);
});
test('explicit desktop and CLI paths are retained, with no shell wrappers',()=>{
  assert.equal(discoverApp({platform:'darwin',explicit:'/Custom/Codex.app',exists:()=>true}),'/Custom/Codex.app');
  assert.equal(discoverCli('/Custom/Codex.app',{platform:'darwin',explicit:'/Custom/CLI/codex',exists:()=>true}),'/Custom/CLI/codex');
  assert.throws(()=>discoverApp({platform:'darwin',explicit:'relative.app',exists:()=>true}),{code:'INVALID_PATH'});
});
test('opening web links always chooses Chrome and passes literal arguments',async()=>{
  const calls=[],options=[],run=async(file,args,opts)=>{calls.push({file,args});options.push(opts);},url='https://example.com/?q=%24(test)';
  await openTarget('web',url,{platform:'darwin',run});assert.deepEqual(calls[0],{file:'/usr/bin/open',args:['-a','Google Chrome',url]});
  await openTarget('web',url,{platform:'win32',env:{ProgramFiles:'C:\\Program Files'},exists:p=>p==='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',run});
  assert.equal(calls[1].file,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');assert.deepEqual(calls[1].args,[url]);
  assert.equal(options[1].timeout,undefined,'Windows browser lifetime is not limited by a 10-second execFile timeout');
  await assert.rejects(openTarget('web','javascript:alert(1)',{platform:'darwin',run}),{code:'INVALID_URL'});
  await assert.rejects(openTarget('web','https://user:secret@example.com',{platform:'darwin',run}),{code:'INVALID_URL'});
  await assert.rejects(openTarget('web',url,{platform:'win32',env:{},exists:()=>false,run}),{code:'CHROME_NOT_FOUND'});
});
test('Windows folders use Explorer as a literal executable argument',async()=>{
  let actual;await openTarget('folder','C:\\资料 & 文件\\$(not-command)',{platform:'win32',env:{SystemRoot:'C:\\Windows'},run:async(file,args)=>{actual={file,args};}});
  assert.deepEqual(actual,{file:'C:\\Windows\\explorer.exe',args:['C:\\资料 & 文件\\$(not-command)']});
  await assert.rejects(openTarget('folder','/not-windows-absolute',{platform:'win32',run:async()=>{}}),{code:'INVALID_PATH'});
});
test('empty Windows process output is an empty list',()=>{
  assert.deepEqual(listProcesses({platform:'win32',run:()=>''}),[]);assert.deepEqual(listProcesses({platform:'win32',run:()=>'null'}),[]);
});
