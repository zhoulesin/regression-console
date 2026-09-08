import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  const db = openDb(path.join(dir, 't.db'));
  return createStore(db);
}

describe('store status machine', () => {
  let store;
  beforeEach(() => {
    store = tmpStore();
    store.upsertFeature({
      code: '2.1',
      chapter: 2,
      title: '快速添加',
      criteria: '出现 E2E_Fast',
      precondition: '夹具 List',
      status: STATUS.PENDING_WRITE,
    });
  });

  it('rejects run when status is 待写', () => {
    assert.throws(() => store.assertCanRun('2.1'), /待执行/);
  });

  it('allows run after 待执行 and blocks second run', () => {
    store.setStatus('2.1', STATUS.PENDING_RUN);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    const run1 = store.startRun('2.1');
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.RUNNING);
    assert.throws(() => store.startRun('2.1'), /409/);
    store.finishRun(run1.id, { exit_code: 0, log_excerpt: 'ok' });
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });

  it('finishRun non-zero marks 失败', () => {
    store.setStatus('2.1', STATUS.PENDING_RUN);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    const run = store.startRun('2.1');
    store.finishRun(run.id, { exit_code: 1, failed_step: 'tapOn', log_excerpt: 'FAIL' });
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.FAILED);
  });

  it('allows startRun when status is 失败 after insertFlow', () => {
    store.setStatus('2.1', STATUS.FAILED);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    assert.doesNotThrow(() => store.assertCanRun('2.1'));
    const run = store.startRun('2.1');
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.RUNNING);
    store.finishRun(run.id, { exit_code: 0, log_excerpt: 'retry ok' });
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });

  it('allows assertCanRun and startRun when status is 通过', () => {
    store.setStatus('2.1', STATUS.PASSED);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    assert.doesNotThrow(() => store.assertCanRun('2.1'));
    const run = store.startRun('2.1');
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.RUNNING);
    store.finishRun(run.id, { exit_code: 0, log_excerpt: 'rerun ok' });
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });

  it('blocks assertCanRun for 运行中 / 留手测 / 假绿', () => {
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    store.setStatus('2.1', STATUS.RUNNING);
    assert.throws(() => store.assertCanRun('2.1'), /运行中/);
    store.setStatus('2.1', STATUS.MANUAL);
    assert.throws(() => store.assertCanRun('2.1'), /留手测/);
    store.setStatus('2.1', STATUS.FALSE_GREEN);
    assert.throws(() => store.assertCanRun('2.1'), /假绿/);
  });

  it('blocks run when pending ai_session exists', () => {
    store.setStatus('2.1', STATUS.PENDING_RUN);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    store.createAiSession({
      feature_code: '2.1',
      provider: 'test',
      prompt: 'write flow',
      response: 'done',
    });
    assert.throws(() => store.assertCanRun('2.1'), /pending.*AI session|待执行/);
    assert.throws(() => store.startRun('2.1'), /pending.*AI session|待执行/);
  });

  it('blocks run when no kind=flow exists', () => {
    store.setStatus('2.1', STATUS.PENDING_RUN);
    assert.throws(() => store.assertCanRun('2.1'), /flow/);
    assert.throws(() => store.startRun('2.1'), /flow/);
  });

  it('allows same code in different modules', () => {
    store.upsertFeature({
      module: 'todo',
      code: '0.1',
      chapter: 0,
      title: 'todo cold',
      criteria: 'x',
      precondition: '',
      status: STATUS.PENDING_WRITE,
    });
    store.upsertFeature({
      module: 'routine',
      code: '0.1',
      chapter: 0,
      title: 'routine cold',
      criteria: 'y',
      precondition: '',
      status: STATUS.MANUAL,
    });
    assert.equal(store.getFeature('0.1', 'todo').title, 'todo cold');
    assert.equal(store.getFeature('0.1', 'routine').title, 'routine cold');
    assert.equal(store.listFeatures('todo').filter((f) => f.code === '0.1').length, 1);
    assert.equal(store.listFeatures('routine').length, 1);
  });

  it('upsertFlow keeps one binding and last path wins', () => {
    store.upsertFeature({
      code: '0.2',
      chapter: 0,
      title: '杀进程再进仍是登录态',
      criteria: '同上，且不清数据',
      precondition: '无数据前提',
      status: STATUS.PENDING_RUN,
    });
    store.upsertFlow({
      feature_code: '0.2',
      path: 'maestro/kill-relaunch.yaml',
      kind: 'flow',
    });
    store.upsertFlow({
      feature_code: '0.2',
      path: 'maestro/cold-launch-retain-login.yaml',
      kind: 'flow',
    });
    const flows = store.listFlows('0.2');
    assert.equal(flows.length, 1);
    assert.equal(flows[0].path, 'maestro/cold-launch-retain-login.yaml');
  });
});

describe('store snapshot flags', () => {
  let store;
  beforeEach(() => {
    store = tmpStore();
  });

  it('defaults to hidden=0 runnable=1 manual=0', () => {
    store.upsertFeature({
      module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c',
      status: STATUS.PENDING_RUN,
    });
    const row = store.getFeature('2.1', 'todo');
    assert.equal(row.hidden, 0);
    assert.equal(row.runnable, 1);
    assert.equal(row.manual, 0);
  });

  it('hides features not in the keep set and listFeatures skips them', () => {
    store.upsertFeature({
      module: 'todo', code: '2.1', chapter: 2, title: 'a', criteria: 'c',
      status: STATUS.PENDING_RUN,
    });
    store.upsertFeature({
      module: 'todo', code: '9.1', chapter: 9, title: 'b', criteria: 'c',
      status: STATUS.PENDING_RUN,
    });
    store.hideFeaturesNotIn([{ module: 'todo', code: '2.1' }]);
    const listed = store.listFeatures('todo').map((r) => r.code);
    assert.ok(!listed.includes('9.1'), '9.1 应从列表消失');
    assert.ok(listed.includes('2.1'));
    assert.equal(store.getFeature('9.1', 'todo').hidden, 1);
  });

  it('a hidden feature comes back when the manifest lists it again', () => {
    store.upsertFeature({
      module: 'todo', code: '9.1', chapter: 9, title: 'b', criteria: 'c',
      status: STATUS.PASSED, notes: 'keep-me',
    });
    store.hideFeaturesNotIn([]);
    assert.equal(store.listFeatures('todo').length, 0);
    assert.equal(store.getFeature('9.1', 'todo').hidden, 1);

    store.upsertFeature({
      module: 'todo', code: '9.1', chapter: 9, title: 'b', criteria: 'c', hidden: 0,
    });
    const row = store.getFeature('9.1', 'todo');
    assert.equal(row.hidden, 0);
    assert.equal(row.status, STATUS.PASSED, 'status 属于控制台，不被 sync 覆盖');
    assert.equal(row.notes, 'keep-me', 'notes 属于控制台，不被 sync 清空');
  });

  it('upsert does not overwrite existing status or notes', () => {
    store.upsertFeature({
      module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c',
      status: STATUS.PENDING_RUN, notes: 'keep-me',
    });
    store.setStatus('2.1', STATUS.PASSED, 'todo');
    store.upsertFeature({
      module: 'todo', code: '2.1', chapter: 2, title: 't2', criteria: 'c2',
      status: STATUS.PENDING_RUN,
    });
    const row = store.getFeature('2.1', 'todo');
    assert.equal(row.status, STATUS.PASSED);
    assert.equal(row.notes, 'keep-me');
    assert.equal(row.title, 't2', '目录字段仍应更新');
  });

  it('manual feature stays visible but is not runnable', () => {
    store.upsertFeature({
      module: 'todo', code: '1.6', chapter: 1, title: '数量上限', criteria: 'c',
      status: STATUS.MANUAL, runnable: 0, manual: 1,
    });
    const row = store.getFeature('1.6', 'todo');
    assert.equal(row.manual, 1);
    assert.equal(row.runnable, 0);
    assert.ok(
      store.listFeatures('todo').map((r) => r.code).includes('1.6'),
      '人工项仍要在看板上可见',
    );
  });

  it('setFeatureHidden toggles visibility both ways', () => {
    store.upsertFeature({
      module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c',
      status: STATUS.PENDING_RUN,
    });
    store.setFeatureHidden('todo', '2.1', 1);
    assert.equal(store.listFeatures('todo').length, 0);
    store.setFeatureHidden('todo', '2.1', 0);
    assert.equal(store.listFeatures('todo').length, 1);
  });

  it('listModules skips hidden modules', () => {
    store.upsertModule({ id: 'todo', title: 'Todo', hidden: 0 });
    store.upsertModule({ id: 'gone', title: 'Gone', hidden: 1 });
    assert.deepEqual(store.listModules().map((m) => m.module), ['todo']);
  });

  it('hideModulesNotIn hides everything else', () => {
    store.upsertModule({ id: 'todo', title: 'Todo', hidden: 0 });
    store.upsertModule({ id: 'gone', title: 'Gone', hidden: 0 });
    store.hideModulesNotIn(['todo']);
    assert.deepEqual(store.listModules().map((m) => m.module), ['todo']);
  });
});
