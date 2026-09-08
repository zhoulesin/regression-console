import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';

function freshStore() {
  const store = createStore(openDb(':memory:'));
  store.upsertFeature({
    module: 'todo',
    code: '2.1',
    chapter: 2,
    title: '卡片内快速添加',
    criteria: '新增 Todo 出现在目标卡片内',
    precondition: '已有夹具 List',
    status: STATUS.PENDING_RUN,
  });
  store.insertFlow({
    feature_module: 'todo',
    feature_code: '2.1',
    path: 'maestro/todo/item-fast-add.yaml',
    kind: 'flow',
  });
  return store;
}

describe('workflow attempts', () => {
  let store;

  beforeEach(() => {
    store = freshStore();
  });

  it('creates monotonically numbered attempts per feature', () => {
    const first = store.createAttempt('2.1', 'todo');
    const second = store.createAttempt(
      '2.1',
      'todo',
      '保存后弹窗没有关闭',
    );

    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.hint, '保存后弹窗没有关闭');
    assert.equal(store.getCurrentAttempt('2.1', 'todo').id, second.id);
  });

  it('attaches analyze sessions and runs to one attempt', () => {
    const attempt = store.createAttempt('2.1', 'todo');
    const session = store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.1',
      provider: 'claude',
      kind: 'analyze',
      prompt: 'prompt',
      response: '{"files":[]}',
      diff: 'diff',
      decision: 'approved',
      attempt_id: attempt.id,
    });
    store.setAttemptAnalyzeSession(attempt.id, session.id);
    const run = store.startRun('2.1', 'todo', attempt.id);

    const detail = store.getAttemptDetail(attempt.id);
    assert.equal(detail.analyzeSession.id, session.id);
    assert.equal(detail.runs[0].id, run.id);
    assert.equal(detail.runs[0].attempt_id, attempt.id);
    assert.deepEqual(detail.diagnoses, []);
  });

  it('returns lightweight timeline summaries', () => {
    const attempt = store.createAttempt('2.1', 'todo');
    const session = store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.1',
      provider: 'claude',
      kind: 'analyze',
      prompt: 'large prompt must stay out of summary',
      response: '{"files":[]}',
      decision: 'approved',
      attempt_id: attempt.id,
    });
    store.setAttemptAnalyzeSession(attempt.id, session.id);
    const run = store.startRun('2.1', 'todo', attempt.id);
    store.finishRun(run.id, { exit_code: 1, log_excerpt: 'FAILED' });
    store.createAiSession({
      feature_module: 'todo',
      feature_code: '2.1',
      provider: 'claude',
      kind: 'diagnose',
      prompt: 'p',
      response: '脚本断言范围错误',
      decision: 'recorded',
      run_id: run.id,
      attempt_id: attempt.id,
    });

    const summary = store.listAttempts('2.1', 'todo')[0];
    assert.equal(summary.analyze_decision, 'approved');
    assert.equal(summary.run_count, 1);
    assert.equal(summary.failed_run_count, 1);
    assert.equal(summary.latest_run.id, run.id);
    assert.equal(summary.diagnosis_count, 1);
    assert.equal(summary.prompt, undefined);
  });

  it('lists attempts in sequence order and records terminal state', () => {
    const first = store.createAttempt('2.1', 'todo');
    store.setAttemptStatus(first.id, 'rejected', true);
    const second = store.createAttempt('2.1', 'todo');

    assert.deepEqual(
      store.listAttempts('2.1', 'todo').map((row) => row.sequence),
      [1, 2],
    );
    assert.ok(store.getAttemptDetail(first.id).ended_at);
    assert.equal(store.getAttemptDetail(second.id).ended_at, null);
  });
});

describe('workflow attempt migration', () => {
  it('backfills an old analyze, run and diagnosis into one attempt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attempt-migration-'));
    const dbPath = path.join(dir, 'old.db');
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE feature (
        id INTEGER PRIMARY KEY, module TEXT NOT NULL, code TEXT NOT NULL,
        chapter INTEGER NOT NULL, title TEXT NOT NULL, criteria TEXT NOT NULL,
        precondition TEXT NOT NULL, status TEXT NOT NULL, notes TEXT NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(module, code)
      );
      CREATE TABLE flow (
        id INTEGER PRIMARY KEY, feature_module TEXT NOT NULL,
        feature_code TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE run (
        id INTEGER PRIMARY KEY, flow_id INTEGER NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, duration_ms INTEGER,
        exit_code INTEGER, failed_step TEXT, artifact_dir TEXT, log_excerpt TEXT
      );
      CREATE TABLE ai_session (
        id INTEGER PRIMARY KEY, feature_module TEXT NOT NULL,
        feature_code TEXT NOT NULL, provider TEXT NOT NULL,
        kind TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL,
        diff TEXT NOT NULL, decision TEXT NOT NULL, run_id INTEGER,
        user_hint TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO feature VALUES
        (1, 'todo', '2.1', 2, '快速添加', 'criteria', '', '失败', '', '2026-09-08T10:00:00Z');
      INSERT INTO flow VALUES
        (1, 'todo', '2.1', 'maestro/todo/item-fast-add.yaml', 'flow', '2026-09-08T10:00:00Z');
      INSERT INTO run VALUES
        (1, 1, '2026-09-08T10:02:00Z', '2026-09-08T10:03:00Z', 60000, 1, 'assert', '/tmp/a', 'FAILED');
      INSERT INTO ai_session VALUES
        (1, 'todo', '2.1', 'claude', 'analyze', 'p', '{}', 'd', 'approved', NULL, '', '2026-09-08T10:01:00Z'),
        (2, 'todo', '2.1', 'claude', 'diagnose', 'p', '断言错', '', 'recorded', 1, '', '2026-09-08T10:04:00Z');
    `);
    old.close();

    const store = createStore(openDb(dbPath));
    const attempts = store.listAttempts('2.1', 'todo');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'failed');
    const detail = store.getAttemptDetail(attempts[0].id);
    assert.equal(detail.analyzeSession.id, 1);
    assert.equal(detail.runs[0].id, 1);
    assert.equal(detail.diagnoses[0].id, 2);
  });

  it('dedupes duplicate flow bindings and keeps the newest row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-flow-'));
    const dbPath = path.join(dir, 'old.db');
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE feature (
        id INTEGER PRIMARY KEY,
        module TEXT NOT NULL,
        code TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        title TEXT NOT NULL,
        criteria TEXT NOT NULL,
        precondition TEXT NOT NULL,
        status TEXT NOT NULL,
        notes TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(module, code)
      );
      CREATE TABLE flow (
        id INTEGER PRIMARY KEY,
        feature_module TEXT NOT NULL,
        feature_code TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO feature VALUES
        (1, 'todo', '0.2', 0, '杀进程再进仍是登录态', 'x', '', '通过', '', '2026-09-08T10:00:00Z');
      INSERT INTO flow VALUES
        (2, 'todo', '0.2', 'maestro/kill-relaunch.yaml', 'flow', '2026-09-08T10:00:00Z'),
        (16, 'todo', '0.2', 'maestro/cold-launch-retain-login.yaml', 'flow', '2026-09-08T11:00:00Z');
    `);
    old.close();

    const store = createStore(openDb(dbPath));
    const flows = store.listFlows('0.2', 'todo');
    assert.equal(flows.length, 1);
    assert.equal(flows[0].path, 'maestro/cold-launch-retain-login.yaml');
  });
});
