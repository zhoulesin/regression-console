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
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'GET', '/api/features');
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'unauthorized');
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

  it('creates a module via POST /api/modules', async () => {
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'POST', '/api/modules', {
      token,
      body: { id: 'shopping', title: '购物清单' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.module.module, 'shopping');

    const mods = await req(serverHandle.base, 'GET', '/api/modules', { token });
    assert.ok(mods.json.modules.some((m) => m.id === 'shopping'));
  });

  it('rejects invalid module id', async () => {
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
      token,
    });
    serverHandle = await listen(app);
    const res = await req(serverHandle.base, 'POST', '/api/modules', {
      token,
      body: { id: 'UPPER', title: 'bad' },
    });
    assert.equal(res.status, 400);
  });

  it('exports snapshot via POST /api/export', async () => {
    let exported = false;
    const app = createApp({
      store: env.store,
      repoRoot: env.repoRoot,
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
    assert.equal(res.status, 200);
    assert.equal(exported, true);
  });
});
