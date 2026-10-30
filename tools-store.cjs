'use strict';
// Local customization for Codex Usage Card. No shell execution or network uploads.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {openTarget} = require('./platform.cjs');

const LIMITS = Object.freeze({notes: 20000, shortcuts: 12, label: 40, target: 4096, stateBytes: 131072});

function failure(code, message, state) {
  const error = new Error(message);
  error.code = code;
  if (state) error.state = state;
  return error;
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateDate(value) {
  if (!isDateOnly(value) || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2200) {
    throw failure('INVALID_DATE', '请输入有效日期，格式为 YYYY-MM-DD。');
  }
  return value;
}
function stringField(value, max, label, {allowNewlines = false} = {}) {
  if (typeof value !== 'string' || value.length > max || (allowNewlines ? /\0/ : /[\x00-\x1f\x7f]/).test(value)) {
    throw failure('INVALID_INPUT', `${label}格式不正确或内容过长。`);
  }
  return value;
}
function normalizeWebTarget(value) {
  stringField(value, 2048, '网址');
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw failure('INVALID_URL', '请输入完整的 http 或 https 网址。'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw failure('INVALID_URL', '仅支持不含用户名和密码的 http 或 https 网址。');
  }
  return parsed.href;
}
function validateId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw failure('INVALID_INPUT', '快捷入口标识不正确。');
  return value;
}
function createToolsStore({filePath, homePath = os.homedir()} = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('filePath must be absolute');
  const parent = path.dirname(filePath);
  const home = path.resolve(homePath);

  function normalizeFolderTarget(value, mustExist) {
    stringField(value, LIMITS.target, '文件夹路径');
    const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
    if (!path.isAbsolute(expanded)) throw failure('INVALID_FOLDER', '请输入文件夹的绝对路径，或使用 ~/ 开头的路径。');
    const absolute = path.normalize(expanded);
    if (!mustExist) return absolute;
    try {
      const real = fs.realpathSync(absolute);
      if (!fs.statSync(real).isDirectory()) throw new Error('not a directory');
      return real;
    } catch { throw failure('INVALID_FOLDER', '文件夹不存在或无法访问。'); }
  }
  function validateShortcut(value, mustExist = false) {
    if (!isRecord(value)) throw failure('INVALID_INPUT', '快捷入口格式不正确。');
    const label = stringField(value.label, LIMITS.label, '入口名称').trim();
    if (!label) throw failure('INVALID_INPUT', '请填写入口名称。');
    if (!['folder', 'web'].includes(value.kind)) throw failure('INVALID_INPUT', '请选择文件夹或网页。');
    const target = value.kind === 'web' ? normalizeWebTarget(value.target) : normalizeFolderTarget(value.target, mustExist);
    return {id: validateId(value.id), label, kind: value.kind, target};
  }
  function validateState(value) {
    if (!isRecord(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !isRecord(value.membership) || value.membership.timeZone !== 'Asia/Shanghai' ||
      !Array.isArray(value.shortcuts) || value.shortcuts.length > LIMITS.shortcuts) throw new Error('invalid state');
    const expiresOn = value.membership.expiresOn == null ? null : validateDate(value.membership.expiresOn);
    const notes = stringField(value.notes, LIMITS.notes, '便签', {allowNewlines: true});
    const shortcuts = value.shortcuts.map(item => validateShortcut(item));
    if (new Set(shortcuts.map(item => item.id)).size !== shortcuts.length) throw new Error('duplicate ids');
    return {revision: value.revision, membership: {expiresOn, timeZone: 'Asia/Shanghai'}, notes, shortcuts};
  }
  function prepareDirectory() {
    fs.mkdirSync(parent, {recursive: true, mode: 0o700});
    const stat = fs.lstatSync(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('UNSAFE_PATH', '工具栏数据目录不正确。');
    fs.chmodSync(parent, 0o700);
  }
  function initialState() {
    return {revision:0,membership:{expiresOn:null,timeZone:'Asia/Shanghai'},notes:'',shortcuts:[]};
  }
  function readExisting() {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > LIMITS.stateBytes) {
      throw failure('STATE_CORRUPT', '工具栏数据格式异常，已保留原文件，请先检查数据文件。');
    }
    try { return validateState(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
    catch (error) {
      if (error.code === 'EACCES') throw failure('STATE_UNREADABLE', '无法读取工具栏数据，请检查文件权限。');
      throw failure('STATE_CORRUPT', '工具栏数据格式异常，已保留原文件，请先检查数据文件。');
    }
  }
  function getState() {
    try { return readExisting(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      prepareDirectory();
      const value = initialState();
      try {
        const descriptor = fs.openSync(filePath, 'wx', 0o600);
        try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        return value;
      } catch (created) {
        if (created.code === 'EEXIST') return readExisting();
        throw created;
      }
    }
  }
  function saveState(value) {
    const validated = validateState(value);
    if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > LIMITS.stateBytes) throw failure('STATE_TOO_LARGE', '数据过大，请减少便签或入口数量。');
    prepareDirectory();
    const temporary = path.join(parent, '.' + path.basename(filePath) + '.' + randomUUID() + '.tmp');
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(validated, null, 2) + '\n');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, filePath);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return validated;
  }
  async function dispatch(method, params = {}) {
    if (!isRecord(params)) throw failure('INVALID_INPUT', '操作参数不正确。');
    const state = getState();
    if (method === 'getState') return {state};
    if (method === 'saveNotes') {
      const notes = stringField(params.notes, LIMITS.notes, '便签', {allowNewlines: true});
      if (!Number.isSafeInteger(params.baseRevision) || params.baseRevision !== state.revision) {
        throw failure('CONFLICT', '另一个窗口已更新工具栏数据。你的草稿已保留，请重新核对后保存。', state);
      }
      if (notes === state.notes) return {state};
      return {state: saveState({...state, revision: state.revision + 1, notes})};
    }
    if (method === 'setMembership') {
      const expiresOn = params.expiresOn == null || params.expiresOn === '' ? null : validateDate(params.expiresOn);
      return {state: saveState({...state, revision: state.revision + 1, membership: {expiresOn, timeZone: 'Asia/Shanghai'}})};
    }
    if (method === 'saveShortcut') {
      if (params.id !== undefined) validateId(params.id);
      const id = params.id || randomUUID();
      const index = state.shortcuts.findIndex(item => item.id === id);
      if (params.id && index < 0) throw failure('NOT_FOUND', '这个快捷入口已不存在，请刷新后重试。');
      if (index < 0 && state.shortcuts.length >= LIMITS.shortcuts) throw failure('LIMIT_REACHED', `最多可保存 ${LIMITS.shortcuts} 个快捷入口。`);
      const shortcut = validateShortcut({...params, id}, true);
      const shortcuts = [...state.shortcuts];
      if (index < 0) shortcuts.push(shortcut); else shortcuts[index] = shortcut;
      return {state: saveState({...state, revision: state.revision + 1, shortcuts})};
    }
    if (method === 'deleteShortcut') {
      const id = validateId(params.id);
      if (!state.shortcuts.some(item => item.id === id)) throw failure('NOT_FOUND', '这个快捷入口已不存在。');
      return {state: saveState({...state, revision: state.revision + 1, shortcuts: state.shortcuts.filter(item => item.id !== id)})};
    }
    if (method === 'openShortcut') {
      const id = validateId(params.id);
      const shortcut = state.shortcuts.find(item => item.id === id);
      if (!shortcut) throw failure('NOT_FOUND', '这个快捷入口已不存在。');
      try {
        const target = shortcut.kind === 'web' ? normalizeWebTarget(shortcut.target) : normalizeFolderTarget(shortcut.target, true);
        await openTarget(shortcut.kind, target);
      } catch (error) {
        if (['INVALID_URL', 'INVALID_FOLDER'].includes(error.code)) throw error;
        throw failure('OPEN_FAILED', shortcut.kind === 'web' ? '未能打开网页，请检查 Google Chrome 是否可用。' : '未能打开文件夹，请检查路径和访问权限。');
      }
      return {opened: true, state};
    }
    throw failure('UNKNOWN_METHOD', '不支持这个工具栏操作。');
  }
  return {getState, dispatch};
}

module.exports = {createToolsStore, isDateOnly, LIMITS};
