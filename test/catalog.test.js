import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { normalizeCatalogDraft } from '../src/catalog.js';
import { STATUS } from '../src/constants.js';
import { createApp } from '../src/http.js';
import { createAnalyzeHub } from '../src/analyzeHub.js';
import { newToken } from '../src/auth.js';

function freshStore() {
  const store = createStore(openDb(':memory:'));
  store.upsertFeature({
    module: 'todo',
    code: '2.1',
    chapter: 2,
    title: '卡片内快速添加',
    criteria: '新增 Todo 出现在目标 List 卡片内',
    precondition: '已有 List',
    status: STATUS.PASSED,
  });
  return store;
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const current = app.listen(0, '127.0.0.1', () => resolve(current));
  });
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function request(base, token, method, urlPath, body) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('normalizeCatalogDraft', () => {
  it('keeps new valid features and groups duplicate/invalid rows', () => {
    const existing = [
      { code: '2.1', title: '卡片内快速添加' },
    ];
    const result = normalizeCatalogDraft(
      {
        rationale: '扫描 Todo 根页',
        features: [
          {
            code: '2.1',
            chapter: 2,
            title: '另一个标题',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '2.2',
            chapter: 2,
            title: ' 卡片内快速添加 ',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '6',
            chapter: 6,
            title: '非法编号',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '2.6',
            chapter: 2,
            title: '新功能',
            criteria: '结果出现在目标卡片',
            precondition: '已有 List',
          },
        ],
      },
      existing,
    );

    assert.deepEqual(result.features.map((row) => row.code), ['2.6']);
    assert.deepEqual(
      result.skipped.map((row) => row.reason),
      ['duplicate_code', 'duplicate_title', 'invalid'],
    );
  });

  it('limits reviewable features to 15', () => {
    const features = Array.from({ length: 17 }, (_, index) => ({
      code: `7.${index + 1}`,
      chapter: 7,
      title: `功能 ${index + 1}`,
      criteria: '结果可见',
      precondition: '',
    }));
    const result = normalizeCatalogDraft(
      { rationale: '批量', features },
      [],
    );
    assert.equal(result.features.length, 15);
    assert.equal(
      result.skipped.filter((row) => row.reason === 'batch_limit').length,
      2,
    );
  });
});

describe('catalog HTTP flow', () => {
  it('proposes, survives refresh, then applies new features', async () => {
    const store = freshStore();
    const token = newToken();
    const hub = createAnalyzeHub();
    let argsSeen;
    const app = createApp({
      store,
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-app-')),
      token,
      analyzeHub: hub,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      catalogFn: async (args) => {
        argsSeen = args;
        return {
          rationale: '来自 Todo 代码',
          prompt: 'catalog prompt',
          features: [
            {
              code: '2.6',
              chapter: 2,
              chapter_title: '单 List 内的 Todo',
              title: '点击标题进入详情',
              criteria: '详情页展示目标 Todo 标题',
              precondition: '目标 List 内有 Todo',
            },
          ],
          skipped: [],
        };
      },
    });
    const server = await listen(app);
    try {
      const proposed = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/propose?module=todo',
        { hint: '扫描 Todo 卡片点击行为' },
      );
      assert.equal(proposed.status, 200);
      assert.equal(proposed.json.session.kind, 'catalog');
      assert.equal(argsSeen.module, 'todo');
      assert.equal(argsSeen.existingFeatures.length, 1);

      const pending = await request(
        server.base,
        token,
        'GET',
        '/api/catalog/pending?module=todo',
      );
      assert.equal(pending.status, 200);
      assert.equal(pending.json.session.id, proposed.json.session.id);

      const applied = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/apply?module=todo',
        { sessionId: proposed.json.session.id },
      );
      assert.equal(applied.status, 200);
      assert.deepEqual(applied.json.inserted.map((row) => row.code), ['2.6']);
      assert.equal(store.getFeature('2.6', 'todo').status, STATUS.PENDING_WRITE);
      const listed = await request(
        server.base,
        token,
        'GET',
        '/api/features?module=todo',
      );
      assert.equal(listed.json.chapterTitles['2'], '单 List 内的 Todo');
    } finally {
      await server.close();
    }
  });

  it('requires a reject note and feeds it into the next proposal', async () => {
    const store = freshStore();
    const token = newToken();
    const hub = createAnalyzeHub();
    const seenNotes = [];
    const app = createApp({
      store,
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-app-')),
      token,
      analyzeHub: hub,
      analyzeFn: async () => {
        throw new Error('unused');
      },
      catalogFn: async ({ moduleNotes }) => {
        seenNotes.push(moduleNotes);
        return {
          rationale: '草稿',
          prompt: 'p',
          features: [
            {
              code: '2.6',
              chapter: 2,
              title: '新功能',
              criteria: '结果可见',
              precondition: '',
            },
          ],
          skipped: [],
        };
      },
    });
    const server = await listen(app);
    try {
      const first = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/propose?module=todo',
        { hint: '扫 Todo' },
      );
      const badReject = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/reject?module=todo',
        { sessionId: first.json.session.id, note: '' },
      );
      assert.equal(badReject.status, 400);

      const rejected = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/reject?module=todo',
        { sessionId: first.json.session.id, note: '不要把编辑和删除合成一个点' },
      );
      assert.equal(rejected.status, 200);

      await request(
        server.base,
        token,
        'POST',
        '/api/catalog/propose?module=todo',
        { hint: '重新扫 Todo' },
      );
      assert.match(seenNotes[1], /不要把编辑和删除合成一个点/);
    } finally {
      await server.close();
    }
  });

  it('returns apply_conflict when another writer takes the code', async () => {
    const store = freshStore();
    const token = newToken();
    const app = createApp({
      store,
      repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-app-')),
      token,
      analyzeHub: createAnalyzeHub(),
      analyzeFn: async () => {
        throw new Error('unused');
      },
      catalogFn: async () => ({
        rationale: '草稿',
        prompt: 'p',
        features: [
          {
            code: '2.6',
            chapter: 2,
            title: 'AI 草稿',
            criteria: '结果可见',
            precondition: '',
          },
        ],
        skipped: [],
      }),
    });
    const server = await listen(app);
    try {
      const proposed = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/propose?module=todo',
        { hint: '扫 Todo' },
      );
      store.upsertFeature({
        module: 'todo',
        code: '2.6',
        chapter: 2,
        title: '人工创建',
        criteria: '人工判定',
        precondition: '',
        status: STATUS.PENDING_WRITE,
      });
      const applied = await request(
        server.base,
        token,
        'POST',
        '/api/catalog/apply?module=todo',
        { sessionId: proposed.json.session.id },
      );
      assert.equal(applied.status, 200);
      assert.equal(applied.json.inserted.length, 0);
      assert.equal(applied.json.skipped.at(-1).reason, 'apply_conflict');
      assert.equal(store.getFeature('2.6', 'todo').title, '人工创建');
    } finally {
      await server.close();
    }
  });
});

describe('module catalog notes', () => {
  it('keeps recent notes within 8000 characters', () => {
    const store = freshStore();
    for (let index = 0; index < 6; index += 1) {
      store.appendModuleNote('todo', `${index}-${'x'.repeat(1500)}`);
    }
    const notes = store.getModuleMeta('todo').notes;
    assert.ok(notes.length <= 8000);
    assert.doesNotMatch(notes, /【回归备注】0-/);
    assert.match(notes, /【回归备注】5-/);
  });
});
