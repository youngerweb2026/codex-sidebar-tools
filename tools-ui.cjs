'use strict';
// Personal sidebar tools; injected only into the existing Codex main-window target.
function membershipStatus(expiresOn, now = Date.now()) {
  const date = new Date(expiresOn + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn || '') || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== expiresOn) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
  const pick = type => parts.find(p => p.type === type).value;
  const today = Date.UTC(Number(pick('year')), Number(pick('month')) - 1, Number(pick('day')));
  const days = Math.round((Date.parse(expiresOn + 'T00:00:00Z') - today) / 86400000);
  return {days: Math.max(0, days), text: days > 0 ? `${days}天` : days === 0 ? '今日到期' : '已到期',
    tone: days <= 0 ? 'danger' : days <= 3 ? 'warning' : 'normal',
    title: `会员到期：${expiresOn}（手动设置）\n按北京时间的日期计算；点击可修改到期日。`};
}
function resetCountdown(resetsAt, now = Date.now(), stale = false) {
  if (stale || !Number.isFinite(resetsAt) || resetsAt <= 0) return {text: '—', detail: '额度重置时间暂不可用'};
  const seconds = Math.ceil(resetsAt - now / 1000);
  if (seconds <= 0) return {text: '待刷新', detail: '已到重置时间，等待最新额度'};
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return {text: days ? `${days}天` : hours ? `${hours}小时` : minutes ? `${minutes}分钟` : '<1分钟',
    detail: `距离重置：${days ? days + '天 ' : ''}${hours}小时 ${minutes}分钟`};
}
function installSidebarTools(initialState) {
  const VERSION = 1;
  const KEY = '__codexSidebarToolsV1';
  if (window[KEY]?.version === VERSION) { window[KEY].sync(initialState); window[KEY].place(); return; }
  window[KEY]?.destroy?.();
  let state = initialState, disposed = false, rail = null, panelTab = 'shortcuts';
  let noteDraft = state.notes, noteBase = state.notes, noteRevision = state.revision;
  let noteDirty = false, savingNotes = false, noteConflict = false, saveTimer = null, editingShortcut = null;
  let lastSignature = '', shortcutsSignature = '', requestSerial = 0;
  const pending = new Map(), cleanups = [];
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const on = (node, type, fn) => { node.addEventListener(type, fn); cleanups.push(() => node.removeEventListener(type, fn)); };
  const icons = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3Z"/>',
    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
    note: '<path d="M5 3h14v14l-4 4H5Z"/><path d="M8 8h8M8 12h8M8 16h4M15 21v-5h4"/>'
  };
  function icon(kind) { const wrap = el('span', 'st-icon'); wrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`; return wrap; }
  const style = el('style'); style.id = 'codex-sidebar-tools-v1-style';
  style.textContent = `
  #codex-sidebar-tools-v1-strip, #codex-sidebar-tools-v1-panel, #codex-sidebar-quota .st-member, #codex-sidebar-quota .st-reset { box-sizing:border-box; font-family:inherit; -webkit-app-region:no-drag; }
  #codex-sidebar-quota[data-tools="1"] { height:auto !important; flex:0 0 auto !important; }
  #codex-sidebar-quota .st-member { display:flex; flex:0 0 30px; flex-direction:column; align-items:center; justify-content:center; width:100%; padding:0 0 6px; border:0; border-bottom:1px solid var(--usage-border); background:transparent; color:var(--usage-text); cursor:pointer; gap:2px; }
  #codex-sidebar-quota .st-member-label { font-size:7px; line-height:9px; white-space:nowrap; color:var(--usage-label); }
  #codex-sidebar-quota .st-member-number { font-size:11px; line-height:14px; font-weight:700; white-space:nowrap; }
  #codex-sidebar-quota .st-member[data-tone="warning"] .st-member-number { color:var(--usage-warning-color); }
  #codex-sidebar-quota .st-member[data-tone="danger"] .st-member-number { color:var(--usage-danger-color); font-size:7px; }
  #codex-sidebar-quota[data-tone="warning"] .usage-primary .usage-number, #codex-sidebar-quota .usage-secondary[data-tone="warning"] .usage-number { color:var(--usage-warning-color); }
  #codex-sidebar-quota[data-tone="danger"] .usage-primary .usage-number, #codex-sidebar-quota .usage-secondary[data-tone="danger"] .usage-number { color:var(--usage-danger-color); }
  #codex-sidebar-quota .st-reset { display:flex; flex:0 0 25px; flex-direction:column; align-items:center; justify-content:center; width:100%; border-top:1px solid var(--usage-border); padding-top:5px; gap:2px; }
  #codex-sidebar-quota .st-reset-number { font-size:9px; line-height:11px; font-weight:600; color:var(--usage-text); white-space:nowrap; }
  #codex-sidebar-quota .st-reset-label { font-size:7px; line-height:9px; color:var(--usage-label); }
  #codex-sidebar-tools-v1-strip { display:flex; flex:0 0 auto; flex-direction:column; align-items:center; gap:4px; width:36px; align-self:center; margin:7px 0 6px; color:var(--color-text-primary,#303630); }
  html.dark #codex-sidebar-tools-v1-strip, html[data-theme="dark"] #codex-sidebar-tools-v1-strip { color:var(--color-text-primary,#edf0ed); }
  #codex-sidebar-tools-v1-strip button { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; width:36px; height:36px; flex:0 0 36px; padding:3px 1px; border:0; border-radius:7px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
  #codex-sidebar-tools-v1-strip button:hover, #codex-sidebar-tools-v1-strip button[aria-expanded="true"] { background:color-mix(in srgb,currentColor 8%,transparent); }
  #codex-sidebar-tools-v1-strip button:focus-visible, #codex-sidebar-quota .st-member:focus-visible { outline:2px solid #269b82; outline-offset:2px; }
  #codex-sidebar-tools-v1-strip .st-icon { display:block; width:18px; height:18px; }
  #codex-sidebar-tools-v1-strip .st-icon svg { width:100%; height:100%; }
  #codex-sidebar-tools-v1-strip .st-button-label { font-size:8px; line-height:10px; max-width:32px; overflow:hidden; white-space:nowrap; }
  #codex-sidebar-tools-v1-strip button[data-has-note="true"]:after { content:''; position:absolute; top:3px; right:4px; width:4px; height:4px; border-radius:50%; background:#26a58a; }
  #codex-sidebar-tools-v1-panel { position:fixed; z-index:2147482999; width:350px; max-width:calc(100vw - 20px); max-height:calc(100vh - 24px); overflow:auto; padding:16px; border:1px solid #7773; border-radius:14px; background:var(--color-surface-elevated-secondary,#fafafa); color:var(--color-text-primary,#25313a); box-shadow:0 12px 44px #0002; font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; }
  #codex-sidebar-tools-v1-panel[hidden], #codex-sidebar-tools-v1-panel [hidden] { display:none !important; }
  #codex-sidebar-tools-v1-panel * { box-sizing:border-box; }
  #codex-sidebar-tools-v1-panel .st-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
  #codex-sidebar-tools-v1-panel h2 { margin:0; font-size:15px; font-weight:650; }
  #codex-sidebar-tools-v1-panel button { font:inherit; cursor:pointer; color:inherit; }
  #codex-sidebar-tools-v1-panel .st-close { border:0; background:transparent; font-size:20px; line-height:24px; width:24px; border-radius:6px; }
  #codex-sidebar-tools-v1-panel .st-tabs { display:flex; gap:4px; padding:3px; background:#8881; border-radius:8px; margin-bottom:14px; }
  #codex-sidebar-tools-v1-panel .st-tabs button { border:0; border-radius:6px; padding:6px 8px; flex:1; background:transparent; }
  #codex-sidebar-tools-v1-panel .st-tabs button[aria-selected="true"] { background:var(--color-surface-primary,#fff); box-shadow:0 1px 4px #0001; font-weight:600; }
  #codex-sidebar-tools-v1-panel .st-row { display:flex; align-items:center; gap:6px; margin:0 0 7px; }
  #codex-sidebar-tools-v1-panel .st-open { display:flex; flex:1; align-items:center; gap:9px; min-width:0; text-align:left; border:1px solid #8882; background:transparent; border-radius:8px; padding:9px; }
  #codex-sidebar-tools-v1-panel .st-open:hover { background:#8881; }
  #codex-sidebar-tools-v1-panel .st-icon { width:20px; height:20px; flex:0 0 20px; }
  #codex-sidebar-tools-v1-panel .st-icon svg { width:100%; height:100%; }
  #codex-sidebar-tools-v1-panel .st-open-copy { min-width:0; }
  #codex-sidebar-tools-v1-panel .st-open-copy strong { display:block; font-size:12px; font-weight:600; }
  #codex-sidebar-tools-v1-panel .st-path { display:block; max-width:205px; color:color-mix(in srgb,currentColor 55%,transparent); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #codex-sidebar-tools-v1-panel .st-mini { background:transparent; border:0; padding:5px; border-radius:5px; font-size:11px; }
  #codex-sidebar-tools-v1-panel .st-mini:hover { background:#8881; }
  #codex-sidebar-tools-v1-panel .st-hint { margin:8px 0 12px; font-size:11px; color:color-mix(in srgb,currentColor 60%,transparent); }
  #codex-sidebar-tools-v1-panel label { display:block; font-size:11px; margin:9px 0 4px; }
  #codex-sidebar-tools-v1-panel input, #codex-sidebar-tools-v1-panel select, #codex-sidebar-tools-v1-panel textarea { width:100%; border:1px solid #8884; border-radius:7px; padding:8px 9px; background:var(--color-surface-primary,#fff); color:inherit; font-family:inherit; font-size:12px; line-height:1.5; outline-offset:2px; }
  #codex-sidebar-tools-v1-panel input:focus, #codex-sidebar-tools-v1-panel textarea:focus, #codex-sidebar-tools-v1-panel select:focus { outline:2px solid #299c8266; }
  #codex-sidebar-tools-v1-panel textarea { min-height:200px; resize:vertical; line-height:1.7; font-size:12px; }
  #codex-sidebar-tools-v1-panel .st-primary { border:0; border-radius:7px; background:#177c63; color:#fff; padding:8px 13px; font-weight:600; }
  #codex-sidebar-tools-v1-panel .st-actions { display:flex; align-items:center; gap:8px; margin-top:12px; }
  #codex-sidebar-tools-v1-panel .st-message { margin:9px 0 0; min-height:17px; font-size:11px; color:color-mix(in srgb,currentColor 60%,transparent); }
  #codex-sidebar-tools-v1-panel .st-message[data-error="true"] { color:#bc4744; }
  #codex-sidebar-tools-v1-panel .st-separator { height:1px; background:#8882; margin:14px 0; }
  #codex-sidebar-tools-v1-panel .st-save-state { font-size:11px; color:color-mix(in srgb,currentColor 60%,transparent); }
  html.dark #codex-sidebar-tools-v1-panel, html[data-theme="dark"] #codex-sidebar-tools-v1-panel { background:var(--color-surface-elevated-secondary,#2c2e2c); color:var(--color-text-primary,#edf0ed); }
  html.dark #codex-sidebar-tools-v1-panel input, html.dark #codex-sidebar-tools-v1-panel textarea, html.dark #codex-sidebar-tools-v1-panel select, html.dark #codex-sidebar-tools-v1-panel .st-tabs button[aria-selected="true"] { background:var(--color-surface-primary,#343634); }
  @media(prefers-color-scheme:dark) { html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-strip { color:var(--color-text-primary,#edf0ed); } html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-panel { background:var(--color-surface-elevated-secondary,#2c2e2c); color:var(--color-text-primary,#edf0ed); } html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-panel input, html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-panel textarea, html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-panel select, html:not(.light):not([data-theme="light"]) #codex-sidebar-tools-v1-panel .st-tabs button[aria-selected="true"] { background:var(--color-surface-primary,#343634); } }
  `;
  const strip = el('div'); strip.id = 'codex-sidebar-tools-v1-strip'; strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', '侧栏工具');
  function railButton(kind, label, title, action) {
    const button = el('button'); button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
    button.append(icon(kind), el('span', 'st-button-label', label)); on(button, 'click', action); return button;
  }
  const shortcutsButton = railButton('grid', '入口', '管理快捷入口', () => togglePanel('shortcuts'));
  const notesButton = railButton('note', '便签', '临时便签', () => togglePanel('notes'));
  shortcutsButton.setAttribute('aria-expanded', 'false'); notesButton.setAttribute('aria-expanded', 'false');
  strip.append(shortcutsButton, notesButton);
  const member = el('button', 'st-member'); member.type = 'button';
  const memberLabel = el('span', 'st-member-label', '会员剩余'), memberNumber = el('span', 'st-member-number');
  member.append(memberLabel, memberNumber); on(member, 'click', e => { e.stopPropagation(); togglePanel('settings'); });
  const reset = el('div', 'st-reset'), resetNumber = el('span', 'st-reset-number'), resetLabel = el('span', 'st-reset-label', '后重置'); reset.append(resetNumber, resetLabel);
  const panel = el('section'); panel.id = 'codex-sidebar-tools-v1-panel'; panel.hidden = true; panel.setAttribute('aria-label', '侧栏工具面板');
  const header = el('div', 'st-header'), heading = el('h2', '', '侧栏工具'), close = el('button', 'st-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭侧栏工具');
  header.append(heading, close); on(close, 'click', closePanel);
  const tabs = el('div', 'st-tabs'); tabs.setAttribute('role', 'tablist');
  const sections = {}, tabButtons = {};
  for (const [id, name] of [['shortcuts', '快捷入口'], ['notes', '便签'], ['settings', '设置']]) {
    const tab = el('button', '', name); tab.type = 'button'; tab.dataset.tab = id; tab.setAttribute('role', 'tab');
    tab.id = 'codex-sidebar-v1-tab-' + id; tab.setAttribute('aria-controls', 'codex-sidebar-v1-page-' + id);
    on(tab, 'click', () => openPanel(id)); tabs.append(tab); tabButtons[id] = tab;
    const page = el('div'); page.dataset.page = id; page.id = 'codex-sidebar-v1-page-' + id; page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-labelledby', tab.id); sections[id] = page;
  }
  const list = el('div', 'st-shortcut-list');
  const shortcutHint = el('p', 'st-hint', '添加常用文件夹和网页；网页使用 Google Chrome 打开。');
  const shortcutForm = el('form'), formTitle = el('strong', '', '添加入口');
  const nameInput = el('input'); nameInput.name = 'label'; nameInput.maxLength = 40; nameInput.placeholder = '例如：提示词';
  const kindInput = el('select'); kindInput.name = 'kind';
  for (const [value, label] of [['folder', '文件夹'], ['web', '网页']]) { const option = el('option', '', label); option.value = value; kindInput.append(option); }
  const targetInput = el('input'); targetInput.name = 'target'; targetInput.placeholder = '~/文件夹路径'; targetInput.maxLength = 4096;
  const shortcutSave = el('button', 'st-primary', '添加入口'); shortcutSave.type = 'submit';
  const shortcutCancel = el('button', 'st-mini', '取消编辑'); shortcutCancel.type = 'button'; shortcutCancel.hidden = true;
  function labelled(text, input) { const label = el('label', '', text); label.append(input); return label; }
  const shortcutActions = el('div', 'st-actions'); shortcutActions.append(shortcutSave, shortcutCancel);
  shortcutForm.append(formTitle, labelled('名称', nameInput), labelled('类型', kindInput), labelled('路径或网址', targetInput), shortcutActions);
  const shortcutMessage = el('p', 'st-message'); shortcutMessage.setAttribute('role', 'status');
  sections.shortcuts.append(list, shortcutHint, el('div', 'st-separator'), shortcutForm, shortcutMessage);
  on(kindInput, 'change', () => { targetInput.placeholder = kindInput.value === 'web' ? 'https://example.com' : '~/文件夹路径'; });
  function clearShortcutForm() { editingShortcut = null; nameInput.value = ''; kindInput.value = 'folder'; targetInput.value = ''; targetInput.placeholder = '~/文件夹路径'; shortcutSave.textContent = '添加入口'; formTitle.textContent = '添加入口'; shortcutCancel.hidden = true; }
  on(shortcutCancel, 'click', clearShortcutForm);
  function message(node, text, error = false) { node.textContent = text; node.dataset.error = String(error); }
  on(shortcutForm, 'submit', async e => {
    e.preventDefault(); shortcutSave.disabled = true;
    try { await request('saveShortcut', {...(editingShortcut ? {id: editingShortcut} : {}), label: nameInput.value, kind: kindInput.value, target: targetInput.value}); clearShortcutForm(); message(shortcutMessage, '已保存'); }
    catch (error) { message(shortcutMessage, error.message, true); } finally { shortcutSave.disabled = false; }
  });
  const noteHint = el('p', 'st-hint', '记下下一步要做的事。自动保存在本机，切换聊天后仍可查看。');
  const textarea = el('textarea'); textarea.setAttribute('aria-label', '临时便签内容'); textarea.placeholder = '下一步做什么？'; textarea.maxLength = 20000; textarea.value = noteDraft;
  const noteActions = el('div', 'st-actions'), noteSave = el('button', 'st-primary', '保存'), noteStatus = el('span', 'st-save-state', '已保存到本机'); noteSave.type = 'button'; noteActions.append(noteSave, noteStatus);
  const noteMessage = el('p', 'st-message'); noteMessage.setAttribute('role', 'status');
  const conflictActions = el('div', 'st-actions'); conflictActions.hidden = true;
  const useLatest = el('button', 'st-mini', '读取最新便签'), saveDraft = el('button', 'st-mini', '保留我的草稿并保存'); useLatest.type = saveDraft.type = 'button'; conflictActions.append(useLatest, saveDraft);
  sections.notes.append(noteHint, textarea, noteActions, noteMessage, conflictActions);
  on(textarea, 'input', () => { noteDraft = textarea.value; noteDirty = noteDraft !== noteBase; noteStatus.textContent = noteDirty ? '等待保存…' : '已保存到本机'; clearTimeout(saveTimer); if (!noteConflict) saveTimer = setTimeout(saveNotes, 650); });
  on(textarea, 'blur', () => { if (noteDirty && !noteConflict) saveNotes(); });
  on(noteSave, 'click', saveNotes);
  on(useLatest, 'click', () => { noteDraft = noteBase = state.notes; noteRevision = state.revision; noteDirty = noteConflict = false; textarea.value = noteDraft; conflictActions.hidden = true; message(noteMessage, '已读取最新便签'); noteStatus.textContent = '已保存到本机'; });
  on(saveDraft, 'click', () => { noteRevision = state.revision; noteBase = state.notes; noteConflict = false; conflictActions.hidden = true; saveNotes(); });
  const settingsForm = el('form'), dateInput = el('input'); dateInput.type = 'date'; dateInput.name = 'expiresOn'; dateInput.value = state.membership.expiresOn || '';
  const dateSave = el('button', 'st-primary', '保存到期日'); dateSave.type = 'submit';
  const settingsMessage = el('p', 'st-message'); settingsMessage.setAttribute('role', 'status');
  const settingsActions = el('div', 'st-actions'); settingsActions.append(dateSave);
  settingsForm.append(labelled('会员到期日期', dateInput), el('p', 'st-hint', '按北京时间的自然日计算。此日期由你手动设置，续费后在这里更新。'), settingsActions);
  sections.settings.append(settingsForm, settingsMessage, el('div', 'st-separator'), el('p', 'st-hint', '会员剩余不超过 3 天时变为暖色，到期后显示提示。额度偏低时沿用原有颜色提醒。'));
  on(settingsForm, 'submit', async e => { e.preventDefault(); dateSave.disabled = true; try { await request('setMembership', {expiresOn: dateInput.value}); message(settingsMessage, '到期日已更新'); } catch (error) { message(settingsMessage, error.message, true); } finally { dateSave.disabled = false; } });
  panel.append(header, tabs, sections.shortcuts, sections.notes, sections.settings);
  function positionPanel() {
    if (panel.hidden) return;
    const r = (rail || strip).getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(r.right + 9, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(12, Math.min(strip.getBoundingClientRect().top, innerHeight - panel.offsetHeight - 12))}px`;
  }
  function openPanel(tab) {
    panelTab = tab; panel.hidden = false;
    for (const id of Object.keys(sections)) { sections[id].hidden = id !== tab; tabButtons[id].setAttribute('aria-selected', String(id === tab)); tabButtons[id].tabIndex = id === tab ? 0 : -1; }
    shortcutsButton.setAttribute('aria-expanded', String(tab === 'shortcuts')); notesButton.setAttribute('aria-expanded', String(tab === 'notes'));
    if (tab === 'settings') dateInput.value = state.membership.expiresOn || '';
    request('getState').catch(error => message(tab === 'notes' ? noteMessage : tab === 'settings' ? settingsMessage : shortcutMessage, error.message, true));
    positionPanel(); if (tab === 'notes') textarea.focus();
  }
  function togglePanel(tab) { if (!panel.hidden && panelTab === tab) closePanel(); else openPanel(tab); }
  function closePanel() { if (noteDirty && !noteConflict) saveNotes(); panel.hidden = true; shortcutsButton.setAttribute('aria-expanded', 'false'); notesButton.setAttribute('aria-expanded', 'false'); }
  on(document, 'pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !strip.contains(e.target) && !member.contains(e.target)) closePanel(); });
  on(document, 'keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
  on(window, 'resize', positionPanel);
  const receiver = response => {
    const job = pending.get(response.id); if (!job) return;
    pending.delete(response.id); clearTimeout(job.timer);
    if (response.state) sync(response.state);
    if (response.ok) job.resolve(response);
    else { const error = new Error(response.message || '操作未能完成'); error.code = response.code; error.state = response.state; job.reject(error); }
  };
  window.__codexSidebarToolsReceive = receiver;
  function request(method, params = {}) {
    if (disposed) return Promise.reject(new Error('工具栏已关闭'));
    return new Promise((resolve, reject) => {
      const id = String(++requestSerial);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('工具后台暂未连接，请稍后重试。')); }, 8000);
      pending.set(id, {resolve, reject, timer});
      try { if (typeof window.__codexSidebarToolsRequest !== 'function') throw new Error('工具后台暂未连接'); window.__codexSidebarToolsRequest(JSON.stringify({id, method, params})); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async function saveNotes() {
    clearTimeout(saveTimer); if (!noteDirty || savingNotes || noteConflict || disposed) return;
    savingNotes = true; noteStatus.textContent = '保存中…'; let failed = false;
    const draft = noteDraft;
    try {
      const response = await request('saveNotes', {notes: draft, baseRevision: noteRevision});
      noteBase = draft; noteRevision = response.state.revision; noteDirty = noteDraft !== draft;
      noteStatus.textContent = noteDirty ? '等待保存…' : '已保存到本机'; message(noteMessage, '');
    } catch (error) {
      failed = true;
      noteStatus.textContent = '尚未保存';
      if (error.code === 'CONFLICT') { noteConflict = true; conflictActions.hidden = false; }
      message(noteMessage, error.message, true);
    } finally { savingNotes = false; if (noteDirty && !noteConflict && !failed) saveTimer = setTimeout(saveNotes, 1200); }
  }
  async function openShortcut(item) { try { await request('openShortcut', {id: item.id}); message(shortcutMessage, '已打开：' + item.label); } catch (error) { openPanel('shortcuts'); message(shortcutMessage, error.message, true); } }
  function renderShortcuts() {
    const signature = JSON.stringify(state.shortcuts); if (signature === shortcutsSignature) return; shortcutsSignature = signature;
    list.replaceChildren();
    if (!state.shortcuts.length) list.append(el('p', 'st-hint', '还没有快捷入口，在下面添加一个。'));
    for (const item of state.shortcuts) {
      const row = el('div', 'st-row'), open = el('button', 'st-open'), copy = el('span', 'st-open-copy'); open.type = 'button'; open.title = item.target;
      copy.append(el('strong', '', item.label), el('span', 'st-path', item.target)); open.append(icon(item.kind), copy); on(open, 'click', () => openShortcut(item));
      const edit = el('button', 'st-mini', '编辑'), remove = el('button', 'st-mini', '移除'); edit.type = remove.type = 'button';
      edit.setAttribute('aria-label', '编辑' + item.label); remove.setAttribute('aria-label', '移除' + item.label);
      on(edit, 'click', () => { editingShortcut = item.id; nameInput.value = item.label; kindInput.value = item.kind; targetInput.value = item.target; formTitle.textContent = '编辑入口'; shortcutSave.textContent = '保存修改'; shortcutCancel.hidden = false; nameInput.focus(); });
      on(remove, 'click', async () => { try { await request('deleteShortcut', {id: item.id}); if (editingShortcut === item.id) clearShortcutForm(); message(shortcutMessage, '入口已移除'); } catch (error) { message(shortcutMessage, error.message, true); } });
      row.append(open, edit, remove); list.append(row);
    }
  }
  function sync(next) {
    if (!next || next.revision < state.revision) return;
    // Do not replace another window's in-progress draft with a background sync.
    if (!noteDirty && !savingNotes) { noteDraft = noteBase = next.notes; noteRevision = next.revision; textarea.value = noteDraft; }
    else if (next.notes === noteBase) noteRevision = next.revision;
    state = next; renderShortcuts(); notesButton.dataset.hasNote = String(Boolean(next.notes.trim()) || noteDirty); refresh();
  }
  function refresh() {
    if (disposed) return;
    const quota = window.__codexSidebarQuota?.status?.() || {};
    const membership = membershipStatus(state.membership.expiresOn);
    const countdown = resetCountdown(quota.resetsAt, Date.now(), quota.stale);
    const signature = JSON.stringify([membership, countdown, quota.mode, quota.stale]);
    if (signature !== lastSignature) {
      lastSignature = signature; memberNumber.textContent = membership?.text || '未设置'; member.dataset.tone = membership?.tone || 'normal';
      member.title = membership?.title || '设置会员到期日'; member.setAttribute('aria-label', `会员${membership?.text || '未设置到期日'}，点击修改`);
      resetNumber.textContent = countdown.text; resetLabel.textContent = countdown.text === '待刷新' ? '额度重置' : '后重置';
      const resetDate = quota.resetsAt ? new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false}).format(quota.resetsAt * 1000) : '';
      reset.title = countdown.detail + (resetDate ? `\n${resetDate} 重置（北京时间）` : ''); reset.setAttribute('aria-label', reset.title);
    }
    place();
  }
  function place() {
    if (disposed || !document.body) return;
    const badge = document.getElementById('codex-sidebar-quota');
    if (!style.isConnected) (document.head || document.documentElement).append(style);
    if (!panel.isConnected) document.body.append(panel);
    if (!badge || !badge.parentElement?.matches('nav[data-app-navigation-rail]')) return;
    rail = badge.parentElement; badge.dataset.tools = '1';
    if (member.parentElement !== badge) badge.prepend(member);
    if (reset.parentElement !== badge) badge.append(reset);
    if (strip.parentElement !== rail || strip.nextElementSibling !== badge) rail.insertBefore(strip, badge);
    positionPanel();
  }
  const timer = setInterval(refresh, 1000);
  window[KEY] = {version: VERSION, sync, place,
    status() { return {version: VERSION, revision: state.revision, expiresOn: state.membership.expiresOn, membershipDays: membershipStatus(state.membership.expiresOn)?.days, memberText: memberNumber.textContent, resetText: resetNumber.textContent, shortcuts: state.shortcuts.length, panel: panel.hidden ? null : panelTab, noteDirty, noteConflict}; },
    destroy() {
      disposed = true; clearInterval(timer); clearTimeout(saveTimer); cleanups.forEach(cleanup => cleanup());
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('工具栏正在重新连接')); } pending.clear();
      strip.remove(); panel.remove(); member.remove(); reset.remove(); style.remove();
      document.getElementById('codex-sidebar-quota')?.removeAttribute('data-tools');
      if (window.__codexSidebarToolsReceive === receiver) delete window.__codexSidebarToolsReceive; delete window[KEY];
    }
  };
  renderShortcuts(); refresh();
}
function buildToolsScript(state) {
  return `(()=>{const membershipStatus=${membershipStatus.toString()};const resetCountdown=${resetCountdown.toString()};(${installSidebarTools.toString()})(${JSON.stringify(state).replaceAll('<','\\u003c')});})()`;
}
module.exports = {membershipStatus, resetCountdown, installSidebarTools, buildToolsScript};
