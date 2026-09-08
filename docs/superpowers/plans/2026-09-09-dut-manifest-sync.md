# DUT Manifest 同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 功能点与 Maestro YAML 以被测仓 `regression.manifest.json` 为真源；控制台只同步快照、执行、记账，并清空本仓产品 seed/脚本。

**Architecture:** 新增纯函数解析/校验 manifest，`syncFromManifest` 在事务里物化到 SQLite（`hidden` 标记退出清单的功能点）。HTTP `POST /sync` 与启动共用该函数。`maestro test` 的 `cwd` 改为 `appRoot`。无显式 `appRoot` 时不回退 `../..`、不读本仓 yaml。

**Tech Stack:** Node.js ESM、better-sqlite3、Express、React/Vite、node:test、Maestro CLI

**Spec:** `docs/superpowers/specs/2026-09-09-dut-manifest-sync-design.md`

## Global Constraints

- 控制台 **永不写入** DUT 的 `regression.manifest.json`
- `version` 必须为 `1`；校验失败整份拒绝，快照保持上次成功结果
- `GET /features` **必须** `?module=`；无默认 module `todo`
- `feature.status` 由 run 更新，sync **不覆盖**；新行初始 `待执行`（`STATUS.PENDING_RUN`）
- `feature.notes` 不同步、不清空
- yaml 缺失：sync 仍成功，该条 `runnable=false`，执行 4xx
- `manual: true` 的条目是人工验证项：无 flow、不可执行，但**照常显示**在看板（不 hidden）
- 无有效 `appRoot`：进程可听端口；`GET /features` 与 `POST /sync` 返回 4xx JSON，字段 `code` 为 `NO_APP_ROOT`
- manifest 缺失/坏/越权 path：`code` 为 `MANIFEST_INVALID` 或 `MANIFEST_MISSING`
- 本轮 `POST /export`、`POST /modules`、`POST /features`、`PATCH /features/:code` 返回 **410**
- 1.6「List 数量上限」无 flow：生成 DUT manifest 时标 `manual: true` **照常收录**，不跳过
  （跳过会导致它被 `hideFeaturesNotIn` 隐藏而永久从看板消失，其「留手测」状态与备注也随之不可见）
- 单测只靠 `test/fixtures/app/`，不依赖本仓 `src/seed` 或产品 `maestro/`

## File map

| 文件 | 职责 |
|---|---|
| `src/errors.js` | `AppError({ httpStatus, code, message })` |
| `src/config.js` | `resolveAppRoot` 可返回 `null`；`resolveManifestPath` |
| `src/manifest.js` | 读文件、校验、规范化 |
| `src/sync.js` | `syncFromManifest({ store, appRoot, manifestPath })` |
| `src/db.js` / `src/store.js` | `feature.hidden`、`feature.runnable`、`module_meta.hidden` |
| `src/http.js` | `POST /sync`、只读目录、410 写接口、`sendError` 带 `code` |
| `src/runner.js` / `src/server.js` | cwd=`appRoot`；启动调 sync |
| `test/fixtures/app/` | 最小 DUT |
| `web/src/App.jsx` 等 | 同步按钮；去掉创建模块 / Catalog 改库 |
| 删除 `src/seed/`、本仓产品 `maestro/`、`src/importer.js` | 迁出后 |

---

### Task 1: 配置不再默认 `../..`

**Files:**
- Modify: `src/config.js`
- Create: `test/config.test.js`

**Interfaces:**
- Produces: `loadConfig(regressionRoot): object`
- Produces: `resolveAppRoot(regressionRoot, env = process.env): string | null` — 仅当 `REGRESSION_APP_ROOT` 或 `config.appRoot` 为非空字符串时解析为绝对路径，否则 `null`
- Produces: `resolveManifestPath(regressionRoot, env = process.env): string` — 相对 DUT 的路径，默认 `'regression.manifest.json'`；可读 `config.manifestPath`

- [x] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resolveAppRoot, resolveManifestPath } from '../src/config.js';

describe('config appRoot', () => {
  it('returns null when env and config omit appRoot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    assert.equal(resolveAppRoot(dir, {}), null);
  });

  it('prefers REGRESSION_APP_ROOT over config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(
      path.join(dir, 'regression.config.json'),
      JSON.stringify({ appRoot: '/from-file', manifestPath: 'custom.json' }),
    );
    const abs = path.join(dir, 'dut');
    assert.equal(resolveAppRoot(dir, { REGRESSION_APP_ROOT: abs }), abs);
    assert.equal(resolveManifestPath(dir, { REGRESSION_APP_ROOT: abs }), 'custom.json');
  });

  it('resolves relative appRoot against regressionRoot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(
      path.join(dir, 'regression.config.json'),
      JSON.stringify({ appRoot: 'dut' }),
    );
    assert.equal(resolveAppRoot(dir, {}), path.join(dir, 'dut'));
    assert.equal(resolveManifestPath(dir, {}), 'regression.manifest.json');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`

Expected: FAIL（`resolveManifestPath` 未定义，或 `resolveAppRoot` 仍返回 `../..` 解析结果）

- [x] **Step 3: Write minimal implementation**

把 `src/config.js` 的 `resolveAppRoot` 改为：

```javascript
export function resolveAppRoot(regressionRoot, env = process.env) {
  const config = loadConfig(regressionRoot);
  const raw = (env.REGRESSION_APP_ROOT || config.appRoot || '').trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(regressionRoot, raw);
}

export function resolveManifestPath(regressionRoot, env = process.env) {
  const config = loadConfig(regressionRoot);
  const raw = typeof config.manifestPath === 'string' ? config.manifestPath.trim() : '';
  return raw || 'regression.manifest.json';
}
```

`src/paths.js` 的 `export const appRoot` 允许为 `null`。去掉注释里「默认 ../..」。

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/config.js src/paths.js test/config.test.js
git commit -m "fix(config): require explicit appRoot, add manifestPath"
```

---

### Task 2: SQLite `hidden` / `runnable` + store

**Files:**
- Modify: `src/db.js` `SCHEMA` 与 `migrate`
- Modify: `src/store.js`
- Modify: `test/store.test.js`（补 hidden 列表）
- Modify: `test/moduleStore.test.js`（`listModules` 默认不含 hidden）

**Interfaces:**
- Produces: `feature.hidden INTEGER NOT NULL DEFAULT 0`
- Produces: `feature.runnable INTEGER NOT NULL DEFAULT 1`
- Produces: `feature.manual INTEGER NOT NULL DEFAULT 0` — 人工验证项，无 flow 也照常显示
- Produces: `module_meta.hidden INTEGER NOT NULL DEFAULT 0`
- Produces: `store.listFeatures(module)` — 若传入 module，只返回该模块且 `hidden=0`
- Produces: `store.listFeaturesHidden(module)` — 测试用，返回含 hidden 的行（或 `getFeature` 仍能取 hidden 行）
- Produces: `store.listModules()` — `WHERE hidden = 0`
- Produces: `store.upsertFeature(row)` — 写入 `hidden`（默认 0）、`runnable`（默认 1）、`manual`（默认 0）；**不改**已有 `notes` 除非 `row.notes !== undefined`
- Produces: `store.setFeatureHidden(module, code, hidden)`
- Produces: `store.hideFeaturesNotIn(moduleCodes: {module, code}[])` — 不在集合内的全部 `hidden=1`
- Produces: `store.upsertModule({ id, title, chapters, hidden })` — upsert title/chapters_json/hidden；**不改** notes
- Produces: `store.hideModulesNotIn(ids: string[])`

`getFeature(code, module)` 必须传 module，去掉默认 `'todo'`（调用方一律显式传）。本任务改 store 签名后，先修编译/测试里所有 `getFeature('x')` 为 `getFeature('x', 'todo')`（夹具模块仍用 todo 字符串，不是常量默认）。

- [ ] **Step 1: Write the failing test**（追加到 `test/store.test.js`）

```javascript
it('hides features not in the keep set and listFeatures skips them', () => {
  store.upsertFeature({
    module: 'todo', code: '9.1', chapter: 9, title: 'a', criteria: 'c',
    status: STATUS.PENDING_RUN,
  });
  store.hideFeaturesNotIn([{ module: 'todo', code: '2.1' }]);
  const listed = store.listFeatures('todo').map((r) => r.code);
  assert.ok(!listed.includes('9.1'));
  assert.equal(store.getFeature('9.1', 'todo').hidden, 1);
});
```

（若当前 store 测试用的库还没有 2.1，先 upsert 2.1 再 hide。）

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/store.test.js`

Expected: FAIL（无 `hidden` 列或无 `hideFeaturesNotIn`）

- [ ] **Step 3: Write minimal implementation**

在 `migrate` 末尾、`module_meta.title` 迁移之后：

```javascript
if (featureCols.length && !featureCols.includes('hidden')) {
  db.exec(`ALTER TABLE feature ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
}
const featureCols2 = db.prepare(`PRAGMA table_info(feature)`).all().map((c) => c.name);
if (featureCols2.length && !featureCols2.includes('runnable')) {
  db.exec(`ALTER TABLE feature ADD COLUMN runnable INTEGER NOT NULL DEFAULT 1`);
}
const featureCols3 = db.prepare(`PRAGMA table_info(feature)`).all().map((c) => c.name);
if (featureCols3.length && !featureCols3.includes('manual')) {
  db.exec(`ALTER TABLE feature ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`);
}
if (metaCols.length && !metaCols.includes('hidden')) {
  db.exec(`ALTER TABLE module_meta ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
}
```

`CREATE TABLE` 的 `SCHEMA` 字符串同步加上 `hidden` / `runnable` / `manual` 三列，避免新库只靠 ALTER。

`listByModuleStmt`：`SELECT * FROM feature WHERE module = ? AND hidden = 0 ORDER BY chapter, code`

`upsertFeature` 的 INSERT 增加 `hidden`、`runnable`、`manual`；ON CONFLICT 更新目录字段与 hidden/runnable/manual，**不要**把 `notes` 放进 UPDATE（保持已有备注）。status：ON CONFLICT **不要**更新 status。

新插入：`status = row.status ?? '待执行'`，`hidden = row.hidden ?? 0`，`runnable = row.runnable ?? 1`，`manual = row.manual ?? 0`。

- [ ] **Step 4: Run tests**

Run: `node --test test/store.test.js test/moduleStore.test.js`

Expected: PASS（顺手修因去掉 `getFeature` 默认 module 而红的断言）

- [ ] **Step 5: Commit**

```bash
git add src/db.js src/store.js test/store.test.js test/moduleStore.test.js
git commit -m "feat(store): snapshot flags hidden and runnable"
```

---

### Task 3: Manifest 解析与校验

**Files:**
- Create: `src/errors.js`
- Create: `src/manifest.js`
- Create: `test/manifest.test.js`

**Interfaces:**
- Produces: `export class AppError extends Error { constructor(httpStatus, code, message); this.httpStatus; this.code; this.message }` 其中 `message` 形如 `` `${httpStatus}: ${message}` `` 以便现有 `statusFromError` 仍工作
- Produces: `parseManifestJson(raw: string): unknown` — JSON 坏则 `AppError(422, 'MANIFEST_INVALID', ...)`
- Produces: `normalizeManifest(draft, { appRoot: string }): { appId, device, modules, features }`
  - `version !== 1` → `MANIFEST_INVALID`
  - `appId` 可选字符串（Android 包名，形如 `com.example.app`），缺省 `''`；非空却不含 `.` → `MANIFEST_INVALID`
  - `device` 可选字符串（目标设备标识），缺省 `''`
  - modules 空 / id 不匹配 `^[a-z0-9-]{2,20}$` / title 空 → `MANIFEST_INVALID`
  - feature：`module` 必须在 modules 集合；`code` `^\d+\.\d+$`；`chapter` 为 ≥0 整数；title/criteria 非空
  - `manual` 可选布尔，默认 `false`。`true` 时 `flow` 可省略（规范化为 `''`）；`false` 时 `flow` 必填
  - `flow` 用 `path.resolve(appRoot, flow)` 后 `rel = path.relative(appRoot, resolved)`，若 `rel.startsWith('..')` 或 `path.isAbsolute(rel)` → `MANIFEST_INVALID`
  - `flow` 扩展名必须为 `.yaml` 或 `.yml`（与 FileGate 一致 —— manifest 是外部输入，
    闸门不能比内部更松）→ 否则 `MANIFEST_INVALID`
  - 重复 `(module,code)` → `MANIFEST_INVALID`
  - 返回的 `flow` 为 posix 相对路径（`path.normalize` 后把 `\\` 换成 `/`，去掉开头 `./`）
  - `precondition`、`chapterTitle` 缺省为 `''`
- Produces: `readManifestFile(appRoot, manifestPath): { appId, device, modules, features }` — 文件不存在 `AppError(422, 'MANIFEST_MISSING', ...)`；读盘后走 parse+normalize
- 身份字段用途（为跨项目留口子，本轮不强制使用）：`appId`/`device` 由 runner 以
  `maestro test -e APP_ID=<appId> -e DEVICE=<device>` 注入，yaml 内写 `${APP_ID}`。
  脚本因此不再硬编码包名，换项目只改 manifest，不改脚本。

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeManifest, parseManifestJson, AppError } from '../src/manifest.js';

const appRoot = '/tmp/dut';

function ok(partial) {
  return normalizeManifest(
    {
      version: 1,
      modules: [{ id: 'todo', title: 'Todo' }],
      features: [{
        module: 'todo', code: '2.1', chapter: 2, chapterTitle: 'X',
        title: 't', criteria: 'c', flow: 'maestro/a.yaml',
      }],
      ...partial,
    },
    { appRoot },
  );
}

it('rejects path escape', () => {
  assert.throws(
    () => ok({ features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: '../secret.yaml' }] }),
    (e) => e instanceof AppError && e.code === 'MANIFEST_INVALID',
  );
});

it('rejects duplicate codes', () => {
  const draft = {
    version: 1,
    modules: [{ id: 'todo', title: 'Todo' }],
    features: [
      { module: 'todo', code: '2.1', chapter: 2, title: 'a', criteria: 'c', flow: 'maestro/a.yaml' },
      { module: 'todo', code: '2.1', chapter: 2, title: 'b', criteria: 'c', flow: 'maestro/b.yaml' },
    ],
  };
  assert.throws(() => normalizeManifest(draft, { appRoot }), (e) => e.code === 'MANIFEST_INVALID');
});

it('accepts a minimal valid document', () => {
  const m = ok({});
  assert.equal(m.features[0].flow, 'maestro/a.yaml');
  assert.equal(m.modules[0].id, 'todo');
});

it('rejects a non-yaml flow', () => {
  assert.throws(
    () => ok({ features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.txt' }] }),
    (e) => e.code === 'MANIFEST_INVALID',
  );
});

it('accepts a manual feature without flow', () => {
  const m = normalizeManifest(
    {
      version: 1,
      modules: [{ id: 'todo', title: 'Todo' }],
      features: [{ module: 'todo', code: '1.6', chapter: 1, title: 'List 数量上限', criteria: 'c', manual: true }],
    },
    { appRoot },
  );
  assert.equal(m.features[0].manual, true);
  assert.equal(m.features[0].flow, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/manifest.test.js`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `src/errors.js` + `src/manifest.js` as specified**

- [ ] **Step 4: Run test**

Run: `node --test test/manifest.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/errors.js src/manifest.js test/manifest.test.js
git commit -m "feat: parse and validate DUT regression.manifest.json"
```

---

### Task 4: `syncFromManifest` 事务

**Files:**
- Create: `src/sync.js`
- Create: `test/sync.test.js`
- Create: `test/fixtures/app/regression.manifest.json`
- Create: `test/fixtures/app/maestro/ok.yaml`（任意一行 `# fixture`）
- Delete later: `src/importer.js`（本任务先停止被 `server.js` 使用可留到 Task 8）

**Interfaces:**
- Consumes: `readManifestFile`, store 方法（Task 2–3）
- Produces: `syncFromManifest({ store, appRoot, manifestPath = 'regression.manifest.json' }): { appId: string, device: string, modules: number, features: number }` — `appId`/`device` 直接透传 manifest 的归一化结果（跨项目口子）
  - `!appRoot` → `AppError(400, 'NO_APP_ROOT', 'appRoot required')`
  - 读+校验失败则 **不调用** 任何写 store（测试：先插入 9.9，校验失败后 9.9 仍在且 hidden=0）
  - 成功：对每个 module `upsertModule`；`hideModulesNotIn(ids)`
  - 每个 feature：`manual` 为 true → `runnable=0, manual=1`（不检查文件）；否则
    `fs.existsSync(path.join(appRoot, feature.flow))` 决定 `runnable` 0/1 且 `manual=0`；
    `upsertFeature`（无 status 字段则新行 `待执行`；已存在不改 status）
  - 人工项**照常收录**：`manual` 不影响 `hideFeaturesNotIn`，人工项始终 `hidden=0`
  - `chapters`：同一 module 下 `chapterTitle` 非空则写入 `chapters_json` 对象键为字符串 chapter
  - `hideFeaturesNotIn` 本次全部 `(module,code)`
  - 整段放在 `store.transaction(fn)` —— 若 store 还没有 `transaction`，加 `transaction(fn) { return db.transaction(fn)(); }` 暴露出去，或在 `sync.js` 里要求 `store.withTransaction`

检查 `createStore` 是否已有类似 `applyCatalogDraft` 的 `db.transaction`。若有，照同样方式在 `syncFromManifest` 内部调用 `store.runSync(fn)` 新方法，避免从外面拿 raw db。

推荐在 store 增加：

```javascript
runSyncSnapshot(fn) {
  return db.transaction(fn)();
}
```

`syncFromManifest` 开头 `store.runSyncSnapshot(() => { ...writes })`。

夹具 manifest：

```json
{
  "version": 1,
  "modules": [{ "id": "todo", "title": "Todo" }],
  "features": [
    {
      "module": "todo",
      "code": "2.1",
      "chapter": 2,
      "chapterTitle": "单 List 内的 Todo",
      "title": "卡片内快速添加",
      "criteria": "出现 E2E_Fast",
      "precondition": "夹具 List",
      "flow": "maestro/ok.yaml"
    },
    {
      "module": "todo",
      "code": "2.2",
      "chapter": 2,
      "title": "缺文件",
      "criteria": "x",
      "precondition": "",
      "flow": "maestro/missing.yaml"
    },
    {
      "module": "todo",
      "code": "1.6",
      "chapter": 1,
      "title": "List 数量上限",
      "criteria": "手动确认达到上限时的提示",
      "precondition": "",
      "manual": true
    }
  ]
}
```

- [ ] **Step 1: Failing tests in `test/sync.test.js`**

```javascript
it('keeps snapshot when manifest is invalid', () => {
  store.upsertFeature({ module: 'todo', code: '9.9', chapter: 9, title: 'old', criteria: 'c', status: STATUS.PASSED });
  assert.throws(() => syncFromManifest({ store, appRoot: fixtureRoot, manifestPath: 'nope.json' }));
  assert.equal(store.getFeature('9.9', 'todo').title, 'old');
  assert.equal(store.getFeature('9.9', 'todo').hidden, 0);
});

it('upserts, marks missing yaml not runnable, hides stale rows', () => {
  store.upsertFeature({ module: 'todo', code: '9.9', chapter: 9, title: 'stale', criteria: 'c', status: STATUS.PASSED, notes: 'keep-me' });
  syncFromManifest({ store, appRoot: fixtureRoot });
  assert.equal(store.getFeature('2.1', 'todo').runnable, 1);
  assert.equal(store.getFeature('2.2', 'todo').runnable, 0);
  assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PENDING_RUN);
  assert.equal(store.getFeature('9.9', 'todo').hidden, 1);
  assert.equal(store.getFeature('9.9', 'todo').status, STATUS.PASSED);
  assert.equal(store.getFeature('9.9', 'todo').notes, 'keep-me');
  assert.deepEqual(store.listFeatures('todo').map((r) => r.code), ['1.6', '2.1', '2.2']);
});

it('keeps manual features visible and not runnable', () => {
  syncFromManifest({ store, appRoot: fixtureRoot });
  const row = store.getFeature('1.6', 'todo');
  assert.equal(row.hidden, 0);
  assert.equal(row.manual, 1);
  assert.equal(row.runnable, 0);
});

it('does not overwrite status on second sync', () => {
  syncFromManifest({ store, appRoot: fixtureRoot });
  store.setStatus('2.1', STATUS.PASSED, 'todo');
  syncFromManifest({ store, appRoot: fixtureRoot });
  assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
});
```

`fixtureRoot` = `path.resolve(import.meta.dirname, 'fixtures/app')`

- [ ] **Step 2: Run to see FAIL**

Run: `node --test test/sync.test.js`

- [ ] **Step 3: Implement `src/sync.js`**

- [ ] **Step 4: PASS `node --test test/sync.test.js`**

- [ ] **Step 5: Commit**

```bash
git add src/sync.js src/store.js test/sync.test.js test/fixtures/app
git commit -m "feat: sync feature snapshot from DUT manifest"
```

---

### Task 5: HTTP — sync、只读目录、错误码、410

**Files:**
- Modify: `src/http.js`
- Modify: `test/http.test.js`
- Modify: `test/exporter.test.js`（`POST /export` 现改 410）

**Interfaces:**
- Consumes: `syncFromManifest`, `AppError`
- `createApp({ store, appRoot, manifestPath, token, runner })` — **删除** 对 `exportFn` 写盘的成功路径；`repoRoot`/`flowRoot` 若仍有调用点，改为 `appRoot`
- `sendError`：若 `err instanceof AppError` 或 `err.code` 为字符串，JSON 为 `{ error: err.message, code: err.code }`
- `GET /modules`：`store.listModules()`，**禁止** fallback `DEFAULT_MODULES`；`source` 字段删除或恒为 `manifest`
- `GET /features`：无 `req.query.module` → `AppError(400, 'FEATURE_MODULE_REQUIRED', ...)`；返回 `features` 每条带 `runnable: Boolean(row.runnable)`；`chapterTitles` 只来自 `store.getModuleMeta(module).chapters`
- `POST /sync`：若 `store.getActiveRun()` 存在 → `AppError(409, 'RUN_ACTIVE', 'a run is active')`
  （清单变更会让正在执行的 flow 路径失效）；否则 `syncFromManifest({ store, appRoot, manifestPath })` 成功 `{ ok: true, modules, features }`
- `POST /modules`、`POST /features`、`PATCH /features/:code`、`POST /export` → `res.status(410).json({ error: '410: gone', code: 'GONE' })`
- `moduleOf` 不再默认 `todo`：缺 module 的执行类请求保持现有 body/query，但 features GET 必须 query
- 执行：若 `getFeature` 的 `runnable === 0` → `AppError(400, row.manual ? 'FEATURE_MANUAL' : 'FLOW_MISSING', ...)`
  （人工项与「yaml 文件缺失」必须可区分，前端据此显示不同文案：
  人工项提示「需手动验证」，缺失文件提示「yaml 未找到」）

- [ ] **Step 1: Failing HTTP tests**

```javascript
it('GET /features without module is 400 FEATURE_MODULE_REQUIRED', async () => {
  const app = createApp({ store: env.store, appRoot: env.repoRoot, token });
  serverHandle = await listen(app);
  const { status, json } = await req(serverHandle.base, 'GET', '/api/features', { token });
  assert.equal(status, 400);
  assert.equal(json.code, 'FEATURE_MODULE_REQUIRED');
});

it('POST /sync loads fixture manifest', async () => {
  const appRoot = path.resolve(import.meta.dirname, 'fixtures/app');
  const app = createApp({ store: env.store, appRoot, token, manifestPath: 'regression.manifest.json' });
  serverHandle = await listen(app);
  const syncRes = await req(serverHandle.base, 'POST', '/api/sync', { token });
  assert.equal(syncRes.status, 200);
  const { status, json } = await req(serverHandle.base, 'GET', '/api/features?module=todo', { token });
  assert.equal(status, 200);
  assert.equal(json.features.find((f) => f.code === '2.1').runnable, true);
  assert.equal(json.features.find((f) => f.code === '2.2').runnable, false);
});

it('POST /export is 410', async () => {
  const app = createApp({ store: env.store, appRoot: env.repoRoot, token });
  serverHandle = await listen(app);
  const { status, json } = await req(serverHandle.base, 'POST', '/api/export', { token });
  assert.equal(status, 410);
  assert.equal(json.code, 'GONE');
});
```

无 appRoot 时 `POST /sync`：

```javascript
it('POST /sync without appRoot is NO_APP_ROOT', async () => {
  const app = createApp({ store: env.store, appRoot: null, token });
  serverHandle = await listen(app);
  const { status, json } = await req(serverHandle.base, 'POST', '/api/sync', { token });
  assert.equal(status, 400);
  assert.equal(json.code, 'NO_APP_ROOT');
});
```

- [ ] **Step 2: Run FAIL** — `node --test test/http.test.js`

- [ ] **Step 3: Implement routes；更新 `tmpEnv` 与其它 http 测试，凡 `GET /features` 改为带 `?module=todo`**

- [ ] **Step 4: PASS `node --test test/http.test.js test/exporter.test.js`**

- [ ] **Step 5: Commit**

```bash
git add src/http.js test/http.test.js test/exporter.test.js
git commit -m "feat(http): sync from manifest and freeze catalog writes"
```

---

### Task 6: Runner cwd = appRoot；缺 yaml 不 spawn

**Files:**
- Modify: `src/runner.js`
- Modify: `src/server.js`
- Modify: `test/runner.test.js`

**Interfaces:**
- `createRunner({ store, appRoot, maestroBin, spawnFn, appId = '', device = '' })` — 参数名从 `repoRoot` 改为 `appRoot`（更新全部调用）
- `spawnFn(maestroBin, ['test', flow.path], { cwd: appRoot })`
- `appId` 非空时在 `flow.path` 之前插入 `'-e', 'APP_ID=<appId>'`；`device` 非空同理插入
  `'-e', 'DEVICE=<device>'`。两者缺省则不加，与当前行为完全一致（跨项目口子，本轮可只传空串）
- `start`：若 feature `runnable === 0` 或文件不存在，抛 `AppError(400, 'FLOW_MISSING', ...)`，**不** `startRun`

- [ ] **Step 1: Extend runner test**

现有 `spawnCalls` 断言把 `opts.cwd` 从 `env.repoRoot` 改为显式 `appRoot`。新增：

```javascript
it('does not spawn when feature is not runnable', () => {
  store.upsertFeature({
    module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c',
    status: STATUS.PENDING_RUN, runnable: 0,
  });
  const runner = createRunner({ store, appRoot: env.dir, spawnFn, maestroBin: 'maestro' });
  assert.throws(() => runner.start('2.1', 'todo'), (e) => e.code === 'FLOW_MISSING');
  assert.equal(spawnCalls.length, 0);
});
```

（注意：该测试与「2.1 可跑」测试不要共用未重置的 runnable；分 it 各自 upsert。）

- [ ] **Step 2: FAIL then implement**

`server.js`：

```javascript
import { syncFromManifest } from './sync.js';
import { appRoot, regressionRoot } from './paths.js';
import { resolveManifestPath } from './config.js';

const manifestPath = resolveManifestPath(regressionRoot);
let dut = { appId: '', device: '' };
if (appRoot) {
  try {
    dut = syncFromManifest({ store, appRoot, manifestPath });
  } catch (e) {
    console.error(String(e.message || e));
  }
}

const runner = createRunner({
  store,
  appRoot,
  maestroBin: resolveMaestroBin(),
  appId: dut.appId || '',
  device: dut.device || '',
});
const app = createApp({ store, appRoot, manifestPath, token, runner });
```

删除 `importIfEmpty`、`syncFlowBindings`、`DEFAULT_MODULES` 循环。无 `appRoot` 仍 `listen`，只打日志 `NO_APP_ROOT`。

- [ ] **Step 3: PASS `node --test test/runner.test.js`**

- [ ] **Step 4: Commit**

```bash
git add src/runner.js src/server.js test/runner.test.js
git commit -m "feat(runner): execute Maestro with cwd at DUT appRoot"
```

---

### Task 7: 看板只读 + 同步

**Files:**
- Modify: `web/src/api.js` — `syncManifest()` → `POST /api/sync`；删除 `createModule`
- Modify: `web/src/App.jsx` — 去掉 `DEFAULT_MODULES` / `CHAPTER_TITLES` 硬编码；模块只来自 `GET /modules`；空列表文案改为「同步 DUT 清单或检查 appRoot」；顶栏加「同步」调用 `syncManifest` 再 `loadFeatures`；去掉创建模块 UI；`GET /features` 始终 `withModule`
- Modify: `web/src/CatalogPanel.jsx` — 删除或改为静态说明「请在 DUT 编辑 regression.manifest.json」，禁止暗示改库
- Modify: `web/src/App.jsx` 空状态里「在 src/seed 里加 seed」文案删除

**Interfaces:**
- Produces: `export function syncManifest() { return api('/api/sync', { method: 'POST' }); }`
- `getSavedModule(fallback)` 的 fallback 改为 `modules[0]?.id || ''`，不要写死 `'todo'`

无法用浏览器工具时：不强制 E2E；保证 `npm --prefix web run build` 成功。

- [ ] **Step 1: 改前端如上**

- [ ] **Step 2: `npm --prefix web run build`**

Expected: 成功，无 `createModule` / `DEFAULT_MODULES` 引用

- [ ] **Step 3: Commit**

```bash
git add web/src
git commit -m "feat(ui): sync button and read-only catalog from DUT"
```

---

### Task 8: 迁出资产、清空本仓、夹具成为唯一脚本

**Files:**
- Create（仅当 `src/paths.js` 的 appRoot 目录存在）: `{appRoot}/regression.manifest.json` 与复制 `{appRoot}/maestro/**`
- Delete: `src/seed/`、`src/importer.js`、本仓根 `maestro/`（全部产品 yaml）
- Delete: `test/importer.test.js`
- Modify: 任何仍 import `SEED_FEATURES` / `importer` / `CHAPTER_TITLES` / `DEFAULT_MODULES` 的测试与 `src/exporter.js`（导出已 410，exporter 可留但测试不得读 seed）
- Modify: `regression.config.example.json` — 去掉「不填则默认 ../..」；注明必填 `appRoot`；可选 `manifestPath`；`sourceDirs` 标为未使用
- Modify: `README.md`、`CLAUDE.md` — 资产在 DUT；控制台 sync+run

**生成 manifest 规则（在删除 seed 之前跑一次性脚本，可写在 `scripts/export-dut-manifest.js` 然后用完删除或保留）：**

- modules：`[{id:todo,title:Todo},{id:routine,title:Routine},{id:chore,title:Chore}]`（routine/chore 可无 features）
- 只收录 `FLOW_BINDINGS` 里有的 `(module,code)`
- `chapterTitle` 来自当时的 `CHAPTER_TITLES[module][chapter]`
- **例外**：1.6「List 数量上限」无 flow，仍收录并标 `manual: true`（**不要跳过**）——
  跳过会让它被 hide 而永久消失
- `cp -R maestro` 到 DUT，保持相对路径

**删除前置条件（硬约束，不可跳过）：** 必须先确认 DUT 侧 `regression.manifest.json` 已写入、
`maestro/**` 已复制，且对 manifest 中每条非 manual 的 `flow` 逐个 `existsSync` 校验通过，
才允许执行 Step 2 删除本仓资产。

若 appRoot 不存在、复制失败或校验未通过 → **中止 Task 8，保留本仓 `src/seed/` 与 `maestro/`**，
在执行日志写明「DUT 未就绪，未迁出；本仓资产保留」。

**绝不允许在 DUT 侧没有完整副本的情况下删除唯一资产** —— 那会永久丢失 24 个功能点的定义。
删除前建议先 `git tag pre-manifest-migration` 留一个可回退点。

- [ ] **Step 1: 写并运行导出脚本，复制 maestro**

- [ ] **Step 2: 删除本仓 seed/importer/产品 maestro；修所有破掉的 import**

- [ ] **Step 3: `npm test`**

Expected: 全绿。`rg "src/seed|SEED_FEATURES|importIfEmpty" --glob '!docs/**'` 无生产代码命中。

- [ ] **Step 4: Commit**（本仓与 DUT 分开 commit；DUT 若在另一仓库则只在那边提交 yaml+manifest）

```bash
git add -A src test maestro scripts README.md CLAUDE.md regression.config.example.json
git commit -m "refactor: move regression assets to DUT manifest"
```

---

### Task 9: 全量验收

- [ ] **Step 1: `npm test`**

Expected: PASS

- [ ] **Step 2: 对照 spec 验收清单**

1. 本仓无产品 `maestro/`、无 `src/seed/`，测试仍绿  
2. 有 DUT 时启动后列表与 manifest 一致；runner 测试证明 cwd=appRoot  
3. `test/sync.test.js` 覆盖隐藏旧功能点且 status/notes 保留；`manual: true` 条目不被隐藏且不可执行  
4. `POST /sync` 在 run 活跃时返回 `RUN_ACTIVE`（409），不改动快照  
5. 无 appRoot 时 `POST /sync` 为 `NO_APP_ROOT`，不会 spawn 本仓路径  
6. DUT 侧 manifest 与 `maestro/**` 均已落盘且逐条校验存在（Task 8 的前置条件）  

- [ ] **Step 3: 若有缺口，补测试后 commit `test: cover DUT sync acceptance`**

---

## Spec coverage（自检）

| Spec | Task |
|---|---|
| Manifest schema / 校验 / 不写回 | 3 |
| 启动+POST /sync 同一函数 | 4, 5, 6 |
| hidden 保留 run、status 不覆盖、notes 保留 | 2, 4 |
| runnable / 缺 yaml | 4, 5, 6 |
| 配置优先级与无默认 ../.. | 1 |
| GET /features?module= | 5, 7 |
| 410 写接口与禁用 export | 5 |
| runner cwd | 6 |
| 迁出 + 清空 + fixture | 4, 8 |
| UI 只读 + 同步 | 7 |
| manual 人工项收录且不隐藏 | 3, 4, 8 |
| flow 扩展名校验（对齐 FileGate） | 3 |
| sync 与运行中 run 互斥 | 5 |
| 错误码 | 1, 3, 5 |
