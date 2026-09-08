import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';
import {
  createRunner,
  findLatestArtifactDir,
  resolveMaestroBin,
} from '../src/runner.js';
import { createApp } from '../src/http.js';
import { newToken } from '../src/auth.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (sig) => {
    child._killedWith = sig;
    queueMicrotask(() => child.emit('close', 1));
  };
  return child;
}

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-runner-'));
  const db = openDb(path.join(dir, 't.db'));
  const store = createStore(db);
  // flow 路径必须真实存在：runner spawn 前会校验
  fs.mkdirSync(path.join(dir, 'maestro/todo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'maestro/todo/item-fast-add.yaml'), '# t\n');
  store.upsertFeature({
    code: '2.1',
    chapter: 2,
    title: '快速添加',
    criteria: '出现 E2E_Fast',
    precondition: '夹具 List',
    status: STATUS.PENDING_RUN,
  });
  store.insertFlow({
    feature_code: '2.1',
    path: 'maestro/todo/item-fast-add.yaml',
    kind: 'flow',
  });
  return { dir, db, store, repoRoot: dir };
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

describe('runner single slot + abort', () => {
  let env;
  let children;
  let spawnCalls;

  beforeEach(() => {
    env = tmpEnv();
    children = [];
    spawnCalls = [];
  });

  function spawnFn(bin, args, opts) {
    spawnCalls.push({ bin, args, opts });
    const child = makeFakeChild();
    children.push(child);
    return child;
  }

  it('single slot', () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const run = runner.start('2.1');
    assert.ok(run.id);
    assert.equal(spawnCalls.length, 1);
    assert.deepEqual(spawnCalls[0].args, [
      'test',
      'maestro/todo/item-fast-add.yaml',
    ]);

    assert.throws(() => runner.start('2.1'), /409/);
    assert.equal(spawnCalls.length, 1, 'second start must not spawn');
  });

  it('abort records non-zero exit', async () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const run = runner.start('2.1');
    assert.equal(env.store.getFeature('2.1', 'todo').status, STATUS.RUNNING);

    runner.abort();
    assert.equal(children[0]._killedWith, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(env.store.getFeature('2.1', 'todo').status, STATUS.FAILED);
    assert.equal(env.store.getActiveRun(), undefined);
    const row = env.db.prepare('SELECT exit_code FROM run WHERE id = ?').get(run.id);
    assert.notEqual(row.exit_code, 0);
  });

  it('close 0 marks passed and subscribe gets logs', async () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const run = runner.start('2.1');
    const lines = [];
    runner.subscribe(run.id, (c) => lines.push(c));
    children[0].stdout.emit('data', 'ok-line\n');
    children[0].emit('close', 0);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(lines, ['ok-line\n']);
    assert.equal(env.store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });

  it('spawn error records failure and releases the runner slot', async () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const run = runner.start('2.1');

    children[0].emit(
      'error',
      Object.assign(new Error('spawn maestro ENOENT'), { code: 'ENOENT' }),
    );
    // 部分 ChildProcess 在 error 后仍会 close；收尾必须幂等。
    children[0].emit('close', -2);
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(env.store.getFeature('2.1', 'todo').status, STATUS.FAILED);
    assert.equal(env.store.getActiveRun(), undefined);
    const row = env.db
      .prepare('SELECT exit_code, log_excerpt FROM run WHERE id = ?')
      .get(run.id);
    assert.equal(row.exit_code, 127);
    assert.match(row.log_excerpt, /ENOENT/);
  });

  it('findLatestArtifactDir returns string', () => {
    assert.equal(typeof findLatestArtifactDir(), 'string');
  });

  it('does not spawn when feature is not runnable', () => {
    env.store.upsertFeature({
      module: 'todo',
      code: '2.1',
      chapter: 2,
      title: 't',
      criteria: 'c',
      status: STATUS.PENDING_RUN,
      runnable: 0,
    });
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    assert.throws(() => runner.start('2.1', 'todo'), (e) => e.code === 'FLOW_MISSING');
    assert.equal(spawnCalls.length, 0);
  });

  it('manual feature is FEATURE_MANUAL, not FLOW_MISSING', () => {
    env.store.upsertFeature({
      module: 'todo',
      code: '2.1',
      chapter: 2,
      title: 't',
      criteria: 'c',
      status: STATUS.PENDING_RUN,
      runnable: 0,
      manual: 1,
    });
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    assert.throws(() => runner.start('2.1', 'todo'), (e) => e.code === 'FEATURE_MANUAL');
    assert.equal(spawnCalls.length, 0);
  });

  it('missing yaml file on disk is FLOW_MISSING and leaves no run row', () => {
    fs.rmSync(path.join(env.repoRoot, 'maestro/todo/item-fast-add.yaml'));
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    assert.throws(() => runner.start('2.1', 'todo'), (e) => e.code === 'FLOW_MISSING');
    assert.equal(spawnCalls.length, 0);
    assert.equal(env.store.getActiveRun(), undefined);
  });

  it('injects appId/device flags before flow path and uses appRoot cwd', () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
      appId: 'com.cozyla.choresreward',
      device: 'emulator-5554',
    });
    runner.start('2.1', 'todo');
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].opts.cwd, env.repoRoot);
    assert.deepEqual(spawnCalls[0].args, [
      'test',
      '-e',
      'APP_ID=com.cozyla.choresreward',
      '-e',
      'DEVICE=emulator-5554',
      'maestro/todo/item-fast-add.yaml',
    ]);
    children[0].emit('close', 0);
  });
});

describe('resolveMaestroBin', () => {
  it('prefers MAESTRO_BIN', () => {
    assert.equal(
      resolveMaestroBin({
        env: { MAESTRO_BIN: '/opt/maestro', PATH: '/usr/bin' },
        homeDir: '/Users/test',
        existsSync: () => false,
      }),
      '/opt/maestro',
    );
  });

  it('falls back to the standard Maestro install outside PATH', () => {
    assert.equal(
      resolveMaestroBin({
        env: { PATH: '/usr/bin' },
        homeDir: '/Users/test',
        existsSync: (candidate) =>
          candidate === '/Users/test/.maestro/bin/maestro',
      }),
      '/Users/test/.maestro/bin/maestro',
    );
  });
});

describe('runner HTTP routes', () => {
  let env;
  let token;
  let serverHandle;
  let children;

  beforeEach(() => {
    env = tmpEnv();
    token = newToken();
    children = [];
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
  });

  function spawnFn() {
    const child = makeFakeChild();
    children.push(child);
    return child;
  }

  it('POST run then second run is 409; stream needs token', async () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const app = createApp({
      store: env.store,
      appRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      runner,
    });
    serverHandle = await listen(app);
    const flow = env.store.listFlows('2.1')[0];

    const res1 = await fetch(`${serverHandle.base}/api/flows/${flow.id}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.ok(body1.run?.id);

    const res2 = await fetch(`${serverHandle.base}/api/flows/${flow.id}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res2.status, 409);

    const noTok = await fetch(
      `${serverHandle.base}/api/runs/${body1.run.id}/stream`,
    );
    assert.equal(noTok.status, 401);

    const withTok = await fetch(
      `${serverHandle.base}/api/runs/${body1.run.id}/stream?token=${token}`,
    );
    assert.equal(withTok.status, 200);
    assert.match(
      withTok.headers.get('content-type') || '',
      /text\/event-stream/,
    );
    withTok.body?.cancel();

    await fetch(`${serverHandle.base}/api/runs/abort`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise((r) => setTimeout(r, 20));
  });

  it('SSE replays buffered logs', async () => {
    const runner = createRunner({
      spawnFn,
      store: env.store,
      appRoot: env.repoRoot,
    });
    const run = runner.start('2.1');
    children[0].stdout.emit('data', 'pre\n');

    const app = createApp({
      store: env.store,
      appRoot: env.repoRoot,
      token,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      runner,
    });
    serverHandle = await listen(app);

    const res = await fetch(
      `${serverHandle.base}/api/runs/${run.id}/stream?token=${token}`,
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 500;
    while (Date.now() < deadline && !buf.includes('pre')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    assert.match(buf, /data:.*"pre\\n"/);
    await reader.cancel();
    children[0].emit('close', 0);
  });
});
