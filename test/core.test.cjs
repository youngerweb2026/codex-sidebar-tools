'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {membershipStatus,resetCountdown,buildToolsScript}=require('../tools-ui.cjs');
const {formatRateLimits,CdpSession}=require('../agent.cjs');
test('membership uses Shanghai calendar dates, including the expiry day',()=>{
  assert.equal(membershipStatus('2031-03-15',Date.parse('2031-03-04T03:00:00Z')).days,11);
  assert.equal(membershipStatus('2031-03-15',Date.parse('2031-03-14T15:59:59Z')).days,1);
  assert.equal(membershipStatus('2031-03-15',Date.parse('2031-03-14T16:00:00Z')).text,'今日到期');
  assert.equal(membershipStatus('2031-03-15',Date.parse('2031-03-15T16:00:00Z')).text,'已到期');
  assert.equal(membershipStatus('2031-03-15',Date.parse('2031-03-12T03:00:00Z')).tone,'warning');
  assert.equal(membershipStatus('2026-02-30'),null);
  assert.equal(membershipStatus('2026-13-31'),null);
});
test('quota countdown distinguishes missing, stale, imminent and passed resets',()=>{
  const now=Date.parse('2031-03-04T03:00:00Z'),seconds=now/1000;
  assert.equal(resetCountdown(null,now).text,'—');
  assert.equal(resetCountdown(seconds+86400,now,true).text,'—');
  assert.equal(resetCountdown(seconds+86400*2+3600,now).text,'2天');
  assert.equal(resetCountdown(seconds+7200,now).text,'2小时');
  assert.equal(resetCountdown(seconds+180,now).text,'3分钟');
  assert.equal(resetCountdown(seconds+30,now).text,'<1分钟');
  assert.equal(resetCountdown(seconds-1,now).text,'待刷新');
});
test('reset metadata follows the same account window as the existing quota ring',()=>{
  const response={rateLimits:{planType:'prolite',primary:{usedPercent:2,windowDurationMins:300,resetsAt:100},secondary:{usedPercent:17,windowDurationMins:10080,resetsAt:200}}};
  const pro=formatRateLimits(response);assert.equal(pro.percent,83);assert.equal(pro.resetsAt,200);
  response.rateLimits.planType='plus';const plus=formatRateLimits(response);assert.equal(plus.mode,'dual');assert.equal(plus.resetsAt,100);assert.equal(plus.windows.length,2);
});
test('tools bootstrap serializes user text as data and has valid syntax',()=>{
  const state={revision:0,membership:{expiresOn:'2031-03-15'},shortcuts:[],notes:'` ${alert(1)} </script>'};
  assert.doesNotThrow(()=>new Function(buildToolsScript(state)));
  assert.equal(buildToolsScript(state).includes('</script>'),false);
});
test('the tools bridge rejects other execution contexts and returns persistence errors',async()=>{
  let calls=0, broadcasts=0;const responses=[];
  const session=new CdpSession({}, {dispatch:async(method)=>{calls++;if(method==='saveNotes'){const e=Error('冲突');e.code='CONFLICT';e.state={revision:2};throw e;}return {state:{revision:1}};}},()=>broadcasts++);
  session.toolsContext=7;session.request=async(method,params)=>{responses.push({method,params});};
  await session.handleToolsRequest({executionContextId:8,payload:JSON.stringify({id:'1',method:'getState',params:{}})});assert.equal(calls,0);
  await session.handleToolsRequest({executionContextId:7,payload:JSON.stringify({id:'2',method:'getState',params:{}})});assert.equal(calls,1);assert.equal(broadcasts,1);assert.equal(responses[0].params.contextId,7);
  await session.handleToolsRequest({executionContextId:7,payload:JSON.stringify({id:'3',method:'saveNotes',params:{}})});assert.match(responses[1].params.expression,/CONFLICT/);assert.equal(broadcasts,2);
});
