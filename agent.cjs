// Derived from Codex Usage Card. MIT License. See LICENSE and NOTICE.md.
"use strict";
// Formatting is independent of platform and account storage.
function remainingPercent(used) { return Math.max(0, Math.min(100, Math.round(100 - used))); }
function validWindow(value) { return value != null && Number.isFinite(value.usedPercent); }
function isCodexLimit(value) { return value?.limitId == null || value.limitId === 'codex'; }
function formatResetTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false}).format(date);
}
function durationLabel(minutes) {
  for (const [unit, label] of [[10080,'周'],[1440,'天'],[60,'小时']]) {
    if (Number.isFinite(minutes) && minutes > 0 && minutes % unit === 0) return `${minutes / unit}${label}`;
  }
  return Number.isFinite(minutes) && minutes > 0 ? `${minutes}分钟` : '额度';
}
function formatResetCredits(response) {
  const credits = response?.rateLimitResetCredits;
  if (!credits || typeof credits !== 'object') return [];
  const available = Array.isArray(credits.credits) ? credits.credits.filter(c => c?.status === 'available' && c?.resetType === 'codexRateLimits') : [];
  const count = Number.isFinite(Number(credits.availableCount)) ? Math.max(0, Math.floor(Number(credits.availableCount))) : available.length;
  const expiry = formatResetTime(available.map(c=>c.expiresAt).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b)[0]);
  return [`重置卡：${count} 张可用`, ...(count && expiry ? [`最近到期：${expiry}`] : [])];
}
function formatPrimaryRateLimits(response) {
  const snapshot = pickCodexSnapshot(response);
  const windows = [snapshot?.primary, snapshot?.secondary].filter(validWindow);
  const weekly = w => Number.isFinite(w.windowDurationMins) && w.windowDurationMins >= 10080 && w.windowDurationMins % 10080 === 0;
  const plan = String(snapshot?.planType ?? response?.planType ?? '').toLowerCase();
  const window = plan.startsWith('pro') ? windows.find(weekly) : windows.find(w=>w.windowDurationMins === 300) ?? (!plan ? windows.find(weekly) : null);
  const details = windows.map(w=>`${durationLabel(w.windowDurationMins)}：剩余 ${remainingPercent(w.usedPercent)}%${formatResetTime(w.resetsAt) ? `，${formatResetTime(w.resetsAt)} 重置` : ''}`);
  const percent = window ? remainingPercent(window.usedPercent) : null;
  return {percent, windowLabel: window && weekly(window) ? '周' : '', tone:quotaTone(percent),
    resetsAt: Number.isFinite(window?.resetsAt) ? window.resetsAt : null,
    windows: windows.map(w => ({windowDurationMins:w.windowDurationMins, usedPercent:w.usedPercent, resetsAt:w.resetsAt})),
    title:[window ? `当前显示：${durationLabel(window.windowDurationMins)}额度，剩余${percent}%` : '暂时无法读取 Codex 剩余用量',...details,...formatResetCredits(response)].join('\n')};
}

const hasField = (value, key) => value != null && Object.hasOwn(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function mergeWindow(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  const sameWindow = current && (!Number.isFinite(patch.windowDurationMins) || current.windowDurationMins === patch.windowDurationMins);
  return sameWindow ? { ...current, ...patch } : { ...patch };
}
function mergeRateLimitSnapshot(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  if (current?.planType && patch.planType && current.planType !== patch.planType) current = null;
  return { ...current, ...patch,
    primary: mergeWindow(current?.primary, patch.primary),
    secondary: mergeWindow(current?.secondary, patch.secondary) };
}
function mergeRateLimitsResponse(current, patch) {
  if (patch === undefined) return current ?? null;
  if (!isRecord(patch)) return null;
  // A refresh is a complete snapshot (caller passes null); notifications are deltas.
  // Never carry windows or credits across account changes.
  const changedAccount = hasField(patch, 'accountId') && hasField(current, 'accountId') && patch.accountId !== current.accountId;
  const base = changedAccount ? {} : current ?? {};
  const merged = { ...base, ...patch };
  merged.rateLimits = base.rateLimits ?? null;
  if (hasField(patch, 'rateLimits') && isCodexLimit(patch.rateLimits)) {
    merged.rateLimits = mergeRateLimitSnapshot(base.rateLimits, patch.rateLimits);
    if (isRecord(base.rateLimitsByLimitId)) merged.rateLimitsByLimitId = { ...base.rateLimitsByLimitId, codex: merged.rateLimits };
  }
  if (hasField(patch, 'rateLimitsByLimitId')) {
    if (!isRecord(patch.rateLimitsByLimitId)) {
      merged.rateLimitsByLimitId = null;
      if (!hasField(patch, 'rateLimits')) merged.rateLimits = null;
    }
    else {
      merged.rateLimitsByLimitId = { ...base.rateLimitsByLimitId, ...merged.rateLimitsByLimitId };
      for (const [id, snapshot] of Object.entries(patch.rateLimitsByLimitId)) {
        // The keyed Codex bucket is authoritative when both formats are returned.
        const previous = base.rateLimitsByLimitId?.[id] ?? (id === 'codex' ? base.rateLimits : null);
        Object.defineProperty(merged.rateLimitsByLimitId, id, {value:mergeRateLimitSnapshot(previous, snapshot),enumerable:true,configurable:true,writable:true});
      }
      if (hasField(patch.rateLimitsByLimitId, 'codex')) merged.rateLimits = merged.rateLimitsByLimitId.codex;
    }
  }
  return merged;
}
function pickCodexSnapshot(response) {
  if (!isRecord(response)) return null;
  if (hasField(response.rateLimitsByLimitId, 'codex')) {
    const keyed = response.rateLimitsByLimitId.codex;
    return isRecord(keyed) && isCodexLimit(keyed) ? keyed : null;
  }
  if (hasField(response, 'rateLimits')) return isRecord(response.rateLimits) && isCodexLimit(response.rateLimits) ? response.rateLimits : null;
  return isCodexLimit(response) ? response : null;
}

function quotaTone(percent) {
  return !Number.isFinite(percent) ? 'muted' : percent < 10 ? 'danger' : percent <= 50 ? 'warning' : 'normal';
}
function unavailableValue(current, title = '暂时无法读取 Codex 用量，正在自动重试') {
  return { ...current, percent: null, title, tone: 'muted', stale: true,
    rings: current?.rings?.map(ring => ({ ...ring, percent: null, tone: 'muted', title: `${ring.label}：暂不可用` })) ?? null };
}
function formatRateLimits(response) {
  const single = formatPrimaryRateLimits(response);
  single.tone = quotaTone(single.percent);
  const snapshot = pickCodexSnapshot(response);
  const planType = String(snapshot?.planType ?? response?.planType ?? '').toLowerCase();
  if (planType !== 'plus') return { ...single, mode: 'single', rings: null };
  const windows = [snapshot?.primary, snapshot?.secondary].filter(Boolean);
  function ring(key, label, match) {
    const window = windows.find(match);
    const percent = validWindow(window) ? remainingPercent(window.usedPercent) : null;
    const reset = formatResetTime(window?.resetsAt);
    const tone = quotaTone(percent);
    return { key, label, percent, tone,
      title: `${label}：${percent === null ? '暂不可用' : `剩余 ${percent}%`}${reset ? `，${reset} 重置` : ''}` };
  }
  const rings = [
    ring('five-hour', '5h额度', w => w.windowDurationMins === 300),
    ring('weekly', '周额度', w => Number.isFinite(w.windowDurationMins) && w.windowDurationMins >= 10080 && w.windowDurationMins % 10080 === 0)
  ];
  return { ...single, mode: 'dual', rings,
    title: ['Plus 剩余额度', ...rings.map(r => r.title), ...formatResetCredits(response)].join('\n') };
}

class AppServerClient extends require('node:events').EventEmitter {
  constructor({command='codex', args=['app-server'], requestTimeoutMs=10000}={}) {
    super(); Object.assign(this,{command,args,requestTimeoutMs});
    this.child=null; this.lines=null; this.pending=new Map(); this.serial=0; this.rateLimits=null;
  }
  async start() {
    if (this.child) return;
    const child=require('node:child_process').spawn(this.command,this.args,{stdio:['pipe','pipe','pipe'],windowsHide: true,env:process.env});
    this.child=child;
    const fail=error=>{
      if (this.child!==child) return;
      this.stop(); this.emit('server-exit',error);
    };
    child.once('error',fail);
    child.once('exit',(code)=>fail(new Error(`App Server exited (${code})`)));
    child.stdin.on('error',fail);
    child.stderr.resume(); // Drain without recording account/server details.
    this.lines=require('node:readline').createInterface({input:child.stdout});
    this.lines.on('line',line=>{
      let message; try { message=JSON.parse(line); } catch { return; }
      if (!message || typeof message!=='object') return;
      const request=this.pending.get(message.id);
      if (request) {
        this.pending.delete(message.id); clearTimeout(request.timer);
        message.error ? request.reject(new Error(message.error.message || 'App Server request failed')) : request.resolve(message.result);
      } else if(message.method==='account/rateLimits/updated') {
        this.rateLimits=mergeRateLimitsResponse(this.rateLimits,message.params);
        this.emit('rate-limits',this.rateLimits);
      }
    });
    await this.request('initialize',{clientInfo:{name:'codex_usage_badge',title:'Codex Usage Badge',version:AGENT_VERSION}});
    this.child?.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    await this.refresh();
  }
  request(method,params) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error('App Server is not running'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timed out`));},this.requestTimeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,...(params===undefined?{}:{params})})+'\n',error=>{
        if(error && this.pending.delete(id)){clearTimeout(timer);reject(error);}
      });
    });
  }
  async refresh() {
    this.rateLimits=mergeRateLimitsResponse(null,await this.request('account/rateLimits/read'));
    this.emit('rate-limits',this.rateLimits); return this.rateLimits;
  }
  stop() {
    const child=this.child; this.child=null;
    this.lines?.close(); this.lines=null;
    if(child && !child.killed) child.kill();
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('App Server stopped'));}
    this.pending.clear();
  }
}

function installUsageBadge() {
  const VERSION = 1;
  const KEY = '__codexSidebarQuota';
  if (window[KEY]?.version === VERSION) {
    window[KEY].place();
    return;
  }
  window[KEY]?.destroy?.();
  const badge = document.createElement('div');
  badge.id = 'codex-sidebar-quota';
  badge.setAttribute('role', 'meter');
  badge.setAttribute('aria-valuemin', '0');
  badge.setAttribute('aria-valuemax', '100');
  function meterMarkup(suffix = '') {
    return `<svg class="usage-ring" viewBox="0 0 36 36" aria-hidden="true">
    <defs><linearGradient id="codex-usage-ring-gradient${suffix}" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop class="usage-gradient-start" offset="0%"/><stop class="usage-gradient-end" offset="100%"/>
    </linearGradient></defs>
    <circle class="usage-ring-track" cx="18" cy="18" r="14"/>
    <circle class="usage-ring-value" cx="18" cy="18" r="14" pathLength="100"/>
  </svg><span class="usage-number">—</span><span class="usage-window"></span>`;
  }
  const primaryMeter = document.createElement('div');
  primaryMeter.className = 'usage-primary';
  primaryMeter.tabIndex = 0;
  primaryMeter.setAttribute('aria-describedby', 'codex-sidebar-quota-tooltip');
  primaryMeter.innerHTML = meterMarkup();
  const secondaryMeter = document.createElement('div');
  secondaryMeter.className = 'usage-secondary';
  secondaryMeter.tabIndex = 0;
  secondaryMeter.setAttribute('aria-describedby', 'codex-sidebar-quota-tooltip');
  secondaryMeter.innerHTML = meterMarkup('-weekly');
  secondaryMeter.hidden = true;
  badge.append(primaryMeter, secondaryMeter);
  const tooltip = document.createElement('div');
  tooltip.id = 'codex-sidebar-quota-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const style = document.createElement('style');
  style.id = 'codex-sidebar-quota-style';
  const darkPalette = `
      --usage-normal-color: #12f594; --usage-normal-soft: #25d887; --usage-normal-track: #1c6349; --usage-normal-glow: #0be38c1a;
      --usage-warning-color: #ffd279; --usage-warning-soft: #e8aa4c; --usage-warning-track: #69522e; --usage-warning-glow: #ffb53c16;
      --usage-danger-color: #ff9587; --usage-danger-soft: #e76964; --usage-danger-track: #683e3b; --usage-danger-glow: #ff746516;
      --usage-muted-color: #9caaa2; --usage-muted-soft: #7b8981; --usage-muted-track: #505853; --usage-muted-glow: transparent;
      --usage-text: #f5f7f5; --usage-label: #b6bbb7;
      --usage-border: #ffffff0f; --usage-border-hover: #ffffff29;
      --usage-shadow: 0 1px 2px -1px #00000008;
  `;
  style.textContent = `
    #codex-sidebar-quota {
      --usage-normal-color: #0b805b; --usage-normal-soft: #168e65; --usage-normal-track: #d7e7df; --usage-normal-glow: #168e6508;
      --usage-warning-color: #9e6c14; --usage-warning-soft: #b8811c; --usage-warning-track: #efe5cf; --usage-warning-glow: #b8811c08;
      --usage-danger-color: #bc4744; --usage-danger-soft: #d45d56; --usage-danger-track: #f1ddda; --usage-danger-glow: #d45d5608;
      --usage-muted-color: #77858e; --usage-muted-soft: #8c979f; --usage-muted-track: #e0e5e8; --usage-muted-glow: transparent;
      --usage-text: #25313a; --usage-label: #65737c;
      --usage-border: #5264741a; --usage-border-hover: #52647440;
      --usage-shadow: 0 1px 2px -1px #00000005;
      --usage-color: var(--usage-normal-color); --usage-soft: var(--usage-normal-soft);
      --usage-ring-track: var(--usage-normal-track); --usage-glow: var(--usage-normal-glow);
      --usage-width: 34px; --usage-ring-size: 27px;
      position: relative; box-sizing: border-box; width: var(--usage-width); height: 67px; flex: 0 0 67px;
      align-self: center; margin: 0 0 2px; padding: 7px 2px 5px;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 7px;
      border: 1px solid var(--usage-border); border-radius: 10px; outline: none; color: var(--usage-text);
      background-color: inherit; background-image: none;
      box-shadow: var(--usage-shadow);
      cursor: default; user-select: none;
      -webkit-app-region: no-drag; font-family: inherit;
      font-variant-numeric: tabular-nums; line-height: 1;
    }
    #codex-sidebar-quota[hidden], #codex-sidebar-quota-tooltip[hidden] { display: none !important; }
    #codex-sidebar-quota .usage-primary, #codex-sidebar-quota .usage-secondary {
      position: relative; box-sizing: border-box; width: 100%; flex: 0 0 53px;
      display: flex; flex-direction: column; align-items: center; padding: 29.5px 0 0; gap: 0.5px;
    }
    #codex-sidebar-quota .usage-secondary[hidden] { display: none !important; }
    #codex-sidebar-quota[data-mode="dual"] { height: 133px; flex-basis: 133px; }
    #codex-sidebar-quota .usage-secondary {
      --usage-color: var(--usage-normal-color); --usage-soft: var(--usage-normal-soft);
      --usage-ring-track: var(--usage-normal-track); --usage-glow: var(--usage-normal-glow);
    }
    #codex-sidebar-quota:hover { border-color: var(--usage-border-hover); }
    #codex-sidebar-quota:focus-visible { outline: 1px solid var(--usage-color); outline-offset: 2px; }
    #codex-sidebar-quota .usage-ring {
      display: block; position: absolute;
      width: var(--usage-ring-size); height: var(--usage-ring-size);
      top: 0;
      left: 50%; transform: translateX(-50%); overflow: visible;
    }
    #codex-sidebar-quota .usage-ring circle { fill: none; stroke-width: 4.4; }
    #codex-sidebar-quota .usage-ring circle.usage-ring-value { stroke-width: 4.8; }
    #codex-sidebar-quota .usage-ring-track { stroke: var(--usage-ring-track); }
    #codex-sidebar-quota .usage-gradient-start { stop-color: var(--usage-soft); }
    #codex-sidebar-quota .usage-gradient-end { stop-color: var(--usage-color); }
    #codex-sidebar-quota .usage-ring-value {
      stroke: url(#codex-usage-ring-gradient); stroke-linecap: round;
      transform: rotate(-90deg); transform-origin: 18px 18px;
      stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0;
      filter: none;
      transition: stroke-dashoffset 240ms ease;
    }
    #codex-sidebar-quota .usage-secondary .usage-ring-value { stroke: url(#codex-usage-ring-gradient-weekly); }
    #codex-sidebar-quota .usage-number { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: -.3px; white-space: nowrap; }
    #codex-sidebar-quota .usage-window { font-size: 7.5px; line-height: 9px; font-weight: 400; color: var(--usage-label); white-space: nowrap; }
    #codex-sidebar-quota[data-tone="warning"], #codex-sidebar-quota .usage-secondary[data-tone="warning"] { --usage-color: var(--usage-warning-color); --usage-soft: var(--usage-warning-soft); --usage-ring-track: var(--usage-warning-track); --usage-glow: var(--usage-warning-glow); }
    #codex-sidebar-quota[data-tone="danger"], #codex-sidebar-quota .usage-secondary[data-tone="danger"] { --usage-color: var(--usage-danger-color); --usage-soft: var(--usage-danger-soft); --usage-ring-track: var(--usage-danger-track); --usage-glow: var(--usage-danger-glow); }
    #codex-sidebar-quota[data-tone="muted"], #codex-sidebar-quota .usage-secondary[data-tone="muted"] { --usage-color: var(--usage-muted-color); --usage-soft: var(--usage-muted-soft); --usage-ring-track: var(--usage-muted-track); --usage-glow: var(--usage-muted-glow); }
    html.dark #codex-sidebar-quota, html[data-theme="dark"] #codex-sidebar-quota { ${darkPalette} }
    @media (prefers-color-scheme: dark) {
      html:not(.light):not([data-theme="light"]) #codex-sidebar-quota { ${darkPalette} }
    }
    #codex-sidebar-quota-tooltip {
      box-sizing: border-box; position: fixed; z-index: 2147483000;
      width: 300px; max-width: calc(100vw - 16px); padding: 12px 14px;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 10px;
      background: var(--color-surface-elevated-secondary, #f8f8f7);
      color: var(--color-text-primary, #303630);
      box-shadow: 0 4px 18px #0002; pointer-events: none;
      font: 12px/1.65 -apple-system, BlinkMacSystemFont, sans-serif;
      white-space: normal; overflow-wrap: anywhere; -webkit-app-region: no-drag;
    }
    #codex-sidebar-quota-tooltip .usage-tooltip-title { font-weight: 600; white-space: pre-line; }
    #codex-sidebar-quota-tooltip .usage-tooltip-sections { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 12px; }
    #codex-sidebar-quota-tooltip[data-mode="dual"] .usage-tooltip-sections { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    #codex-sidebar-quota-tooltip .usage-tooltip-section { min-width: 0; }
    #codex-sidebar-quota-tooltip .usage-tooltip-label { color: color-mix(in srgb, currentColor 75%, transparent); font-size: 11px; line-height: 16px; font-weight: 500; }
    #codex-sidebar-quota-tooltip .usage-tooltip-percent { margin: 4px 0; color: color-mix(in srgb, currentColor 60%, transparent); font-size: 24px; line-height: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
    #codex-sidebar-quota-tooltip .usage-tooltip-reset, #codex-sidebar-quota-tooltip .usage-tooltip-status { color: color-mix(in srgb, currentColor 65%, transparent); font-size: 11px; line-height: 1.5; white-space: pre-line; }
    #codex-sidebar-quota-tooltip .usage-tooltip-metadata { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; padding-top: 10px; border-top: 1px solid color-mix(in srgb, currentColor 8%, transparent); color: color-mix(in srgb, currentColor 65%, transparent); font-size: 11px; white-space: pre-line; }
    html.dark #codex-sidebar-quota-tooltip, html[data-theme="dark"] #codex-sidebar-quota-tooltip {
      background: var(--color-surface-elevated-secondary, #2c2e2c);
      color: var(--color-text-primary, #edf0ed);
    }
    @media (prefers-color-scheme: dark) {
      html:not(.light):not([data-theme="light"]) #codex-sidebar-quota-tooltip {
        background: var(--color-surface-elevated-secondary, #2c2e2c); color: var(--color-text-primary, #edf0ed);
      }
    }
    @media (prefers-reduced-motion: reduce) { #codex-sidebar-quota .usage-ring-value { transition: none; } }
  `;
  let value = { percent: null, title: '正在读取 Codex 剩余用量', tone: 'muted', windowLabel: '', mode: 'single', rings: null };
  let placementTimer = null;
  let hoverTimer = null;
  let tooltipTarget = null;
  let rail = null;
  let disposed = false;
  // A dead agent must not leave a healthy-looking quota indefinitely.
  function expireValue() {
    if (disposed || value.stale || !Number.isFinite(value.updatedAt) || Date.now() - value.updatedAt < 150000) return;
    value = { ...value, stale: true, percent: null, tone: 'muted', title: '用量数据已过期，正在等待重新连接',
      rings: value.rings?.map(ring => ({ ...ring, percent: null, tone: 'muted', title: `${ring.label}：暂不可用` })) ?? null };
    render();
  }
  const freshnessTimer = setInterval(expireValue, 1000);
  const visible = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  function hideTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    tooltip.hidden = true;
  }
  function positionTooltip() {
    const r = badge.getBoundingClientRect();
    const ringRect = (tooltipTarget || primaryMeter).querySelector('.usage-ring').getBoundingClientRect();
    const ringCenterY = ringRect.top + ringRect.height / 2;
    tooltip.style.left = `${Math.max(8, Math.min(r.right + 12, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(ringCenterY - tooltip.offsetHeight / 2, innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function showTooltip() {
    clearTimeout(hoverTimer);
    if (!tooltipTarget || !visible(tooltipTarget) || document.hidden || disposed ||
        (!tooltipTarget.matches(':hover') && document.activeElement !== tooltipTarget)) return;
    tooltip.hidden = false;
    positionTooltip();
  }
  function scheduleTooltip() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(showTooltip, 350);
  }
  function usageRingColor(percent) {
    const start = percent >= 50 ? [59, 130, 246] : [239, 68, 68];
    const end = percent >= 50 ? [34, 197, 94] : [59, 130, 246];
    const progress = percent >= 50 ? (percent - 50) / 50 : percent / 50;
    // Interpolate in linear light so intermediate colors retain their brightness.
    const linear = channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return `rgb(${start.map((channel, index) => {
      const mixed = linear(channel) + (linear(end[index]) - linear(channel)) * progress;
      return Math.round(255 * (mixed <= 0.0031308 ? mixed * 12.92 : 1.055 * mixed ** (1 / 2.4) - 0.055));
    }).join(', ')})`;
  }
  function renderMeter(element, meter, accessible = true) {
    const percent = Number.isFinite(meter.percent) ? Math.max(0, Math.min(100, Math.round(meter.percent))) : null;
    const number = percent === null ? '—' : `${percent}%`;
    element.dataset.tone = meter.tone;
    if (element.querySelector('.usage-window').textContent !== meter.label) element.querySelector('.usage-window').textContent = meter.label;
    if (element.querySelector('.usage-number').textContent !== number) element.querySelector('.usage-number').textContent = number;
    const ring = element.querySelector('.usage-ring-value');
    ring.style.stroke = percent === null ? '' : usageRingColor(percent);
    ring.style.strokeDashoffset = String(100 - (percent ?? 0));
    ring.style.opacity = percent !== null && percent > 0 ? '1' : '0';
    if (accessible) {
      element.setAttribute('role', 'meter');
      element.setAttribute('aria-label', meter.label);
      element.setAttribute('aria-valuemin', '0'); element.setAttribute('aria-valuemax', '100');
      element.setAttribute('aria-valuetext', meter.title);
      if (percent === null) element.removeAttribute('aria-valuenow');
      else element.setAttribute('aria-valuenow', String(percent));
    } else {
      for (const attr of ['role', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) element.removeAttribute(attr);
    }
  }
  function renderTooltip(dual) {
    const lines = String(value.title ?? '').split('\n');
    const heading = document.createElement('div');
    heading.className = 'usage-tooltip-title';
    heading.textContent = lines[0].replace(/，剩余\s*\d+%$/, '');
    const details = !dual && !value.stale ? lines.slice(1).map(line => {
      const match = line.match(/^([^：]+)：剩余\s*(\d+)%(?:，.+)?$/);
      return match ? { label: match[1], percent: Number(match[2]), title: line } : null;
    }).filter(Boolean) : [];
    const meters = dual ? value.rings : details.length ? details : [{ ...value,
      label: primaryMeter.querySelector('.usage-window').textContent }];
    const sections = document.createElement('div');
    sections.className = 'usage-tooltip-sections';
    const metadata = lines.slice(1).filter(line => !meters.some(meter => meter.title === line));
    tooltip.dataset.mode = meters.length > 1 ? 'dual' : 'single';
    for (const meter of meters) {
      const section = document.createElement('div');
      section.className = 'usage-tooltip-section';
      const label = document.createElement('div');
      label.className = 'usage-tooltip-label';
      label.textContent = meter.label;
      const percent = Number.isFinite(meter.percent) ? Math.max(0, Math.min(100, Math.round(meter.percent))) : null;
      const percentage = document.createElement('div');
      percentage.className = 'usage-tooltip-percent';
      percentage.textContent = percent === null ? '—' : `${percent}%`;
      if (percent !== null) percentage.style.color = usageRingColor(percent);
      section.append(label, percentage);
      const title = String(meter.title ?? '');
      const reset = title.match(/，(.+?)\s+重置$/);
      if (reset) {
        const resetText = document.createElement('div');
        resetText.className = 'usage-tooltip-reset';
        resetText.textContent = `${reset[1]} 重置`;
        section.appendChild(resetText);
      }
      if (percent === null && title.startsWith(`${meter.label}：`)) {
        const status = document.createElement('div');
        status.className = 'usage-tooltip-status';
        status.textContent = title.slice(meter.label.length + 1, reset ? reset.index : undefined);
        section.appendChild(status);
      } else if (!/^[^：]+：剩余\s*\d+%(?:，.+\s+重置)?$/.test(title) && title !== lines[0] && title !== value.title) {
        metadata.push(title);
      }
      sections.appendChild(section);
    }
    tooltip.replaceChildren(heading, sections);
    if (metadata.length) {
      const footer = document.createElement('div');
      footer.className = 'usage-tooltip-metadata';
      for (const text of metadata) {
        const line = document.createElement('div');
        line.textContent = text;
        footer.appendChild(line);
      }
      tooltip.appendChild(footer);
    }
  }
  function render() {
    const dual = value.mode === 'dual' && value.rings?.length === 2;
    const percent = Number.isFinite(value.percent) ? Math.max(0, Math.min(100, Math.round(value.percent))) : null;
    badge.dataset.mode = dual ? 'dual' : 'single';
    badge.dataset.tone = dual ? value.rings[0].tone : value.tone;
    secondaryMeter.hidden = !dual;
    renderMeter(primaryMeter, dual ? value.rings[0] : {
      ...value, label: value.windowLabel === '周' ? '周额度' : percent === null ? '用量' : '5h额度'
    }, true);
    if (dual) renderMeter(secondaryMeter, value.rings[1]);
    badge.setAttribute('role', 'group');
    badge.setAttribute('aria-label', 'Codex 剩余用量');
    for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) badge.removeAttribute(attr);
    renderTooltip(dual);
  }
  function place() {
    if (disposed || !document.body) return;
    if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
    if (!tooltip.isConnected) document.body.appendChild(tooltip);
    const nextRail = [...document.querySelectorAll('nav[data-app-navigation-rail]')].find(visible);
    if (rail !== nextRail) {
      if (rail) resizeObserver.unobserve(rail);
      rail = nextRail ?? null;
      if (rail) resizeObserver.observe(rail);
    }
    // The current app places its help/profile footer after the flexible navigation list.
    // Own a sibling before that footer; do not reparent any React-owned elements.
    const footer = rail && [...rail.children].filter(el => el !== badge && visible(el) && getComputedStyle(el).position !== 'absolute').at(-1);
    if (!rail || !footer) {
      badge.hidden = true;
      hideTooltip();
      return;
    }
    badge.hidden = false;
    if (badge.parentElement !== rail || badge.nextElementSibling !== footer) rail.insertBefore(badge, footer);
    if (!tooltip.hidden) positionTooltip();
  }
  function schedulePlacement() {
    if (disposed || placementTimer !== null) return;
    placementTimer = setTimeout(() => { placementTimer = null; place(); }, 100);
  }
  const observer = new MutationObserver(records => {
    if (records.some(r => !badge.contains(r.target) && !tooltip.contains(r.target) && r.target !== style)) schedulePlacement();
  });
  const resizeObserver = new ResizeObserver(schedulePlacement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const onMeterEnter = event => { tooltipTarget = event.currentTarget; scheduleTooltip(); };
  const onMeterFocus = event => { tooltipTarget = event.currentTarget; showTooltip(); };
  for (const meter of [primaryMeter, secondaryMeter]) {
    meter.addEventListener('mouseenter', onMeterEnter);
    meter.addEventListener('mouseleave', hideTooltip);
    meter.addEventListener('focus', onMeterFocus);
    meter.addEventListener('blur', hideTooltip);
  }
  const onKeyDown = e => { if (e.key === 'Escape') hideTooltip(); };
  badge.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', schedulePlacement);
  document.addEventListener('visibilitychange', hideTooltip);
  window[KEY] = {
    version: VERSION,
    place,
    update(next) { value = { ...value, ...next }; expireValue(); render(); place(); },
    status() {
      return { version: VERSION, placed: badge.parentElement === rail && visible(badge) && !badge.hidden,
        percent: value.percent, windowLabel: value.windowLabel, tone: value.tone, mode: value.mode, rings: value.rings,
        updatedAt: value.updatedAt ?? null, stale: value.stale ?? false,
        resetsAt: value.resetsAt ?? null, windows: value.windows ?? [],
        badgeCount: document.querySelectorAll('#codex-sidebar-quota').length };
    },
    destroy() {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      clearTimeout(placementTimer);
      clearInterval(freshnessTimer);
      hideTooltip();
      for (const meter of [primaryMeter, secondaryMeter]) {
        meter.removeEventListener('mouseenter', onMeterEnter);
        meter.removeEventListener('mouseleave', hideTooltip);
        meter.removeEventListener('focus', onMeterFocus);
        meter.removeEventListener('blur', hideTooltip);
      }
      window.removeEventListener('resize', schedulePlacement);
      document.removeEventListener('visibilitychange', hideTooltip);
      badge.remove(); tooltip.remove(); style.remove();
      delete window[KEY];
    }
  };
  render();
  place();
}

function isMainWindow(target) {
  try {
    const u=new URL(target?.url || '');
    return u.protocol==='app:' && u.hostname==='-' && u.pathname==='/index.html' && !/overlay/i.test(decodeURIComponent(u.search+u.hash));
  } catch {return false;}
}
function buildBootstrapScript() {
  return [installUsageBadge].map(fn=>`(${fn.toString()})()`).join(';\n');
}
class CdpSession {
  constructor(target, toolsStore, onToolsState) {
    this.target=target;this.pending=new Map();this.serial=0;this.socket=null;
    this.toolsStore=toolsStore;this.onToolsState=onToolsState;this.contexts=new Map();this.toolsContext=null;
  }
  async connect() {
    const u=new URL(this.target.webSocketDebuggerUrl);
    if(u.protocol!=='ws:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.port!=='39223' || u.username || u.password) throw new Error('CDP must use loopback port 39223');
    const ws=new WebSocket(u);this.socket=ws;
    ws.addEventListener('message',event=>{
      let msg;try{msg=JSON.parse(event.data);}catch{return;}
      if(msg.method==='Runtime.executionContextCreated')this.contexts.set(msg.params.context.id,msg.params.context);
      if(msg.method==='Runtime.executionContextDestroyed') {this.contexts.delete(msg.params.executionContextId);if(this.toolsContext===msg.params.executionContextId)this.toolsContext=null;}
      if(msg.method==='Runtime.executionContextsCleared') {this.contexts.clear();this.toolsContext=null;}
      if(msg.method==='Runtime.bindingCalled'&&msg.params?.name==='__codexSidebarToolsRequest')this.handleToolsRequest(msg.params).catch(()=>{});
      const p=this.pending.get(msg?.id);if(!p)return;
      this.pending.delete(msg.id);clearTimeout(p.timer);
      msg.error || msg.result?.exceptionDetails ? p.reject(new Error('CDP evaluation failed')) : p.resolve(msg.result);
    });
    ws.addEventListener('close',()=>this.rejectPending());
    ws.addEventListener('error',()=>this.rejectPending());
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.close();reject(new Error('CDP handshake timed out'));},4000);
      const finish=fn=>{clearTimeout(timer);fn();};
      ws.addEventListener('open',()=>finish(resolve),{once:true});
      ws.addEventListener('error',()=>finish(()=>reject(new Error('CDP unavailable'))),{once:true});
      ws.addEventListener('close',()=>finish(()=>reject(new Error('CDP closed'))),{once:true});
    });
    await this.request('Runtime.enable');
  }
  async ensureToolsBinding() {
    if(!this.toolsStore)return;
    const tree=await this.request('Page.getFrameTree');
    const context=[...this.contexts.values()].find(c=>c.auxData?.isDefault&&c.auxData.frameId===tree.frameTree?.frame?.id);
    if(!context)throw new Error('Main-window tools context unavailable');
    if(context.id===this.toolsContext)return;
    await this.request('Runtime.addBinding',{name:'__codexSidebarToolsRequest',executionContextId:context.id});
    this.toolsContext=context.id;
  }
  async handleToolsRequest(event) {
    if(!this.toolsStore||event.executionContextId!==this.toolsContext||typeof event.payload!=='string'||event.payload.length>100000)return;
    let request;try{request=JSON.parse(event.payload);}catch{return;}
    if(!request||typeof request.id!=='string'||!/^\d{1,12}$/.test(request.id)||typeof request.method!=='string')return;
    let reply;
    try {
      const result=await this.toolsStore.dispatch(request.method,request.params);
      reply={id:request.id,ok:true,...result};
    } catch(error) {reply={id:request.id,ok:false,code:error.code||'TOOLS_ERROR',message:error.message,...(error.state?{state:error.state}:{})};}
    await this.request('Runtime.evaluate',{expression:`window.__codexSidebarToolsReceive?.(${JSON.stringify(reply)})`,contextId:event.executionContextId,returnByValue:true});
    if(reply.state)this.onToolsState?.(reply.state);
  }
  request(method,params={}) {
    if(this.socket?.readyState!==WebSocket.OPEN)return Promise.reject(new Error('CDP disconnected'));
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP request timed out'));},5000);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params}));}catch(error){this.pending.delete(id);clearTimeout(timer);reject(error);}
    });
  }
  evaluate(expression){return this.request('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});}
  rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('CDP disconnected'));}this.pending.clear();}
  close(){this.rejectPending();this.socket?.close();this.socket=null;}
}
class RendererInjector {
  constructor({port,toolsStore}){this.port=port;this.toolsStore=toolsStore;this.sessions=new Map();this.currentValue=null;this.scanning=false;this.stopped=false;}
  async scan(){
    if(this.scanning||this.stopped)return;
    this.scanning=true;
    try{
      const res=await fetch(`http://127.0.0.1:${this.port}/json/list`,{signal:AbortSignal.timeout(3000)});
      if(!res.ok)throw new Error('CDP unavailable');
      const pages=(await res.json()).filter(t=>t.type==='page'&&isMainWindow(t)&&typeof t.webSocketDebuggerUrl==='string');
      const live=new Set(pages.map(t=>t.id));
      for(const[id,s]of this.sessions)if(!live.has(id)){s.close();this.sessions.delete(id);}
      await Promise.all(pages.map(async t=>{
        const existing=this.sessions.get(t.id), session=existing || new CdpSession(t,this.toolsStore,state=>this.syncTools(state));
        try{
          if(!existing)await session.connect();
          await session.evaluate(buildBootstrapScript());
          if(this.toolsStore) {
            await session.ensureToolsBinding();
            await session.evaluate(require('./tools-ui.cjs').buildToolsScript(this.toolsStore.getState()));
          }
          if(this.currentValue)await session.evaluate(`window.__codexSidebarQuota?.update(${JSON.stringify(this.currentValue)})`);
          if(this.stopped){session.close();return;}
          this.sessions.set(t.id,session);
        }catch{session.close();this.sessions.delete(t.id);}
      }));
    }finally{this.scanning=false;}
  }
  async update(value){
    this.currentValue=value;
    await Promise.all([...this.sessions].map(async([id,s])=>{
      try{await s.evaluate(`window.__codexSidebarQuota?.update(${JSON.stringify(value)})`);}catch{s.close();this.sessions.delete(id);}
    }));
  }
  syncTools(state) {
    for(const session of this.sessions.values())session.evaluate(`window.__codexSidebarToolsV1?.sync(${JSON.stringify(state)})`).catch(()=>{});
  }
  stop(){this.stopped=true;for(const s of this.sessions.values())s.close();this.sessions.clear();}
}

const resolverFs = require('node:fs');
function isExecutableFile(file) {
  if (!file) return false;
  try {
    resolverFs.accessSync(file, resolverFs.constants.X_OK);
    return resolverFs.statSync(file).isFile();
  } catch { return false; }
}
function resolveCodexBin(explicit, appPath, platform = process.platform) {
  return require('./platform.cjs').discoverCli(appPath,{platform,explicit});
}

var AGENT_VERSION = '0.1.0-beta.1';

function parseArgs(argv) {
  const options = {
    port: Number(process.env.CODEX_SIDEBAR_PORT) || 39223,
    appPath: process.env.CODEX_SIDEBAR_APP || '',
    codexBin: process.env.CODEX_SIDEBAR_BIN || '',
    dataDir: process.env.CODEX_SIDEBAR_DATA_DIR || require('./platform.cjs').getPaths().installDir,
    instanceToken: '',
    pollMs: Number(process.env.CODEX_SIDEBAR_POLL_MS) || 60000
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') options.port = Number(argv[++i]);
    else if (argv[i] === '--app') options.appPath = argv[++i];
    else if (argv[i] === '--codex-bin') options.codexBin = argv[++i];
    else if (argv[i] === '--poll-ms') options.pollMs = Math.max(1000, Number(argv[++i]));
    else if (argv[i] === '--data-dir') options.dataDir = argv[++i];
    else if (argv[i] === '--instance-token') options.instanceToken = argv[++i];
    else throw new Error('Unknown argument: ' + argv[i]);
  }
  if (options.port !== 39223) throw new Error('This edition only connects to loopback CDP port 39223');
  if (!require('node:path').isAbsolute(options.dataDir || '')) throw new Error('Data directory must be absolute');
  if (!Number.isFinite(options.pollMs) || options.pollMs < 1000) throw new Error('Invalid poll interval');
  if (options.instanceToken && !/^[a-f0-9-]{36}$/i.test(options.instanceToken)) throw new Error('Invalid instance token');
  return options;
}

function log(message) {
  process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  options.appPath = require('./platform.cjs').discoverApp({explicit:options.appPath});
  options.codexBin = resolveCodexBin(options.codexBin, options.appPath);
  log(`codex-sidebar-tools v${AGENT_VERSION} started: local CDP + Codex app-server only.`);

  const releaseReceipt = acquireRuntimeReceipt(options.dataDir, options.instanceToken);
  process.once('exit', releaseReceipt);

  const toolsStore = require('./tools-store.cjs').createToolsStore({filePath:require('node:path').join(options.dataDir,'data/state.json')});
  toolsStore.getState();
  const injector = new RendererInjector({ port: options.port, toolsStore });
  let stopped = false;
  let client = null;
  let pending = false;
  let nextRead = 0;
  let failures = 0;
  let connected = false;

  injector.currentValue = {
    percent: null,
    title: '正在读取 Codex 剩余用量',
    tone: 'muted',
    windowLabel: ''
  };

  const scan = async () => {
    if (stopped) return;
    try {
      await injector.scan();
      if (!connected && injector.sessions.size > 0) log('主窗口连接正常。');
      connected = injector.sessions.size > 0;
    } catch {
      connected = false;
      for (const session of injector.sessions.values()) session.close();
      injector.sessions.clear();
    }

    if (injector.sessions.size === 0) {
      const old = client;
      client = null;
      old?.stop();
      nextRead = 0;
      injector.currentValue = unavailableValue(injector.currentValue);
    }
  };

  async function readUsage() {
    if (stopped || pending || Date.now() < nextRead || injector.sessions.size === 0) return;
    pending = true;

    try {
      if (!client) {
        options.codexBin = resolveCodexBin(options.codexBin, options.appPath);
        const current = new AppServerClient({
          command: options.codexBin,
          debug: false
        });
        client = current;

        current.on('rate-limits', data => {
          if (client !== current || stopped) return;
          try {
            injector.update({
              ...formatRateLimits(data),
              updatedAt: Date.now(),
              stale: false
            }).catch(() => {});
          } catch {
            injector.update(unavailableValue(injector.currentValue)).catch(() => {});
          }
        });

        current.on('server-exit', () => {
          if (client === current) {
            client = null;
            nextRead = Date.now() + 10000;
            injector.update(unavailableValue(injector.currentValue)).catch(() => {});
          }
        });

        await current.start();
        if (stopped) current.stop();
      } else {
        await client.refresh();
      }

      failures = 0;
      if (client) nextRead = Date.now() + options.pollMs;
    } catch {
      const old = client;
      client = null;
      old?.stop();
      failures++;
      nextRead = Date.now() + Math.min(60000, 10000 * failures);
      await injector.update(unavailableValue(injector.currentValue));
    } finally {
      pending = false;
    }
  }

  const tick = async () => {
    await scan();
    readUsage().catch(() => {});
  };

  let ticking = false;
  const guardedTick = async () => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      await tick();
    } catch {
      // Keep the monitor silent on transient local connection failures.
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(guardedTick, 5000);

  const shutdown = () => {
    stopped = true;
    clearInterval(timer);
    const old = client;
    client = null;
    old?.stop();
    injector.stop();
    releaseReceipt();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await guardedTick();
}

function acquireRuntimeReceipt(dataDir, token) {
  if (!token) return () => {};
  const fs = require('node:fs'), path = require('node:path');
  const directory = path.join(dataDir, 'runtime'), file = path.join(directory, 'agent.json');
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  try {
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink() || !stat.isFile() || stat.size>2048)throw new Error('Unexpected runtime receipt');
    const previousText=fs.readFileSync(file,'utf8'),previous=JSON.parse(previousText);
    if(!Number.isSafeInteger(previous.pid) || previous.pid<1 || !/^[a-f0-9-]{36}$/i.test(previous.token||''))throw new Error('Invalid runtime receipt');
    let alive=true;
    try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
    if(alive) {
      if(previous.pid===process.pid)throw new Error('A sidebar agent is already running');
      const row=require('./platform.cjs').listProcesses().find(item=>item.pid===previous.pid);
      if(!row?.commandLine)throw new Error('Cannot verify the previous agent process');
      const line=process.platform==='win32'?row.commandLine.toLowerCase():row.commandLine;
      const script=process.platform==='win32'?__filename.toLowerCase():__filename;
      if(line.includes(script) && line.includes('--instance-token'))throw new Error('A sidebar agent is already running');
      // The PID was reused after an abrupt exit. Never signal that unrelated process.
    }
    if(fs.readFileSync(file,'utf8')!==previousText)throw new Error('Runtime receipt changed during verification');
    fs.unlinkSync(file);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const receipt={pid:process.pid,token,startedAt:Date.now()};
  fs.writeFileSync(file,JSON.stringify(receipt)+'\n',{mode:0o600,flag:'wx'});
  return () => {
    try {
      const stat=fs.lstatSync(file);if(!stat.isFile() || stat.isSymbolicLink() || stat.size>2048)return;
      const current=JSON.parse(fs.readFileSync(file,'utf8'));
      if(current.pid===process.pid && current.token===token)fs.unlinkSync(file);
    } catch {}
  };
}

module.exports = {
  installUsageBadge,
  formatRateLimits,
  unavailableValue,
  isMainWindow,
  resolveCodexBin,
  AppServerClient,
  CdpSession,
  parseArgs,
  acquireRuntimeReceipt,
  main
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write('Sidebar agent: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
