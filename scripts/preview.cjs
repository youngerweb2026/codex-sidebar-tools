'use strict';
// Isolated UI acceptance page. Test edits never touch the installed sidebar data.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const {installUsageBadge} = require('../agent.cjs');
const {buildToolsScript} = require('../tools-ui.cjs');
const {createToolsStore} = require('../tools-store.cjs');
const previewDir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'codex-sidebar-preview-'));
const store = createToolsStore({filePath:path.join(previewDir,'state.json')});
const port = Number(process.env.SIDEBAR_PREVIEW_PORT || 43178);
function html() {
  const state=store.getState();
  const quota={percent:83,windowLabel:'周',tone:'normal',mode:'single',rings:null,stale:false,updatedAt:Date.now(),resetsAt:Math.floor(Date.now()/1000)+2*86400+3*3600,title:'当前显示：1周额度，剩余83%\n1周：剩余 83%，11/1 12:00 重置'};
  return `<!doctype html><html lang="zh-CN" class="light"><meta charset="utf-8"><title>Codex Sidebar Tools · 本地预览</title>
  <style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#303630;background:#fff}nav[data-app-navigation-rail]{position:fixed;left:0;top:0;bottom:0;width:54px;background:#e9e9e9;display:flex;flex-direction:column;align-items:center;padding:14px 0 10px;gap:8px}nav .top{font-size:19px}nav .space{flex:1}nav .profile{background:#ffe000;color:#151515;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-size:8px;font-weight:800;margin-top:6px}.projects{position:fixed;left:54px;top:0;bottom:0;width:240px;background:#f7f7f7;border-right:1px solid #ddd;padding:24px 16px}.projects div{margin:0 0 22px}.projects .muted{color:#999;font-size:13px;margin-top:26px}main{margin-left:294px;padding:42px;color:#5c656b}h1{font-size:22px;font-weight:600;color:#25313a}main p{font-size:14px;line-height:1.9;max-width:600px}main button{padding:8px 12px;border:1px solid #ccc;border-radius:7px;background:#fff;color:#333;cursor:pointer}.dark body{background:#242624;color:#eee}.dark nav[data-app-navigation-rail]{background:#252725}.dark .projects{background:#2c2e2c;border-color:#555}.dark main{color:#ccc}.dark h1{color:#eee}</style>
  <nav data-app-navigation-rail><div class="top">◎</div><div class="space"></div><div class="profile">CST</div></nav>
  <aside class="projects"><div>▱ 示例项目 A</div><div>▱ 示例项目 B</div><div class="muted">工作项目</div><div>▱ 分镜练习</div><div>▱ 使用示例</div><div>▱ 产品项目</div><div class="muted">内容创作</div><div class="muted">资料研究</div><div class="muted">视觉创作</div></aside>
  <main><h1>Codex Sidebar Tools · 本地预览</h1><p>左侧使用与插件相同的界面代码。这里的额度为示例数据；会员日期、便签和入口的测试改动仅保存在独立验证文件中。</p><p>点击会员天数可设置到期日；“入口”管理文件夹与网页；“便签”自动保存在本机。</p><button id="theme">切换浅色／深色</button> <button id="low">模拟额度偏低</button><p id="opened"></p></main>
  <script>
  window.__codexSidebarToolsRequest=raw=>fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:raw}).then(r=>r.json()).then(reply=>{window.__codexSidebarToolsReceive?.(reply);if(reply.opened)document.getElementById('opened').textContent='已验证打开入口请求：'+reply.label;});
  (${installUsageBadge.toString()})();window.__codexSidebarQuota.update(${JSON.stringify(quota)});
  ${buildToolsScript(state)};
  setInterval(()=>{window.__codexSidebarQuota.update({updatedAt:Date.now()});fetch('/state').then(r=>r.json()).then(s=>window.__codexSidebarToolsV1?.sync(s));},5000);
  document.getElementById('theme').onclick=()=>{const d=document.documentElement.classList.toggle('dark');document.documentElement.classList.toggle('light',!d);};
  document.getElementById('low').onclick=()=>window.__codexSidebarQuota.update({percent:8,tone:'danger',title:'当前显示：1周额度，剩余8%'});
  </script></html>`;
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html());return;}
  if(req.method==='GET'&&req.url==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(store.getState()));return;}
  if(req.method==='POST'&&req.url==='/rpc'){
    if(req.headers.origin!==`http://127.0.0.1:${port}`){res.writeHead(403);res.end();return;}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000){res.writeHead(413);res.end();return;}}
    let request;try{request=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}
    let reply;try{
      let result;
      if(request.method==='openShortcut'){
        const state=store.getState(),item=state.shortcuts.find(s=>s.id===request.params?.id);
        if(!item)throw Error('入口不存在');result={state,opened:true,label:item.label};
      }else result=await store.dispatch(request.method,request.params);
      reply={id:request.id,ok:true,...result};
    }catch(error){reply={id:request.id,ok:false,code:error.code||'ERROR',message:error.message,...(error.state?{state:error.state}:{})};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));return;
  }
  res.writeHead(404);res.end();
});
server.listen(port,'127.0.0.1',()=>console.log(`Sidebar acceptance preview: http://127.0.0.1:${port}`));

for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();fs.rmSync(previewDir,{recursive:true,force:true});process.exit(0);});
