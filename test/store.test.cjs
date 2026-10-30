'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createToolsStore, isDateOnly} = require('../tools-store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sidebar-store-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const filePath = path.join(root, 'data', 'state.json');
  return {root, filePath, store: createToolsStore({filePath, homePath: root})};
}
test('date-only validation rejects rollover dates and accepts leap days', () => {
  assert.equal(isDateOnly('2031-03-15'), true);
  assert.equal(isDateOnly('2024-02-29'), true);
  for (const value of ['2026-02-29', '2026-11-31', '2026-1-1', '2031-03-15T00:00:00Z', null]) assert.equal(isDateOnly(value), false);
});
test('initial state is private, persists across instances, and rejects stale note saves', async t => {
  const {root, filePath, store} = fixture(t);
  const initial = store.getState();
  assert.equal(initial.membership.expiresOn, null);
  assert.deepEqual(initial.shortcuts, []);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(filePath)).mode & 0o777, 0o700);
  }
  const other = createToolsStore({filePath, homePath: root});
  const saved = await store.dispatch('saveNotes', {notes: '下一步：做封面\n再做分镜', baseRevision: initial.revision});
  assert.equal(other.getState().notes, saved.state.notes);
  await assert.rejects(other.dispatch('saveNotes', {notes: 'stale draft', baseRevision: 0}), error => error.code === 'CONFLICT' && error.state.notes === saved.state.notes);
  assert.equal(store.getState().notes, saved.state.notes);
  const updated = await other.dispatch('setMembership', {expiresOn: '2031-04-15'});
  assert.equal(store.getState().membership.expiresOn, updated.state.membership.expiresOn);
  await assert.rejects(store.dispatch('setMembership', {expiresOn: '2026-02-30'}), {code: 'INVALID_DATE'});
});
test('shortcut CRUD is literal and accepts only folders or safe web schemes', async t => {
  const {root, store} = fixture(t);
  const folder = path.join(root, 'folder $(touch injected)'); fs.mkdirSync(folder);
  let response = await store.dispatch('saveShortcut', {label: '素材', kind: 'folder', target: folder});
  const id = response.state.shortcuts[0].id;
  assert.equal(response.state.shortcuts[0].target, fs.realpathSync(folder));
  response = await store.dispatch('saveShortcut', {id, label: '新入口', kind: 'web', target: 'https://example.com/path?q=hello'});
  assert.equal(response.state.shortcuts.length, 1);
  assert.equal(response.state.shortcuts[0].kind, 'web');
  for (const target of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com', 'data:text/html,test']) {
    await assert.rejects(store.dispatch('saveShortcut', {label: 'bad', kind: 'web', target}), {code: 'INVALID_URL'});
  }
  await assert.rejects(store.dispatch('saveShortcut', {label: 'bad', kind: 'folder', target: '-a Google Chrome'}), {code: 'INVALID_FOLDER'});
  await assert.rejects(store.dispatch('openShortcut', {id: 'unknown'}), {code: 'NOT_FOUND'});
  response = await store.dispatch('deleteShortcut', {id});
  assert.equal(response.state.shortcuts.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'injected')), false);
});
test('damaged state and symlink state are never silently replaced', async t => {
  const {root, filePath, store} = fixture(t);
  store.getState();
  const damaged = '{broken JSON'; fs.writeFileSync(filePath, damaged);
  assert.throws(() => store.getState(), {code: 'STATE_CORRUPT'});
  await assert.rejects(store.dispatch('setMembership', {expiresOn: '2031-04-15'}), {code: 'STATE_CORRUPT'});
  assert.equal(fs.readFileSync(filePath, 'utf8'), damaged);
  const destination = path.join(root, 'unrelated.json');fs.writeFileSync(destination, 'unchanged');
  fs.unlinkSync(filePath);fs.symlinkSync(destination, filePath);
  assert.throws(() => store.getState(), {code: 'STATE_CORRUPT'});
  assert.equal(fs.readFileSync(destination, 'utf8'), 'unchanged');
});
