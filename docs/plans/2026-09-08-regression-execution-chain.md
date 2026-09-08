# Regression Execution Chain Implementation Plan

> **状态校准（2026-09-08）：** Task 1–2 代码已落地，flow 唯一性与
> `todo/0.2` 绑定已用数据核验（重复绑定 0 行）。文末
> Manual acceptance 需 USB 真机，未做。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让回归控制台在不同启动环境下可靠执行正确的 Maestro flow，缺少可执行文件时记录失败而不是崩溃。

**Architecture:** runner 负责解析 Maestro 可执行文件并收口 child 的 `error/close` 为一次幂等的 run 结束；store/database 负责保证每个 `(module, code, kind)` 只有一个有效 flow 绑定，并迁移当前重复数据。两个任务分别提交、分别真机验证。

**Tech Stack:** Node.js ESM、better-sqlite3、node:test、Express。

## Global Constraints

- 不改 Android App。
- 不运行 Gradle。
- 不改 Maestro YAML 行为。
- 一次只交一个可真机验证单元；任务 1 验证后再做任务 2。

---

### Task 1: Maestro executable resolution and spawn failure handling

**Files:**
- Modify: `tools/regression-console/src/runner.js`
- Modify: `tools/regression-console/src/server.js`
- Test: `tools/regression-console/test/runner.test.js`

**Interfaces:**
- Produces: `resolveMaestroBin({ env, homeDir, existsSync }): string`
- `createRunner({ maestroBin })` receives the resolved absolute path in production.
- A child `error` event finishes the run once with `exit_code=127`, writes the error into `log_excerpt`, and releases the runner slot.

- [x] **Step 1: Write failing tests**

Add cases proving:

```js
assert.equal(
  resolveMaestroBin({
    env: { PATH: '/usr/bin' },
    homeDir: '/Users/test',
    existsSync: (p) => p === '/Users/test/.maestro/bin/maestro',
  }),
  '/Users/test/.maestro/bin/maestro',
);

children[0].emit('error', Object.assign(new Error('spawn maestro ENOENT'), { code: 'ENOENT' }));
await tick();
assert.equal(env.store.getFeature('2.1').status, STATUS.FAILED);
assert.equal(env.store.getActiveRun(), undefined);
assert.match(runRow.log_excerpt, /ENOENT/);
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `cd tools/regression-console && node --test test/runner.test.js`

Expected: import/export or assertions fail because resolution and child error handling do not exist.

- [x] **Step 3: Implement minimal resolution and idempotent finish**

Resolution order:

1. `MAESTRO_BIN` if non-empty.
2. First executable/file named `maestro` under `PATH`.
3. `$HOME/.maestro/bin/maestro`.
4. Literal `maestro` so the eventual ENOENT is captured and shown.

In runner, both `error` and `close` call one guarded `settle(code, extraLog)` function. `error` uses 127. A later `close` after `error` must not finish twice.

- [x] **Step 4: Run focused and full tests**

Run:

```bash
cd tools/regression-console
node --test test/runner.test.js
npm test
npm run build-ui
```

Expected: all exit 0.

- [x] **Step 5: Commit**

```bash
git add tools/regression-console/src/runner.js \
  tools/regression-console/src/server.js \
  tools/regression-console/test/runner.test.js
git commit -m "fix(regression-console): handle unavailable Maestro runner"
```

### Task 2: Unique flow binding and migration

**Files:**
- Modify: `tools/regression-console/src/db.js`
- Modify: `tools/regression-console/src/store.js`
- Modify: `tools/regression-console/src/importer.js`
- Modify: `tools/regression-console/src/seed/index.js`
- Test: `tools/regression-console/test/store.test.js`
- Test: `tools/regression-console/test/attemptStore.test.js`
- Test: `tools/regression-console/test/importer.test.js`

**Interfaces:**
- `upsertFlow({ feature_module, feature_code, path, kind })` replaces the one binding for the same `(module, code, kind)`.
- Database unique index: `(feature_module, feature_code, kind)`.
- Migration keeps the newest row per key, then creates the unique index.

- [x] **Step 1: Write failing store and migration tests**

Prove two upserts for `todo/0.2/flow` leave exactly one row and the second path wins. Create an old database containing duplicate flow rows, reopen it, and assert migration keeps the highest-id row.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd tools/regression-console
node --test test/store.test.js test/attemptStore.test.js test/importer.test.js
```

- [x] **Step 3: Implement migration and upsert**

Before adding the unique index:

```sql
DELETE FROM flow
WHERE id NOT IN (
  SELECT MAX(id)
  FROM flow
  GROUP BY feature_module, feature_code, kind
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_feature_kind
ON flow(feature_module, feature_code, kind);
```

Change writes to `INSERT ... ON CONFLICT(feature_module, feature_code, kind) DO UPDATE SET path=excluded.path, updated_at=excluded.updated_at`.

- [x] **Step 4: Correct seed binding and synchronize existing DB**

Keep one intended mapping per feature. `todo/0.2` must map to `maestro/kill-relaunch.yaml`; login-retention must not silently override it. Run the normal database migration once and verify the duplicate query returns zero rows:

```sql
SELECT feature_module, feature_code, kind, COUNT(*)
FROM flow
GROUP BY feature_module, feature_code, kind
HAVING COUNT(*) > 1;
```

- [x] **Step 5: Run tests and commit**

Run `npm test && npm run build-ui`, then commit:

```bash
git add tools/regression-console/src/db.js \
  tools/regression-console/src/store.js \
  tools/regression-console/src/importer.js \
  tools/regression-console/src/seed/index.js \
  tools/regression-console/test
git commit -m "fix(regression-console): keep one flow per feature"
```

## Manual acceptance

1. 从 Cursor/IDE 启动控制台，点一条「待执行」：应启动 `~/.maestro/bin/maestro`。
2. 临时用不存在的 `MAESTRO_BIN` 启动隔离服务并执行：服务保持在线，条目变「失败」，日志含 ENOENT。
3. `todo/0.2` 执行记录里的 flow 必须是 `maestro/kill-relaunch.yaml`。
4. SQLite 重复绑定查询返回 0 行。
