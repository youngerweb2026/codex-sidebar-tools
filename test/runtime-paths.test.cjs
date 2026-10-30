'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createRuntimeLocator}=require('../platform.cjs');

test('macOS runtime lookup is lazy and recovers after the selected app is replaced',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-runtime-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const app=path.join(root,'Custom Codex.app'),old=path.join(app,'Contents/Resources/codex-cli/bin/codex');
  const locate=createRuntimeLocator({app,cli:old,platform:'darwin'});
  assert.throws(locate,{code:'APP_NOT_FOUND'});
  fs.mkdirSync(path.dirname(old),{recursive:true});fs.writeFileSync(old,'old');
  assert.deepEqual(locate(),{app,cli:old});
  fs.rmSync(app,{recursive:true});assert.throws(locate,{code:'APP_NOT_FOUND'});
  const replacement=path.join(app,'Contents/Resources/codex');fs.mkdirSync(path.dirname(replacement),{recursive:true});fs.writeFileSync(replacement,'new');
  assert.deepEqual(locate(),{app,cli:replacement});
});
test('bundled settings are re-enumerated even if the old alternate CLI still exists',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sidebar-runtime-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const app=path.join(root,'Codex.app'),old=path.join(app,'Contents/Resources/codex');
  fs.mkdirSync(path.dirname(old),{recursive:true});fs.writeFileSync(old,'old');
  const locate=createRuntimeLocator({app,cli:old,platform:'darwin'});
  assert.equal(locate().cli,old);
  const current=path.join(app,'Contents/Resources/codex-cli/bin/codex');fs.mkdirSync(path.dirname(current),{recursive:true});fs.writeFileSync(current,'new');
  assert.equal(locate().cli,current);
});
test('an explicit external CLI and custom app remain selected through update gaps',()=>{
  const app='/Custom/Codex.app',external='/Custom CLI/codex',bundled=app+'/Contents/Resources/codex';
  const present=new Set([app,external,bundled]);
  const locate=createRuntimeLocator({app,cli:external,platform:'darwin',exists:value=>present.has(value)});
  assert.deepEqual(locate(),{app,cli:external});
  present.delete(external);assert.throws(locate,{code:'CLI_NOT_FOUND'});
  present.add(external);present.delete(app);assert.throws(locate,{code:'APP_NOT_FOUND'});
  present.add(app);assert.deepEqual(locate(),{app,cli:external});
});
test('Windows Store reconnect follows the current registered package, not retained old files',()=>{
  const p=path.win32,home='C:\\Users\\Test';
  const root1='C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64__test',root2='C:\\Program Files\\WindowsApps\\OpenAI.Codex_2_x64__test';
  const app1=p.join(root1,'app','ChatGPT.exe'),app2=p.join(root2,'app','ChatGPT.exe');
  const cli1=p.join(root1,'app','resources','codex.exe'),cli2=p.join(root2,'app','resources','codex.exe');
  let registered=root1,calls=0;
  const locate=createRuntimeLocator({app:app1,cli:cli1,platform:'win32',home,env:{},run:()=>{calls++;return JSON.stringify(registered);},exists:value=>[app1,app2,cli1,cli2].includes(value),readdir:()=>[]});
  assert.equal(calls,0);assert.deepEqual(locate(),{app:app1,cli:cli1});
  registered=root2;assert.deepEqual(locate(),{app:app2,cli:cli2});assert.equal(calls,2);
});
test('Windows managed CLI hint follows newest runtime and waits through package gaps',()=>{
  const p=path.win32,home='C:\\Users\\Test',root='C:\\Program Files\\WindowsApps\\OpenAI.Codex_2_x64__test';
  const app=p.join(root,'app','Codex.exe'),managed=p.join(home,'AppData','Local','OpenAI','Codex','bin');
  const old=p.join(managed,'old','codex.exe'),current=p.join(managed,'new','codex.exe');
  let registered=root;
  const locate=createRuntimeLocator({app,cli:old,platform:'win32',home,env:{},run:()=>JSON.stringify(registered),exists:value=>[app,old,current].includes(value),readdir:()=>['old','new'].map(name=>({name,isDirectory:()=>true})),stat:value=>({mtimeMs:value===current?2:1})});
  assert.deepEqual(locate(),{app,cli:current});
  registered=null;assert.throws(locate,{code:'APP_NOT_FOUND'});
  registered=root;assert.deepEqual(locate(),{app,cli:current});
});
test('Windows fixed custom desktop with external CLI is not replaced by auto discovery',()=>{
  const app='D:\\Portable Codex\\Codex.exe',cli='D:\\Separate CLI\\codex.exe';
  const locate=createRuntimeLocator({app,cli,platform:'win32',exists:()=>true,run:()=>{throw Error('Store discovery must not run');}});
  assert.deepEqual(locate(),{app,cli});
});
test('case differences do not pin Windows bundled CLI or accept the desktop exe as CLI',()=>{
  const app='D:\\Portable\\Codex.exe',cli='d:\\portable\\resources\\codex.exe';
  const locate=createRuntimeLocator({app,cli,platform:'win32',home:'C:\\Users\\Test',env:{},exists:()=>true,readdir:()=>[]});
  assert.notEqual(locate().cli,cli);
  assert.throws(createRuntimeLocator({app,cli:app.toLowerCase(),platform:'win32',exists:()=>true}),{code:'INVALID_CLI'});
  for(const extension of ['.cmd','.bat'])assert.throws(createRuntimeLocator({app,cli:'D:\\CLI\\codex'+extension,platform:'win32',exists:()=>true}),{code:'INVALID_CLI'});
});
