import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';
import { createApp } from '../src/http.js';
import { newToken } from '../src/auth.js';

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-http-'));
  const repoRoot = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repoRoot, 'maestro'), { recursive: true });
  const db = openDb(path.join(dir, 't.db'));
  const store = createStore(db);
  store.upsertFeature({
    code: '2.1',
    chapter: 2,
    title: '快速添加',
    criteria: '出现 E2E_Fast',
    precondition: '夹具 List',
    status: STATUS.PENDING_WRITE,
  });
  return { dir, repoRoot, store };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    server,
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
    },
  };
}

async function req(base, method, urlPath, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

describe('http API', () => {
  let env;
  let token;
  let serverHandle;

  beforeEach(() => {
    env = tmpEnv();
    token = newToken();
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
  });

  it('rejects missing token with 401', async () => {
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('should not run');
      },
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'GET', '/api/features');
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'unauthorized');
  });

  it('analyze stream replays hub logs and abort kills child', async () => {
    const { createAnalyzeHub } = await import('../src/analyzeHub.js');
    const hub = createAnalyzeHub();
    hub.push('hello ');
    hub.push('world');
    let killed = false;
    hub.setChild({ kill: () => (killed = true) });

    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('should not run');
      },
      analyzeHub: hub,
    });
    serverHandle = await listen(app);

    // SSE 回放：读第一段数据即可断开
    const res = await fetch(
      `${serverHandle.base}/api/analyze/stream?token=${token}`,
    );
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.match(text, /hello /);
    assert.match(text, /world/);
    await reader.cancel();

    const abortRes = await req(serverHandle.base, 'POST', '/api/analyze/abort', {
      token,
      body: {},
    });
    assert.equal(abortRes.status, 200);
    assert.equal(abortRes.json.killed, true);
    assert.equal(killed, true);
  });

  it('lists modules and filters features by module', async () => {
    env.store.upsertFeature({
      module: 'routine',
      code: '0.1',
      chapter: 0,
      title: 'routine placeholder',
      criteria: 'x',
      precondition: '',
      status: STATUS.MANUAL,
    });
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('should not run');
      },
    });
    serverHandle = await listen(app);
    const mods = await req(serverHandle.base, 'GET', '/api/modules', { token });
    assert.equal(mods.status, 200);
    assert.ok(mods.json.modules.some((m) => m.id === 'todo'));
    const todo = await req(serverHandle.base, 'GET', '/api/features?module=todo', {
      token,
    });
    assert.equal(todo.status, 200);
    assert.ok(todo.json.features.every((f) => f.module === 'todo'));
    const routine = await req(
      serverHandle.base,
      'GET',
      '/api/features?module=routine',
      { token },
    );
    assert.equal(routine.status, 200);
    assert.equal(routine.json.features.length, 1);
    assert.equal(routine.json.features[0].code, '0.1');
  });

  it('analyze with out-of-gate path returns 422 and writes no yaml', async () => {
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => ({
        rationale: 'bad',
        risks: [],
        files: [{ path: 'app/Evil.kt', content: 'nope' }],
        raw: '{}',
        prompt: 'p',
      }),
    });
    serverHandle = await listen(app);
    const res = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    assert.equal(res.status, 422);
    assert.equal(env.store.getPendingSession('2.1'), undefined);
    assert.equal(fs.existsSync(path.join(env.repoRoot, 'app', 'Evil.kt')), false);
    const yamlLeft = fs.readdirSync(path.join(env.repoRoot, 'maestro'));
    assert.deepEqual(yamlLeft, []);
  });

  it('analyze success creates pending session without changing status', async () => {
    const files = [
      {
        path: 'maestro/todo/item-fast-add.yaml',
        content: 'appId: com.cozyla.choresreward\n---\n- launchApp\n',
      },
    ];
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => ({
        rationale: 'ok',
        risks: ['r1'],
        files,
        raw: JSON.stringify({ rationale: 'ok', risks: ['r1'], files }),
        prompt: 'prompt-text',
      }),
    });
    serverHandle = await listen(app);
    const res = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    assert.equal(res.status, 200);
    const pending = env.store.getPendingSession('2.1');
    assert.ok(pending);
    assert.equal(pending.decision, 'pending');
    assert.equal(env.store.getFeature('2.1').status, STATUS.PENDING_WRITE);
    assert.ok(pending.diff.includes('maestro/todo/item-fast-add.yaml'));
    assert.equal(res.json.attempt.sequence, 1);
    assert.equal(pending.attempt_id, res.json.attempt.id);
  });

  it('persists regeneration and rejection notes as feature context', async () => {
    const files = [
      {
        path: 'maestro/todo/item-fast-add.yaml',
        content: 'appId: com.cozyla.choresreward\n---\n- launchApp\n',
      },
    ];
    let notesSeenByAnalyze = '';
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async ({ feature }) => {
        notesSeenByAnalyze = feature.notes;
        return {
          rationale: 'ok',
          risks: [],
          files,
          raw: '{}',
          prompt: 'p',
        };
      },
    });
    serverHandle = await listen(app);

    const analyzed = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      {
        token,
        body: {
          note: 'Profile 必须按不同成员形成不同卡片',
        },
      },
    );
    assert.equal(analyzed.status, 200);
    assert.match(
      notesSeenByAnalyze,
      /【回归备注】Profile 必须按不同成员形成不同卡片/,
    );

    const rejected = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/reject',
      {
        token,
        body: {
          sessionId: analyzed.json.session.id,
          note: '生成步骤仍然创建了两个 List',
        },
      },
    );
    assert.equal(rejected.status, 200);
    assert.match(
      env.store.getFeature('2.1').notes,
      /【回归备注】生成步骤仍然创建了两个 List/,
    );
  });

  it('reject closes one attempt and the next analyze starts another', async () => {
    const files = [
      {
        path: 'maestro/todo/item-fast-add.yaml',
        content: 'appId: com.cozyla.choresreward\n---\n- launchApp\n',
      },
    ];
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => ({
        rationale: 'ok',
        risks: [],
        files,
        raw: '{}',
        prompt: 'p',
      }),
    });
    serverHandle = await listen(app);

    const first = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    await req(serverHandle.base, 'POST', '/api/features/2.1/reject', {
      token,
      body: { sessionId: first.json.session.id },
    });
    const second = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );

    assert.equal(first.json.attempt.sequence, 1);
    assert.equal(second.json.attempt.sequence, 2);
    assert.equal(
      env.store.getAttemptDetail(first.json.attempt.id).status,
      'rejected',
    );

    const listed = await req(serverHandle.base, 'GET', '/api/features', {
      token,
    });
    const feature = listed.json.features.find((row) => row.code === '2.1');
    assert.deepEqual(
      feature.attempts.map((row) => row.sequence),
      [1, 2],
    );

    const detail = await req(
      serverHandle.base,
      'GET',
      `/api/attempts/${second.json.attempt.id}`,
      { token },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.json.attempt.analyzeSession.id, second.json.session.id);
  });

  it('apply writes yaml under tmp repoRoot and sets status 待执行', async () => {
    const files = [
      {
        path: 'maestro/todo/item-fast-add.yaml',
        content: 'appId: com.cozyla.choresreward\n---\n- launchApp\n',
      },
    ];
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => ({
        rationale: 'ok',
        risks: [],
        files,
        raw: '{}',
        prompt: 'p',
      }),
    });
    serverHandle = await listen(app);

    const analyzed = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    assert.equal(analyzed.status, 200);
    const sessionId = analyzed.json.session.id;

    const applied = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/apply',
      { token, body: { sessionId } },
    );
    assert.equal(applied.status, 200);

    const abs = path.join(env.repoRoot, 'maestro', 'todo', 'item-fast-add.yaml');
    assert.equal(fs.readFileSync(abs, 'utf8'), files[0].content);
    assert.equal(env.store.getFeature('2.1').status, STATUS.PENDING_RUN);
    const flows = env.store.listFlows('2.1');
    assert.ok(flows.some((f) => f.path === 'maestro/todo/item-fast-add.yaml' && f.kind === 'flow'));
    assert.equal(env.store.getPendingSession('2.1'), undefined);
  });

  it('re-diagnoses with a run-scoped hint and optionally saves it as a feature note', async () => {
    env.store.setStatus('2.1', STATUS.PENDING_RUN);
    env.store.insertFlow({
      feature_code: '2.1',
      path: 'maestro/todo/item-fast-add.yaml',
      kind: 'flow',
    });
    const attempt = env.store.createAttempt('2.1');
    const run = env.store.startRun('2.1', 'todo', attempt.id);
    env.store.finishRun(run.id, {
      exit_code: 1,
      failed_step: 'Tap on confirm',
      artifact_dir: '/tmp/artifacts',
      log_excerpt: 'FAILED',
    });
    env.store.createAiSession({
      feature_code: '2.1',
      provider: 'claude',
      kind: 'diagnose',
      prompt: 'p1',
      response: '首次诊断不确定',
      decision: 'recorded',
      run_id: run.id,
      attempt_id: attempt.id,
    });

    let received;
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      diagnoseFn: async (opts) => {
        received = opts;
        return { text: '结合提示判断是保存接口失败', prompt: 'p2' };
      },
    });
    serverHandle = await listen(app);

    const res = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/diagnose',
      {
        token,
        body: {
          hint: '弹窗已打开，但保存后没有关闭',
          saveAsFeatureNote: true,
        },
      },
    );

    assert.equal(res.status, 200);
    assert.equal(received.hint, '弹窗已打开，但保存后没有关闭');
    assert.equal(received.history.length, 1);
    assert.equal(received.history[0].response, '首次诊断不确定');

    const turns = env.store.listDiagnosesForRun(run.id);
    assert.equal(turns.length, 2);
    assert.equal(turns[1].user_hint, '弹窗已打开，但保存后没有关闭');
    assert.equal(turns[1].attempt_id, attempt.id);
    assert.match(env.store.getFeature('2.1').notes, /弹窗已打开/);

    const listed = await req(serverHandle.base, 'GET', '/api/features', {
      token,
    });
    const feature = listed.json.features.find((x) => x.code === '2.1');
    assert.equal(feature.diagnosisHistory.length, 2);
  });

  it('rejects an overlong diagnosis hint', async () => {
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      diagnoseFn: async () => {
        throw new Error('must not run');
      },
    });
    serverHandle = await listen(app);

    const res = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/diagnose',
      { token, body: { hint: 'x'.repeat(2001) } },
    );
    assert.equal(res.status, 400);
    assert.match(res.json.error, /最多 2000 字/);
  });

  it('second analyze is 409 while the first is still running', async () => {
    const { createAnalyzeHub } = await import('../src/analyzeHub.js');
    const hub = createAnalyzeHub();
    let releaseFirst;
    const firstStarted = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
      analyzeHub: hub,
      analyzeFn: async () => {
        await firstStarted;
        return {
          rationale: 'ok',
          risks: [],
          files: [
            {
              path: 'maestro/todo/item-fast-add.yaml',
              content: 'appId: com.cozyla.choresreward\n---\n- launchApp\n',
            },
          ],
          raw: '{}',
          prompt: 'p',
        };
      },
    });
    serverHandle = await listen(app);

    const first = req(serverHandle.base, 'POST', '/api/features/2.1/analyze', {
      token,
    });
    for (let i = 0; i < 50 && !hub.status().busy; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(hub.status().busy, true);
    const statusRes = await req(serverHandle.base, 'GET', '/api/analyze/status', {
      token,
    });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.busy, true);
    assert.equal(statusRes.json.kind, 'analyze');

    const second = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    assert.equal(second.status, 409);

    releaseFirst();
    const firstRes = await first;
    assert.equal(firstRes.status, 200);
    assert.equal(hub.status().busy, false);

    const third = await req(
      serverHandle.base,
      'POST',
      '/api/features/2.1/analyze',
      { token },
    );
    assert.equal(third.status, 200);
  });
});
