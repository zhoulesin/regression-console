import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { buildRetrySection } from '../src/contextPack.js';
import { STATUS } from '../src/constants.js';

function freshStore() {
  const db = openDb(':memory:');
  const store = createStore(db);
  store.upsertFeature({
    module: 'todo',
    code: '2.2',
    chapter: 2,
    title: '根页 Add 完整创建',
    criteria: '出现 E2E_Full',
    precondition: '有 1 个夹具 List',
    status: STATUS.PENDING_RUN,
  });
  store.insertFlow({
    feature_module: 'todo',
    feature_code: '2.2',
    path: 'maestro/todo/item-create.yaml',
    kind: 'flow',
  });
  return store;
}

describe('diagnose session does not block runs', () => {
  let store;
  beforeEach(() => {
    store = freshStore();
  });

  it('kind=diagnose is not treated as a pending approval', () => {
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.2',
      provider: 'claude',
      kind: 'diagnose',
      prompt: 'p',
      response: '诊断：id 绑错了',
      decision: 'recorded',
      run_id: 1,
    });

    assert.equal(store.getPendingSession('2.2', 'todo'), undefined);
    // 关键：诊断记录不能把执行卡住
    assert.doesNotThrow(() => store.assertCanRun('2.2', 'todo'));
  });

  it('kind=analyze with decision=pending still blocks runs', () => {
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.2',
      provider: 'claude',
      kind: 'analyze',
      prompt: 'p',
      response: 'r',
      diff: 'd',
    });
    assert.throws(() => store.assertCanRun('2.2', 'todo'), /pending/);
  });

  it('getLatestDiagnosis returns the newest diagnose session only', () => {
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.2',
      provider: 'claude',
      kind: 'diagnose',
      prompt: 'p',
      response: '第一次诊断',
      decision: 'recorded',
    });
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.2',
      provider: 'claude',
      kind: 'analyze',
      prompt: 'p',
      response: '生成脚本',
      diff: 'd',
    });
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.2',
      provider: 'claude',
      kind: 'diagnose',
      prompt: 'p',
      response: '第二次诊断',
      decision: 'recorded',
    });

    assert.equal(store.getLatestDiagnosis('2.2', 'todo').response, '第二次诊断');
  });

  it('getLatestRun returns the newest finished run for the feature', () => {
    const run = store.startRun('2.2', 'todo');
    store.finishRun(run.id, {
      exit_code: 1,
      failed_step: 'Assert that "E2E Todo" is visible',
      artifact_dir: '/tmp/a',
      log_excerpt: 'log',
    });
    const latest = store.getLatestRun('2.2', 'todo');
    assert.equal(latest.id, run.id);
    assert.equal(latest.exit_code, 1);
    assert.equal(latest.failed_step, 'Assert that "E2E Todo" is visible');
  });

  it('lists only diagnosis turns for the requested run in chronological order', () => {
    for (const [runId, hint, response] of [
      [7, '', '首次诊断'],
      [7, '弹窗已经打开', '第二次诊断'],
      [8, '另一次失败', '不应出现'],
    ]) {
      store.createAiSession({
        feature_module: 'todo',
        feature_code: '2.2',
        provider: 'claude',
        kind: 'diagnose',
        prompt: 'p',
        response,
        decision: 'recorded',
        run_id: runId,
        user_hint: hint,
      });
    }

    const turns = store.listDiagnosesForRun(7);
    assert.deepEqual(
      turns.map((x) => [x.user_hint, x.response]),
      [
        ['', '首次诊断'],
        ['弹窗已经打开', '第二次诊断'],
      ],
    );
  });

  it('keeps only the latest five diagnosis turns for prompt context', () => {
    for (let i = 1; i <= 7; i += 1) {
      store.createAiSession({
        feature_module: 'todo',
        feature_code: '2.2',
        provider: 'claude',
        kind: 'diagnose',
        prompt: 'p',
        response: `诊断 ${i}`,
        decision: 'recorded',
        run_id: 7,
        user_hint: `线索 ${i}`,
      });
    }

    assert.deepEqual(
      store.listDiagnosesForRun(7, 5).map((x) => x.response),
      ['诊断 3', '诊断 4', '诊断 5', '诊断 6', '诊断 7'],
    );
  });

  it('appends an explicitly saved hint to feature notes', () => {
    store.appendFeatureNote('2.2', 'todo', '真机弹窗没有关闭');
    assert.match(
      store.getFeature('2.2', 'todo').notes,
      /【诊断线索】真机弹窗没有关闭/,
    );
  });
});

describe('buildRetrySection feeds the diagnosis back', () => {
  it('carries failed step and diagnosis into the prompt', () => {
    const s = buildRetrySection({
      run: { failed_step: 'Assert that "E2E Todo", id: txtTodoListName is visible' },
      diagnosis: { response: 'E2E Todo 在 txtTodoListDesc，不在 txtTodoListName' },
    });
    assert.match(s, /上一轮尝试失败/);
    assert.match(s, /txtTodoListName is visible/);
    assert.match(s, /txtTodoListDesc/);
    assert.match(s, /不要重复上一轮已被证明错误的选择器/);
  });

  it('returns empty string when there is no history', () => {
    assert.equal(buildRetrySection({ run: null, diagnosis: null }), '');
    assert.equal(buildRetrySection({}), '');
  });

  it('works with only a failed step', () => {
    const s = buildRetrySection({ run: { failed_step: 'Tap on foo' } });
    assert.match(s, /Tap on foo/);
  });
});
