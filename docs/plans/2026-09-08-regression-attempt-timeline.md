# Regression Attempt Timeline Implementation Plan

> **状态校准（2026-09-08）：** 代码已全部落地，勾选状态按实际情况补记。
> 唯「Task 5 Step 3 Browser acceptance」属浏览器人工路径，未做，保持未勾选。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将回归控制台固定步骤页改为可持久化的轮次时间线，步骤可点开详情，页面底部始终显示当前进度和主操作。

**Architecture:** 新增 `workflow_attempt` 作为一轮脚本生成到执行结果的聚合根，`run` 与 `ai_session` 通过可空 `attempt_id` 归属轮次。HTTP 列表只返回轮次摘要，详情按 attempt 单独获取；React 用独立的时间线、弹框和当前详情组件替换固定六段流程。

**Tech Stack:** Node.js ESM、better-sqlite3、Express、React/Vite、node:test。

## Global Constraints

- 只改 `tools/regression-console` 和本计划文档，不改 Android 代码。
- 不修改 Maestro YAML 语义、FileGate 和 AI prompt 铁律。
- 重新生成脚本创建新轮；不改脚本的 rerun 留在同一轮。
- 弹框只读；所有主操作只出现在页面底部当前进度区。
- 不运行 Gradle；验证使用 Node 单测、前端构建和浏览器人工路径。
- 当前工作区已有未提交改动，本计划不自动创建 git commit，避免混入既有工作。

---

### Task 1: 轮次数据模型与 Store

**Files:**
- Modify: `tools/regression-console/src/db.js`
- Modify: `tools/regression-console/src/store.js`
- Create: `tools/regression-console/test/attemptStore.test.js`

**Interfaces:**
- Produces: `createAttempt(code, module, hint?)`
- Produces: `getCurrentAttempt(code, module)`
- Produces: `listAttempts(code, module, limit?)`
- Produces: `getAttemptDetail(attemptId)`
- Produces: `setAttemptAnalyzeSession(attemptId, sessionId)`
- Produces: `setAttemptStatus(attemptId, status, ended?)`
- Changes: `startRun(code, module, attemptId)` and `createAiSession({... attempt_id })`

- [x] **Step 1: Write failing Store tests**

  Cover these real behaviors with an in-memory SQLite database:

  ```javascript
  test('creates monotonically numbered attempts per feature', () => {
    const first = store.createAttempt('2.1', 'todo');
    const second = store.createAttempt('2.1', 'todo', '保存后弹窗未关闭');
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.equal(second.hint, '保存后弹窗未关闭');
  });

  test('attaches analyze sessions and runs to one attempt', () => {
    const attempt = store.createAttempt('2.1', 'todo');
    const session = store.createAiSession({ /* existing required fields */, attempt_id: attempt.id });
    const run = store.startRun('2.1', 'todo', attempt.id);
    assert.equal(store.getAttemptDetail(attempt.id).analyzeSession.id, session.id);
    assert.equal(store.getAttemptDetail(attempt.id).runs[0].id, run.id);
  });
  ```

- [x] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- test/attemptStore.test.js`

  Expected: failure because `workflow_attempt` and Store methods do not exist.

- [x] **Step 3: Add schema and migration**

  Add `workflow_attempt` with unique `(feature_module, feature_code, sequence)`, then add nullable `attempt_id` to `run` and `ai_session`. Migration must use `PRAGMA table_info` guards so old databases open repeatedly without error.

- [x] **Step 4: Implement Store APIs**

  Use a transaction when assigning the next `sequence`. `getAttemptDetail` returns:

  ```javascript
  {
    ...attempt,
    analyzeSession: objectOrNull,
    runs: [],
    diagnoses: [],
  }
  ```

  `listAttempts` returns lightweight rows ordered by sequence ascending, capped to the newest 20.

- [x] **Step 5: Run focused and existing Store tests**

  Run: `npm test -- test/attemptStore.test.js test/diagnoseLoop.test.js`

  Expected: PASS.

---

### Task 2: HTTP 生命周期绑定

**Files:**
- Modify: `tools/regression-console/src/http.js`
- Modify: `tools/regression-console/src/store.js`
- Modify: `tools/regression-console/test/http.test.js`

**Interfaces:**
- Consumes: Task 1 Store APIs.
- Produces: feature payload field `attempts`
- Produces: `GET /api/attempts/:id`

- [x] **Step 1: Write failing HTTP tests**

  Add tests proving:

  ```javascript
  // First analyze opens attempt #1 and links the analyze session.
  assert.equal(body.attempt.sequence, 1);
  assert.equal(body.session.attempt_id, body.attempt.id);

  // Reject ends that attempt; a later analyze creates #2.
  assert.equal(secondAnalyze.attempt.sequence, 2);

  // Two runs without regenerate share the same attempt.
  assert.deepEqual(detail.runs.map((run) => run.attempt_id), [attemptId, attemptId]);

  // Feature list has attempt summaries and detail endpoint has sessions/runs/diagnoses.
  assert.equal(features[0].attempts.length, 2);
  assert.equal(detail.diagnoses[0].attempt_id, attemptId);
  ```

- [x] **Step 2: Run HTTP tests and verify RED**

  Run: `npm test -- test/http.test.js`

  Expected: assertions fail because responses lack attempts and links.

- [x] **Step 3: Bind analyze/apply/reject**

  At analyze start, reuse only an unfinished attempt that has not acquired an analyze session; otherwise create a new attempt. Link the created session and return `{ attempt, session, ...existingPayload }`. Apply changes status to `open`; reject changes status to `rejected` and writes `ended_at`.

- [x] **Step 4: Bind run/finish/diagnose**

  `startRun` uses the latest approved open attempt. Finish updates attempt to `passed` with `ended_at`, or `failed` without ending it. Diagnose links its `ai_session` to the failed run's attempt.

- [x] **Step 5: Add summary/detail reads**

  `/api/features?module=` returns up to 20 summaries for each feature. `GET /api/attempts/:id` rejects attempts outside the requested module with 404 and returns full detail for valid rows.

- [x] **Step 6: Run backend suite**

  Run: `npm test`

  Expected: PASS.

---

### Task 3: Derive timeline view model

**Files:**
- Create: `tools/regression-console/web/src/attemptViewModel.js`
- Create: `tools/regression-console/test/attemptViewModel.test.js`

**Interfaces:**
- Produces: `buildAttemptSteps(attempt)`
- Produces: `resolveCurrentStep(attempt)`

- [x] **Step 1: Write failing pure-function tests**

  Cover empty, analyzing, pending review, running, failed without diagnosis, failed with diagnosis, passed, and rejected attempts. Assert only occurred nodes are returned and reruns collapse into one execution node with `runCount`.

- [x] **Step 2: Run and verify RED**

  Run: `npm test -- test/attemptViewModel.test.js`

  Expected: module-not-found or missing export failure.

- [x] **Step 3: Implement minimal derivation**

  Return nodes with stable shape:

  ```javascript
  {
    id: 'generate|review|run|failed|passed|diagnose|hint',
    label: '生成',
    state: 'done|active|failed',
    summary: '共 2 次，最近失败',
  }
  ```

  Follow the exact current-node precedence in the approved design.

- [x] **Step 4: Run focused tests**

  Run: `npm test -- test/attemptViewModel.test.js`

  Expected: PASS.

---

### Task 4: Timeline, modal, and current detail UI

**Files:**
- Create: `tools/regression-console/web/src/AttemptTimeline.jsx`
- Create: `tools/regression-console/web/src/StepModal.jsx`
- Create: `tools/regression-console/web/src/CurrentDetail.jsx`
- Modify: `tools/regression-console/web/src/App.jsx`
- Modify: `tools/regression-console/web/src/styles.css`

**Interfaces:**
- Consumes: Task 2 attempt payloads and Task 3 view-model functions.
- `AttemptTimeline({ attempts, currentAttemptId, onStepClick })`
- `StepModal({ open, attempt, stepId, onClose })`
- `CurrentDetail({ selected, attempt, stepId, actions, taskState })`

- [x] **Step 1: Extract shared display components**

  Export or move `TaskPanel`, `StepList`, and `DiagnosisConversation` so `CurrentDetail` and `StepModal` reuse the same rendering instead of duplicating diagnosis and step formatting.

- [x] **Step 2: Build timeline**

  Render the exact information hierarchy:

  ```text
  说明
  └─ 第 1 轮：生成 → 确认 → 执行 → 失败 → 诊断
  └─ 第 2 轮：补充线索 → 生成 → 确认 → 执行中…
  ```

  Completed historical rounds are compact; current round is emphasized. Every rendered node is a keyboard-accessible button.

- [x] **Step 3: Build read-only modal**

  Use `role="dialog"`, `aria-modal="true"`, close button, Escape handler, and backdrop close. Fetch `/api/attempts/:id` only on first open and cache by ID in `App`.

- [x] **Step 4: Replace fixed six sections**

  Keep the existing feature heading and explanation. Remove the numbered fixed sections and session-history table. Route existing callbacks (`onAnalyze`, `onApply`, `onReject`, `onRun`, `onAbort`, `onDiagnose`) into `CurrentDetail`.

- [x] **Step 5: Style centered document flow**

  Reuse `--app-max`. Add timeline connectors, active pulse, terminal state colors, responsive node wrapping, modal, and bottom current-detail card. Do not use sticky/fixed positioning for current detail.

- [x] **Step 6: Build frontend**

  Run: `npm run build-ui`

  Expected: Vite build succeeds without JSX/import errors.

---

### Task 5: End-to-end regression checks

**Files:**
- Modify only if failures expose defects in files from Tasks 1–4.

- [x] **Step 1: Run complete Node suite**

  Run: `npm test`

  Expected: all tests PASS.

- [x] **Step 2: Run frontend production build**

  Run: `npm run build-ui`

  Expected: build succeeds.

- [ ] **Step 3: Browser acceptance**

  Start the console and verify one feature through: empty timeline → generate → review → approve → failed run → diagnose → generate next attempt. Click a historical step and confirm the modal changes while the bottom detail remains bound to the latest current node. Refresh and confirm attempts persist.

- [x] **Step 4: Report scope and manual device path**

  List changed files, expected behavior changes, known migration risk, and the exact device/browser verification path. Do not claim Gradle verification.
