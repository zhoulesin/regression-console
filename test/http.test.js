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
  // 模块目录只来自清单：没有 upsert 就不该出现在 /api/modules
  store.upsertModule({ id: 'todo', title: 'Todo' });
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
      appRoot: env.repoRoot,
      token,
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'GET', '/api/features');
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'unauthorized');
  });

  it('lists modules and filters features by module', async () => {
    env.store.upsertModule({ id: 'routine', title: 'Routine' });
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
      appRoot: env.repoRoot,
      token,
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

  it('POST /api/modules is 410', async () => {
    const app = createApp({
      store: env.store,
      appRoot: env.repoRoot,
      token,
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'POST', '/api/modules', {
      token,
      body: { id: 'shopping', title: '购物清单' },
    });
    assert.equal(res.status, 410);
    assert.equal(res.json.code, 'GONE');
  });

  it('POST /api/features and PATCH /api/features/:code are 410', async () => {
    const app = createApp({
      store: env.store,
      appRoot: env.repoRoot,
      token,
    });
    serverHandle = await listen(app);
    const created = await req(serverHandle.base, 'POST', '/api/features', {
      token,
      body: { code: '3.1', chapter: 3, title: 't', criteria: 'c' },
    });
    assert.equal(created.status, 410);
    assert.equal(created.json.code, 'GONE');
    const patched = await req(
      serverHandle.base,
      'PATCH',
      '/api/features/2.1?module=todo',
      { token, body: { title: 'x' } },
    );
    assert.equal(patched.status, 410);
    assert.equal(patched.json.code, 'GONE');
  });

  it('POST /api/export is 410', async () => {
    let exported = false;
    const app = createApp({
      store: env.store,
      appRoot: env.repoRoot,
      token,
      exportFn: () => {
        exported = true;
      },
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'POST', '/api/export', {
      token,
      body: {},
    });
    assert.equal(res.status, 410);
    assert.equal(res.json.code, 'GONE');
    assert.equal(exported, false);
  });

  it('GET /features without module is 400 FEATURE_MODULE_REQUIRED', async () => {
    const app = createApp({ store: env.store, appRoot: env.repoRoot, token });
    serverHandle = await listen(app);
    const { status, json } = await req(
      serverHandle.base,
      'GET',
      '/api/features',
      { token },
    );
    assert.equal(status, 400);
    assert.equal(json.code, 'FEATURE_MODULE_REQUIRED');
  });

  it('POST /sync loads fixture manifest', async () => {
    const appRoot = path.resolve(import.meta.dirname, 'fixtures/app');
    const app = createApp({
      store: env.store,
      appRoot,
      token,
      manifestPath: 'regression.manifest.json',
    });
    serverHandle = await listen(app);
    const syncRes = await req(serverHandle.base, 'POST', '/api/sync', {
      token,
    });
    assert.equal(syncRes.status, 200);
    const { status, json } = await req(
      serverHandle.base,
      'GET',
      '/api/features?module=todo',
      { token },
    );
    assert.equal(status, 200);
    assert.equal(json.features.find((f) => f.code === '2.1').runnable, true);
    assert.equal(json.features.find((f) => f.code === '2.2').runnable, false);
  });

  it('POST /sync without appRoot is NO_APP_ROOT', async () => {
    const app = createApp({ store: env.store, appRoot: null, token });
    serverHandle = await listen(app);
    const { status, json } = await req(serverHandle.base, 'POST', '/api/sync', {
      token,
    });
    assert.equal(status, 400);
    assert.equal(json.code, 'NO_APP_ROOT');
  });
});
