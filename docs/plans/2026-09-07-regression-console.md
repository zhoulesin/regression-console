# 真机回归控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本仓库 `tools/regression-console/` 落地本机 Web 工作台：看板管理功能点、Claude 起草 Maestro YAML、人审 Diff 后写盘、再手动执行真机并自动记进度。

**Architecture:** 浏览器只做决策。`127.0.0.1:4780` 上的 Node 服务是唯一动手进程：SQLite 真源、Claude CLI Provider、FileGate 只写 `maestro/**/*.yaml`、单槽 Maestro Runner、导出 Markdown/HTML。两道闸（批准写入 / 执行）分开；AI 永不直接写盘或跑 Maestro。

**Tech Stack:** Node.js 20+（本机已有 v25.9.0）、ESM、`node:test`、`better-sqlite3`、`express`、Vite + React（无 UI 库）、Claude CLI（`/opt/homebrew/bin/claude`）、Maestro CLI。

## Global Constraints

- 仅本机单人：监听 `127.0.0.1:4780`；端口占用则退出报错，不改绑。
- 所有 `/api/*` 校验 `Authorization: Bearer <token>` 或 `?token=`；token 仅内存，重启更换。
- 不绑定 `0.0.0.0`，不扫局域网，无账号。
- FileGate：只允许相对仓库根且解析后仍在 `maestro/` 下的 `*.yaml`；禁止 `../`、绝对路径、`.kt` / `.md` / 其它扩展名。
- AI 只产出完整文件内容 JSON，禁止 patch 片段；解析失败整次作废（HTTP 422）。
- 状态：`待写` →（有 pending session 仍 `待写`）→ 批准写入 `待执行` → `运行中` → `通过` | `失败`。`留手测`、`假绿` 可 PATCH 手改，不自动进执行。
- 同一时刻只跑一条 Maestro；第二次 `run` → 409。
- SQLite 路径：`tools/regression-console/data/console.db`（gitignore）。
- 仓库根 = `path.resolve(import.meta.dirname, '../../..')`（相对 `tools/regression-console/src/`）。
- CSS 变量：`--bg #0f1115`、`--ok #3fb950`、`--wait #d29922`、`--warn #f85149`、`--hand #58a6ff`。
- 不调用 `./gradlew`、不改 Kotlin/XML、不自动修复失败脚本、不把真机 Maestro 放进 CI。
- 提交信息用中文或英文短句说明 why；本工具目录以外的 Android 代码一律不改。

## File Structure

```
tools/regression-console/
  package.json
  src/
    constants.js      状态字面量、端口、章节名
    db.js             打开 SQLite、建表
    store.js          Feature / flow / run / ai_session
    fileGate.js       路径校验、diff、备份写盘
    parseAnalyze.js   Claude JSON 解析 + 路径闸门
    claudeProvider.js spawn claude -p
    contextPack.js    按章节读取少量 xml/yaml 进 prompt
    importer.js       首次空库导入 23 条 + 绑定已有 flow 路径
    exporter.js       覆盖 md + 进度 html
    runner.js         单槽 maestro test
    auth.js           token
    http.js           express 路由
    server.js         listen 127.0.0.1:4780 + open
  test/
    fileGate.test.js
    store.test.js
    parseAnalyze.test.js
    runner.test.js
    importer.test.js
  data/               gitignore
  web/
    package.json
    vite.config.js
    index.html
    src/main.jsx
    src/App.jsx
    src/api.js
    src/styles.css
```

修改仓库根：

- `.gitignore`：增加 `tools/regression-console/data/`、`tools/regression-console/**/node_modules/`、`tools/regression-console/web/dist/`（`.superpowers` 已存在）
- 导出覆盖：`TESTING_DEVICE_REGRESSION.md`、`docs/testing/device-regression-plan.html`（仅 Exporter 任务，且只在用户点导出或状态变更后写）

---

### Task 1: 脚手架、常量、SQLite 与状态机

**Files:**
- Create: `tools/regression-console/package.json`
- Create: `tools/regression-console/src/constants.js`
- Create: `tools/regression-console/src/db.js`
- Create: `tools/regression-console/src/store.js`
- Create: `tools/regression-console/test/store.test.js`
- Modify: `.gitignore`（追加三行）

**Interfaces:**
- Consumes: 无
- Produces:
  - `STATUS`: `{ PENDING_WRITE:'待写', PENDING_RUN:'待执行', RUNNING:'运行中', PASSED:'通过', FAILED:'失败', MANUAL:'留手测', FALSE_GREEN:'假绿' }`
  - `PORT = 4780`
  - `openDb(dbPath: string): Database`
  - `createStore(db): Store` 方法见步骤 3

- [ ] **Step 1: 追加 gitignore**

在 `.gitignore` 末尾追加：

```
tools/regression-console/data/
tools/regression-console/**/node_modules/
tools/regression-console/web/dist/
```

- [ ] **Step 2: 写失败的状态机测试**

`tools/regression-console/test/store.test.js`：

```js
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
    assert.equal(store.getFeature('2.1').status, STATUS.RUNNING);
    assert.throws(() => store.startRun('2.1'), /409/);
    store.finishRun(run1.id, { exit_code: 0, log_excerpt: 'ok' });
    assert.equal(store.getFeature('2.1').status, STATUS.PASSED);
  });

  it('finishRun non-zero marks 失败', () => {
    store.setStatus('2.1', STATUS.PENDING_RUN);
    store.insertFlow({ feature_code: '2.1', path: 'maestro/todo/x.yaml', kind: 'flow' });
    const run = store.startRun('2.1');
    store.finishRun(run.id, { exit_code: 1, failed_step: 'tapOn', log_excerpt: 'FAIL' });
    assert.equal(store.getFeature('2.1').status, STATUS.FAILED);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd tools/regression-console && node --test test/store.test.js
```

Expected: FAIL（模块不存在）

- [ ] **Step 4: 最小实现**

`package.json`：

```json
{
  "name": "regression-console",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js",
    "start": "node src/server.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "express": "^5.1.0"
  }
}
```

`src/constants.js`：导出 `PORT=4780`、`HOST='127.0.0.1'`、`STATUS` 如上、`CHAPTER_TITLES = {0:'App 级冒烟',1:'todo-list',2:'单 List 内的 Todo',3:'Display 排序',4:'完成态',5:'Filter'}`。

`src/db.js`：`openDb` 用 `new Database(dbPath)`；`PRAGMA journal_mode=WAL`；执行：

```sql
CREATE TABLE IF NOT EXISTS feature (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  chapter INTEGER NOT NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL,
  precondition TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flow (
  id INTEGER PRIMARY KEY,
  feature_code TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY,
  flow_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  failed_step TEXT,
  artifact_dir TEXT,
  log_excerpt TEXT
);
CREATE TABLE IF NOT EXISTS ai_session (
  id INTEGER PRIMARY KEY,
  feature_code TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  diff TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

`src/store.js` 必须实现：

- `listFeatures(): Feature[]` 按 chapter, code 排
- `getFeature(code): Feature | undefined`
- `upsertFeature(row)` `updated_at` 用 `new Date().toISOString()`
- `setStatus(code, status)` 不校验（手改 `留手测`/`假绿` 用）
- `assertCanRun(code)`：无 `decision=pending` 的 session；status 必须是 `待执行` 或 `失败`；必须有 kind=flow 的行；否则 `throw` 消息含 `待执行` 或 `409`
- `insertFlow({feature_code,path,kind})` 返回 `{id,...}`
- `listFlows(feature_code)`
- `startRun(code)`：`assertCanRun`；若 `getActiveRun()` 存在则 `throw` Error 消息含 `409`；把 feature 设 `运行中`；insert run；返回 run 行
- `getActiveRun()`：`ended_at IS NULL` 的最新一条
- `finishRun(runId, {exit_code, failed_step?, artifact_dir?, log_excerpt})`：写 ended_at/duration；feature 按 exit_code 0→`通过` 否则 `失败`
- `createAiSession({feature_code, provider, prompt, response, diff})` decision=`pending`
- `getPendingSession(code)`
- `decideSession(id, 'approved'|'rejected')`

`assertCanRun`：`失败` 允许再跑（规格：失败可再次执行）。`待写` 不允许。

- [ ] **Step 5: 安装依赖并跑测试**

```bash
cd tools/regression-console && npm install && node --test test/store.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add .gitignore tools/regression-console/package.json tools/regression-console/package-lock.json tools/regression-console/src/constants.js tools/regression-console/src/db.js tools/regression-console/src/store.js tools/regression-console/test/store.test.js
git commit -m "feat(regression-console): add sqlite store and feature status machine"
```

---

### Task 2: FileGate

**Files:**
- Create: `tools/regression-console/src/fileGate.js`
- Create: `tools/regression-console/test/fileGate.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `assertMaestroYamlPath(repoRoot: string, relativePath: string): string` 返回规范化相对 POSIX 路径
  - `diffFiles(repoRoot, files: {path, content}[]): string` unified diff 文本
  - `applyFiles(repoRoot, files): { applied: string[] }` 先备份已存在文件为 `path + '.bak'` 再写 utf8

- [ ] **Step 1: 写失败测试**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertMaestroYamlPath, applyFiles } from '../src/fileGate.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'));
fs.mkdirSync(path.join(root, 'maestro', 'todo'), { recursive: true });

describe('fileGate', () => {
  it('accepts maestro yaml', () => {
    assert.equal(
      assertMaestroYamlPath(root, 'maestro/todo/item-fast-add.yaml'),
      'maestro/todo/item-fast-add.yaml'
    );
  });
  it('rejects traversal', () => {
    assert.throws(() => assertMaestroYamlPath(root, 'maestro/../app/x.yaml'), /400/);
  });
  it('rejects absolute', () => {
    assert.throws(() => assertMaestroYamlPath(root, '/tmp/x.yaml'), /400/);
  });
  it('rejects kt and md', () => {
    assert.throws(() => assertMaestroYamlPath(root, 'maestro/x.kt'), /400/);
    assert.throws(() => assertMaestroYamlPath(root, 'TESTING_DEVICE_REGRESSION.md'), /400/);
  });
  it('apply writes bak then file', () => {
    const p = path.join(root, 'maestro', 'todo', 'a.yaml');
    fs.writeFileSync(p, 'old\n');
    applyFiles(root, [{ path: 'maestro/todo/a.yaml', content: 'new\n' }]);
    assert.equal(fs.readFileSync(p, 'utf8'), 'new\n');
    assert.equal(fs.readFileSync(p + '.bak', 'utf8'), 'old\n');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd tools/regression-console && node --test test/fileGate.test.js
```

Expected: FAIL

- [ ] **Step 3: 实现 `fileGate.js`**

规则（全部失败抛 `Error`，`message` 含 `400`）：

1. `relativePath` 含 `NUL`、以 `/` 开头、含 `\\` 盘符、或 `path.isAbsolute` → 拒。
2. `normalized = path.posix.normalize(relativePath.replaceAll('\\','/'))`；若 `normalized.startsWith('..')` 或为 `..` → 拒。
3. `resolved = path.resolve(repoRoot, normalized)`；`rel = path.relative(repoRoot, resolved)`；若 `rel.startsWith('..')` 或 `path.isAbsolute(rel)` → 拒。
4. POSIX `rel` 必须 `startsWith('maestro/')` 或等于在 maestro 下；扩展名必须 `.yaml` 或 `.yml`。
5. `diffFiles`：对每个 file 读旧内容（缺文件当空），用逐行 `--- a/path` / `+++ b/path` 简单实现即可（不必依赖 `diff` 包）：旧有新无的行前缀 `-`，反之为 `+`。至少覆盖「整文件替换」可读。
6. `applyFiles`：先对每个 path `assertMaestroYamlPath`；全部通过后再写；`mkdirSync(...,{recursive:true})`。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd tools/regression-console && node --test test/fileGate.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/src/fileGate.js tools/regression-console/test/fileGate.test.js
git commit -m "feat(regression-console): restrict writes to maestro yaml via FileGate"
```

---

### Task 3: 导入 23 条功能点与已有 flow 绑定

**Files:**
- Create: `tools/regression-console/src/seedFeatures.js`
- Create: `tools/regression-console/src/importer.js`
- Create: `tools/regression-console/test/importer.test.js`

**Interfaces:**
- Consumes: `createStore`, `STATUS`
- Produces: `SEED_FEATURES: SeedRow[]`；`FLOW_BINDINGS: {feature_code, path, kind}[]`；`importIfEmpty(store): { imported: number }` 仅当 `listFeatures().length===0` 时插入

`SeedRow = { code, chapter, title, criteria, precondition, status }`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { importIfEmpty, SEED_FEATURES } from '../src/importer.js';
import { STATUS } from '../src/constants.js';

describe('importer', () => {
  it('has 23 features', () => {
    assert.equal(SEED_FEATURES.length, 23);
  });
  it('imports once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-'));
    const store = createStore(openDb(path.join(dir, 't.db')));
    const a = importIfEmpty(store);
    const b = importIfEmpty(store);
    assert.equal(a.imported, 23);
    assert.equal(b.imported, 0);
    assert.equal(store.getFeature('1.5').status, STATUS.PASSED);
    assert.equal(store.getFeature('1.6').status, STATUS.MANUAL);
    assert.equal(store.getFeature('3.4').status, STATUS.FALSE_GREEN);
    const flows = store.listFlows('1.5');
    assert.equal(flows[0].path, 'maestro/todo/list-drag-sort.yaml');
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
cd tools/regression-console && node --test test/importer.test.js
```

Expected: FAIL

- [ ] **Step 3: 实现 seed 与 importer**

`SEED_FEATURES` 必须与 spec / `TESTING_DEVICE_REGRESSION.md` 第三节一致，23 条完整写出（不要「见文档」）：

| code | chapter | status | title 摘要 |
|---|---|---|---|
| 0.1–0.4 | 0 | 通过 | 冷启动 / 杀进程 / 日周切换 / Todo 入口 |
| 1.1–1.5 | 1 | 通过 | List CRUD + 拖拽 |
| 1.6 | 1 | 留手测 | 数量上限 |
| 2.1–2.5 | 2 | 待写 | 快速添加、完整创建、编辑、删除、落库 |
| 3.1–3.3 | 3 | 待写 | group by / title / due date |
| 3.4 | 3 | 假绿 | 配置落库 |
| 4.1–4.3 | 4 | 待写 | 完成态 |
| 5.1–5.2 | 5 | 待写 | Filter |

`criteria`/`precondition`/`title` 从该 md 表格抄全文。

`FLOW_BINDINGS`（kind 均为 `flow`，一条功能点可多绑；CRUD 四条共用 list-crud）：

- 0.1 `maestro/cold-launch.yaml`
- 0.2 `maestro/kill-relaunch.yaml`
- 0.3 `maestro/switch-day-week.yaml`
- 0.4 `maestro/todo/open-root.yaml`
- 1.1, 1.2, 1.3, 1.4 `maestro/todo/list-crud.yaml`
- 1.5 `maestro/todo/list-drag-sort.yaml`

其余功能点此任务不绑 path。`importIfEmpty` 插完 feature 再插 bindings。

- [ ] **Step 4: 跑测确认通过**

```bash
cd tools/regression-console && node --test test/importer.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/src/seedFeatures.js tools/regression-console/src/importer.js tools/regression-console/test/importer.test.js
git commit -m "feat(regression-console): seed 23 features and bind existing maestro flows"
```

把 `SEED_FEATURES` 放 `seedFeatures.js` 再由 `importer.js` re-export，避免单文件过大。

---

### Task 4: 解析 Claude 响应（不 spawn CLI）

**Files:**
- Create: `tools/regression-console/src/parseAnalyze.js`
- Create: `tools/regression-console/test/parseAnalyze.test.js`

**Interfaces:**
- Consumes: `assertMaestroYamlPath(repoRoot, path)`
- Produces: `parseAnalyzeResponse(raw: string, repoRoot: string): { rationale: string, risks: string[], files: {path, content}[] }`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { parseAnalyzeResponse } from '../src/parseAnalyze.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
fs.mkdirSync(path.join(root, 'maestro'), { recursive: true });

describe('parseAnalyzeResponse', () => {
  it('reads fenced json', () => {
    const raw = '```json\n{"rationale":"r","risks":["x"],"files":[{"path":"maestro/a.yaml","content":"appId: x\\n"}]}\n```';
    const out = parseAnalyzeResponse(raw, root);
    assert.equal(out.files[0].path, 'maestro/a.yaml');
  });
  it('422 when files missing', () => {
    assert.throws(() => parseAnalyzeResponse('{"rationale":"r","risks":[]}', root), /422/);
  });
  it('422 when path escapes', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      risks: [],
      files: [{ path: 'app/Foo.kt', content: 'x' }],
    });
    assert.throws(() => parseAnalyzeResponse(raw, root), /422/);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
cd tools/regression-console && node --test test/parseAnalyze.test.js
```

Expected: FAIL

- [ ] **Step 3: 实现解析**

1. trim；若含 ` ```json ` 则取第一对 fence 内文本，否则整段当 JSON。
2. `JSON.parse` 失败 → throw 含 `422`。
3. 必须有 string `rationale`、array `risks`、非空 array `files`；每项 `path`+`content` 均为非空 string。
4. 对每个 path 调 `assertMaestroYamlPath`；失败则改抛 422（不要把 400 漏到 HTTP 层当路径闸门误报——在 parseAnalyze 里 catch 后 `throw new Error('422: ...')`）。
5. 禁止 `content` 看起来像 unified diff（若 `content.startsWith('@@')` 或 `content.startsWith('--- ')` → 422）。

- [ ] **Step 4: 跑测确认通过**

```bash
cd tools/regression-console && node --test test/parseAnalyze.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/src/parseAnalyze.js tools/regression-console/test/parseAnalyze.test.js
git commit -m "feat(regression-console): parse Claude analyze JSON behind FileGate"
```

---

### Task 5: context pack + Claude Provider

**Files:**
- Create: `tools/regression-console/src/contextPack.js`
- Create: `tools/regression-console/src/claudeProvider.js`

**Interfaces:**
- Consumes: `parseAnalyzeResponse`, `diffFiles`, feature 对象
- Produces:
  - `buildContext(repoRoot, feature): string`
  - `analyzeWithClaude({ repoRoot, feature, extraPaths?: string[] }): Promise<{ rationale, risks, files, raw }>`
  - `IRON_RULES` 字符串常量（铁律全文写在文件里，见步骤 3）

- [ ] **Step 1: 实现 contextPack（无独立测试，由手工用短文件）**

`CONTEXT_FILES_BY_CHAPTER`：

```js
{
  0: ['maestro/cold-launch.yaml'],
  1: ['maestro/todo/list-crud.yaml', 'maestro/todo/subflows/cleanup-fixture.yaml'],
  2: ['maestro/todo/subflows/create-fixture-list.yaml', 'app/src/main/res/layout/item_todolist.xml'],
  3: ['maestro/todo/display-modes.yaml'],
  4: ['maestro/todo/display-modes.yaml'],
  5: []
}
```

`buildContext`：对每个存在的文件读最多 200 行，拼进 prompt。缺文件跳过。

- [ ] **Step 2: 实现 claudeProvider.js**

```js
import { spawn } from 'node:child_process';
import { parseAnalyzeResponse } from './parseAnalyze.js';
import { buildContext, IRON_RULES } from './contextPack.js';

export function analyzeWithClaude({ repoRoot, feature, bin = 'claude' }) {
  const prompt = [
    '你是 Maestro YAML 作者。只输出一个 JSON 对象，不要改仓库文件。',
    IRON_RULES,
    `功能点 ${feature.code} ${feature.title}`,
    `判定：${feature.criteria}`,
    `前提：${feature.precondition}`,
    buildContext(repoRoot, feature),
    'JSON shape: {"rationale":"","risks":[],"files":[{"path":"maestro/...yaml","content":"完整文件"}]}',
  ].join('\n\n');

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('422: claude timeout'));
    }, 120000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(t);
      reject(new Error('422: ' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(new Error('422: claude exit ' + code + ' ' + err.slice(0, 500)));
        return;
      }
      try {
        resolve({ ...parseAnalyzeResponse(out, repoRoot), raw: out, prompt });
      } catch (e) {
        reject(e);
      }
    });
  });
}
```

`IRON_RULES` 必须包含：禁止用 rightOf/below/leftOf 定位操作目标；above/below 仅用于顺序断言；写入前 fail-closed 断言对象正确；一个 flow 一件事；不要用 runFlow env 传参（子流程默认值会胜出）；第 1/2 章不要点 Display/Filter；夹具名 `E2E Todo*` / `E2E_`。

不传 `--dangerously-skip-permissions`。

- [ ] **Step 3: 无真 CLI 的冒烟（可选）**

若本机无 claude，不跑。有则：

```bash
node -e "import('./src/claudeProvider.js').then(m=>m.analyzeWithClaude({repoRoot:process.cwd()+'/../..',feature:{code:'0.4',title:'t',criteria:'rvTodo',precondition:'',chapter:0}})).then(console.log).catch(e=>{console.error(e);process.exit(1)})"
```

在 `tools/regression-console` 下执行时 `repoRoot` 应为仓库根。此步失败不阻塞 Task 6（HTTP 可用 fixture provider）。

- [ ] **Step 4: Commit**

```bash
git add tools/regression-console/src/contextPack.js tools/regression-console/src/claudeProvider.js
git commit -m "feat(regression-console): add Claude analyze provider and chapter context pack"
```

---

### Task 6: HTTP API（鉴权、CRUD、analyze/apply/reject）

**Files:**
- Create: `tools/regression-console/src/auth.js`
- Create: `tools/regression-console/src/http.js`
- Create: `tools/regression-console/src/paths.js`

**Interfaces:**
- Consumes: store, fileGate, parseAnalyze, analyzeWithClaude, importIfEmpty
- Produces: `createApp({ store, repoRoot, token, analyzeFn }): express.Application`；`newToken(): string`

`paths.js`：`export const repoRoot = path.resolve(import.meta.dirname, '../../..')`；`export const dataDir = path.resolve(import.meta.dirname, '../data')`。

- [ ] **Step 1: auth.js**

```js
import crypto from 'node:crypto';
export function newToken() {
  return crypto.randomBytes(24).toString('hex');
}
export function tokenMiddleware(token) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
    const q = typeof req.query.token === 'string' ? req.query.token : '';
    if (bearer === token || q === token) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}
```

- [ ] **Step 2: createApp 路由**

`express.json({ limit: '2mb' })`。`/api/*` 全部走 `tokenMiddleware`。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/features` | `listFeatures` + 每条附 `pendingSession` 与 `flows` |
| POST | `/api/features` | body `{code,chapter,title,criteria,precondition,status?}` upsert |
| PATCH | `/api/features/:code` | 允许改 title/criteria/precondition/notes/status（手改假绿/留手测） |
| POST | `/api/features/:code/analyze` | 调 `analyzeFn`；`createAiSession`；`diffFiles` 写入 session.diff；**不改** feature.status |
| POST | `/api/features/:code/apply` | body `{ sessionId, editedFiles? }`；pending 必须匹配 code；files 默认 JSON.parse(session.response) 的 files，否则 editedFiles；`applyFiles`；`decideSession approved`；`insertFlow` 每个 path kind=flow；`setStatus(待执行)` |
| POST | `/api/features/:code/reject` | body `{ sessionId }` → rejected |
| POST | `/api/export` | 调 exporter（Task 7 先做 stub：空函数 `exportSnapshot(){}`，本任务可 no-op，Task 7 替换） |

错误映射：message 含 `401`/`400`/`409`/`422` 则用该状态码，否则 500。analyze 失败不写半截 session（先跑 analyzeFn 成功再 insert）。

将 `analyzeFn` 注入以便测试可传入 `async () => ({rationale,risks,files,raw,prompt})`。

- [ ] **Step 3: 用 node:test 打 HTTP（内联 supertest 或 http.request）**

在 `test/http.test.js`：

- 无 token → 401
- 注入 analyzeFn 返回越权 path → 422 且磁盘无文件
- analyze 成功 → pending session
- apply → 仓库临时根下 yaml 出现，status `待执行`

用 tmp repoRoot（含 `maestro/`），不要写真实仓库。

- [ ] **Step 4: 跑 `node --test test/http.test.js` 至 PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/src/auth.js tools/regression-console/src/http.js tools/regression-console/src/paths.js tools/regression-console/test/http.test.js
git commit -m "feat(regression-console): add token-gated analyze and apply APIs"
```

---

### Task 7: Runner 单槽 + SSE + abort

**Files:**
- Create: `tools/regression-console/src/runner.js`
- Create: `tools/regression-console/test/runner.test.js`
- Modify: `tools/regression-console/src/http.js` 增加 run 路由

**Interfaces:**
- Consumes: `store.startRun` / `finishRun` / `getActiveRun`
- Produces:
  - `createRunner({ spawnFn, store, repoRoot, maestroBin='maestro' })`
  - `runner.start(featureCode): run`
  - `runner.abort()`
  - `runner.subscribe(runId, fn)` 日志行
  - `findLatestArtifactDir(): string | ''` 读 `os.homedir()+'/.maestro/tests'` 下按 mtime 最新目录

- [ ] **Step 1: 失败测试：第二次 start 抛 409；abort 把 exit 记非 0**

`spawnFn` 假实现：返回 EventEmitter 风格 `{ stdout, stderr, kill, on('close') }`。第一次 close 0；第二次 start 应在 spawn 前抛错。

```js
it('single slot', async () => {
  // start 后不 close，第二次 start 抛 /409/
});
```

- [ ] **Step 2: 跑测 FAIL 后实现 runner**

`start`：`store.startRun`；`spawn(maestroBin, ['test', flow.path], { cwd: repoRoot })`；拼接 log；`close` 时 `finishRun`，若 exit!==0 填 `artifact_dir: findLatestArtifactDir()`。

`abort`：对当前 child `kill('SIGTERM')`。

- [ ] **Step 3: HTTP**

- `POST /api/flows/:id/run` 用 flow id 找到 feature_code 再 `runner.start`
- `POST /api/runs/abort`
- `GET /api/runs/:id/stream` SSE：`text/event-stream`，已有 log replay + 后续 subscribe；无 token 仍 401

二次 start → 409。

- [ ] **Step 4: `node --test test/runner.test.js` PASS**

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/src/runner.js tools/regression-console/src/http.js tools/regression-console/test/runner.test.js
git commit -m "feat(regression-console): run maestro with single slot and SSE logs"
```

---

### Task 8: Exporter

**Files:**
- Create: `tools/regression-console/src/exporter.js`
- Modify: `tools/regression-console/src/http.js` 的 `/api/export` 与 `setStatus`/`finishRun` 后调用（finishRun 在 runner 内调 `exportSnapshot`）

**Interfaces:**
- Produces: `exportSnapshot({ store, repoRoot }): void` 写：
  - `path.join(repoRoot, 'TESTING_DEVICE_REGRESSION.md')`
  - `path.join(repoRoot, 'docs/testing/device-regression-plan.html')`

- [ ] **Step 1: 实现 Markdown 生成**

结构保持现文档的「第三节功能点表」：按 chapter 输出 `| # | 功能点 | 判定依据 | 状态 |`。状态用 SQLite 当前值。第四节执行流表用 `listFlows` 聚合。不要删文档里的铁律章节：把 `docs/testing/regression-console-design.html` 不碰；**回归 md 的第一～二节、五～十节**若已存在，读取原文件，只替换「## 三、功能点清单」到下一个 `---` 或「## 四、」之间的块；若文件没有该锚点，则整文件写成「短版」（一、怎么读 + 三、清单 + 四、flow 表）。优先锚点替换，避免冲掉铁律。

- [ ] **Step 2: HTML 进度页**

以 `docs/testing/device-regression-plan.html` 为模板骨架：统计卡数字用 `store.listFeatures()` 计算通过数/总数；各章进度条 width = 通过/该章条数；表格行按 feature 渲染。CSS 原样复制进 exporter 字符串或读现文件替换 `<div class="cards">` 之后到 footer 前。实现上：读现 html，若含 `id="generated-body"` 则只换该节点；**第一次**给现 html 加上 `<div id="generated-body">` 包住可变部分。本任务允许一次性 Modify `docs/testing/device-regression-plan.html` 插入该 id，之后只由 exporter 填 inner。

注意：仓库 `.gitignore` 含 `/docs`，html 可能不被 git 跟踪；仍按 spec 路径写。

- [ ] **Step 3: `/api/export` 调 `exportSnapshot`；`finishRun` 成功后同样调用**

- [ ] **Step 4: 用 tmp 目录测 exporter 写出含 `1.5` 和 `通过` 的 md（不要测真仓库）**

- [ ] **Step 5: Commit**（含 html 锚点修改若有）

```bash
git add tools/regression-console/src/exporter.js tools/regression-console/src/http.js tools/regression-console/src/runner.js docs/testing/device-regression-plan.html
git commit -m "feat(regression-console): export feature board to markdown and html"
```

若 `docs/` 被 ignore，commit 时不要强加 `-f`，只提交 `tools/regression-console` 内文件。

---

### Task 9: 前端看板

**Files:**
- Create: `tools/regression-console/web/package.json`
- Create: `tools/regression-console/web/vite.config.js`
- Create: `tools/regression-console/web/index.html`
- Create: `tools/regression-console/web/src/main.jsx`
- Create: `tools/regression-console/web/src/App.jsx`
- Create: `tools/regression-console/web/src/api.js`
- Create: `tools/regression-console/web/src/styles.css`

**Interfaces:**
- Consumes: Task 6–7 HTTP
- Produces: 单页看板

- [ ] **Step 1: Vite 配置**

`web/package.json`：`react` `react-dom` `vite` `@vitejs/plugin-react`。

`vite.config.js`：

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4781,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4780', changeOrigin: false },
    },
  },
});
```

token 用 `localStorage` 或 URL `?token=`：`api.js` 每次 fetch 带 `Authorization: Bearer`。页面 load 若 URL 有 token 则存起来。

- [ ] **Step 2: styles.css** 复制进度页变量与 pill、卡片、表格、左 38% 布局。

- [ ] **Step 3: App.jsx**

- 顶栏：通过数、运行中、第一个非通过且非留手测的 code 显示「卡在」
- 左列：按 chapter 分组；点击选中
- 右列 Tab：说明 / Diff / 日志 / 历史
- 按钮启用规则严格按 spec 第三节
- 「AI 分析」POST analyze，把 rationale/risks/diff 显示在 Diff tab
- Diff tab 用 `<textarea>` 编辑 JSON `files` 或显示 `session.diff` 只读 + 可选 textarea 覆盖 content
- 批准 / 打回
- 执行：POST run 后 `EventSource('/api/runs/'+id+'/stream?token=')`（EventSource 只能 query token）
- 中止
- 不要实现聊天布局

- [ ] **Step 4: `cd web && npm install`**，`npx vite build` 必须成功

- [ ] **Step 5: Commit**

```bash
git add tools/regression-console/web
git commit -m "feat(regression-console): add dashboard UI for analyze, apply, and run"
```

---

### Task 10: server.js 启动、静态资源、空库导入

**Files:**
- Create: `tools/regression-console/src/server.js`
- Modify: `tools/regression-console/package.json` scripts
- Modify: `tools/regression-console/src/http.js`：非 `/api` GET 时若存在 `web/dist` 则 `express.static`

**Interfaces:**
- Produces: `node src/server.js` 打印 URL 并 `open`

- [ ] **Step 1: server.js**

```js
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createApp } from './http.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { importIfEmpty } from './importer.js';
import { newToken } from './auth.js';
import { PORT, HOST } from './constants.js';
import { repoRoot, dataDir } from './paths.js';
import { analyzeWithClaude } from './claudeProvider.js';
import { createRunner } from './runner.js';
import { exportSnapshot } from './exporter.js';

fs.mkdirSync(dataDir, { recursive: true });
const store = createStore(openDb(dataDir + '/console.db'));
importIfEmpty(store);
const token = newToken();
const runner = createRunner({ store, repoRoot });
const app = createApp({
  store,
  repoRoot,
  token,
  runner,
  analyzeFn: (feature) => analyzeWithClaude({ repoRoot, feature }),
  exportFn: () => exportSnapshot({ store, repoRoot }),
});
const server = http.createServer(app);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('port 4780 in use');
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/?token=${token}`;
  console.log(url);
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
```

`listen` 必须传 `HOST` `'127.0.0.1'`，不要省略（省略会绑 IPv6/所有接口）。

- [ ] **Step 2: package.json**

```json
"scripts": {
  "test": "node --test test/*.test.js",
  "build-ui": "npm --prefix web run build",
  "start": "npm run build-ui && node src/server.js",
  "dev": "node src/server.js"
}
```

开发时前端走 4781 proxy；`dev` 只起 API。README 四行说明写在 `tools/regression-console/README.md`：先 `npm install`（根和 web）、真机验收命令。

- [ ] **Step 3: 本机验收（不进 CI）**

1. `cd tools/regression-console && npm install && npm --prefix web install && npm test` 全绿  
2. `npm start` 浏览器打开看板，应看到 23 条，1.5 为通过  
3. 有 USB 真机且 Maestro 可用时：选 0.4 或 1.1，点执行，日志出现，结束后状态不崩（已通过的用例再跑应仍可通过或按真实结果更新——**已通过条目允许再次执行**，`assertCanRun` 须同时允许 `通过` 与 `失败` 与 `待执行`，否则验收 1.1 会 409。**修正：** Task 1 的 `assertCanRun` 在本任务改为允许 `STATUS.PASSED | FAILED | PENDING_RUN`，禁止 `PENDING_WRITE | RUNNING | MANUAL | FALSE_GREEN`。补一条 store 测试并提交在本 task。）

- [ ] **Step 4: Commit**

```bash
git add tools/regression-console/src/server.js tools/regression-console/package.json tools/regression-console/README.md tools/regression-console/src/store.js tools/regression-console/test/store.test.js
git commit -m "feat(regression-console): serve loopback console with import and browser launch"
```

---

## Self-Review

**Spec coverage**

| Spec | Task |
|---|---|
| 看板 UI A | 9 |
| Claude CLI + JSON 契约 | 4, 5 |
| 两道闸 apply / run | 6, 7 |
| FileGate 只 yaml | 2 |
| SQLite 四表 + 状态机 | 1 |
| 导入 23 + flow 绑定 | 3 |
| 导出 md/html | 8 |
| 127.0.0.1:4780 + token + 占用退出 | 10 |
| SSE 日志 / abort / 单槽 409 | 7 |
| 422 非结构化 / 越权 path | 4, 6 |
| gitignore data/node_modules | 1 |
| 不 CI 真机 | 10 手工验收 |
| Provider 预留 | `analyzeFn` 注入即接口 |

**修正已写入 Task 10：** `通过` 的功能点必须能再执行，否则无法用 `list-crud.yaml` 做本机验收。

**Placeholder scan：** 无 TBD。Exporter 锚点策略已写死。Claude 无 CLI 时 Task 5 不阻塞。
