import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';
import { exportSnapshot } from '../src/exporter.js';
import { createRunner } from '../src/runner.js';
import { createApp } from '../src/http.js';
import { newToken } from '../src/auth.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-export-'));
  const repoRoot = path.join(dir, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const db = openDb(path.join(dir, 't.db'));
  const store = createStore(db);
  store.upsertFeature({
    code: '1.5',
    chapter: 1,
    title: '拖拽排序',
    criteria: '手柄拖动后相邻顺序变化',
    precondition: '有 list，无 todos',
    status: STATUS.PASSED,
  });
  store.upsertFeature({
    code: '2.1',
    chapter: 2,
    title: '快速添加',
    criteria: '出现 E2E_Fast',
    precondition: '夹具 List',
    status: STATUS.PENDING_WRITE,
  });
  store.insertFlow({
    feature_code: '1.5',
    path: 'maestro/todo/list-drag-sort.yaml',
    kind: 'flow',
  });
  return { dir, repoRoot, store };
}

describe('exportSnapshot', () => {
  it('writes md with 1.5 and 通过 under tmp repoRoot', () => {
    const { repoRoot, store } = tmpRepo();
    exportSnapshot({ store, repoRoot });

    const mdPath = path.join(repoRoot, 'TESTING_DEVICE_REGRESSION.md');
    assert.ok(fs.existsSync(mdPath));
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /1\.5/);
    assert.match(md, /通过/);
    assert.match(md, /## 三、功能点清单/);
    assert.match(md, /## 四、执行流/);
    assert.match(md, /list-drag-sort\.yaml/);

    const htmlPath = path.join(
      repoRoot,
      'docs/testing/device-regression-plan.html',
    );
    assert.ok(fs.existsSync(htmlPath));
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /id="generated-body"/);
    assert.match(html, /1\.5/);
    assert.match(html, /通过/);
  });

  it('replaces only section 3 when anchor exists', () => {
    const { repoRoot, store } = tmpRepo();
    const mdPath = path.join(repoRoot, 'TESTING_DEVICE_REGRESSION.md');
    fs.writeFileSync(
      mdPath,
      [
        '# keep-me',
        '',
        '## 一、文档怎么读',
        '',
        'IRON_RULE_A',
        '',
        '## 三、功能点清单',
        '',
        'old rows',
        '',
        '---',
        '',
        '## 四、执行流',
        '',
        'IRON_RULE_B',
        '',
        '## 五、夹具',
        '',
        'IRON_RULE_C',
        '',
      ].join('\n'),
      'utf8',
    );

    exportSnapshot({ store, repoRoot });
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.match(md, /IRON_RULE_A/);
    assert.match(md, /IRON_RULE_B/);
    assert.match(md, /IRON_RULE_C/);
    assert.match(md, /1\.5/);
    assert.match(md, /通过/);
    assert.doesNotMatch(md, /old rows/);
  });
});

describe('export wiring', () => {
  it('POST /api/export is gone (410)', async () => {
    const { repoRoot, store } = tmpRepo();
    const token = newToken();
    const app = createApp({
      store,
      appRoot: repoRoot,
      token,
    });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/export`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 410);
      const body = await res.json();
      assert.equal(body.code, 'GONE');
      // 目录已归 DUT，控制台不再写盘
      assert.equal(
        fs.existsSync(path.join(repoRoot, 'TESTING_DEVICE_REGRESSION.md')),
        false,
      );
    } finally {
      await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
    }
  });

  it('runner finishRun calls exportFn', async () => {
    const { repoRoot, store } = tmpRepo();
    store.setStatus('2.1', STATUS.PENDING_RUN);
    store.insertFlow({
      feature_code: '2.1',
      path: 'maestro/todo/item-fast-add.yaml',
      kind: 'flow',
    });
    // runner spawn 前会校验 yaml 存在
    fs.mkdirSync(path.join(repoRoot, 'maestro/todo'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'maestro/todo/item-fast-add.yaml'), '# t\n');

    let exportCalls = 0;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    const runner = createRunner({
      spawnFn: () => child,
      store,
      appRoot: repoRoot,
      exportFn: () => {
        exportCalls += 1;
      },
    });
    runner.start('2.1');
    child.emit('close', 0);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(exportCalls, 1);
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });
});
