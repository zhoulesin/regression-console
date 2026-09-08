# Catalog 前端功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为回归控制台添加 AI 增量生成功能点的前端界面，让用户可以通过 Web 界面按范围提示生成新功能点，审阅后确认入库或打回。

**Architecture:** 创建独立的 CatalogPanel 组件，App.jsx 只管理入口和状态切换。复用现有 TaskPanel、RegressionNoteInput 等组件，通过 API 调用后端 catalog 接口。

**Tech Stack:** React/Vite、现有 CSS 变量和组件样式、fetch API

## Global Constraints

- 复用现有 CSS 变量（`--bg`、`--ok`、`--wait`、`--warn`、`--hand`）
- 复用现有组件样式（`.pill`、`.card`、`.flow-hd`、`.flow-content`）
- 遵循现有代码风格（ESM、函数组件、useState/useEffect）
- 不引入新的依赖
- 入口在模块 Tab 下方、章节列表上方
- catalog 进度区替换右侧详情
- skipped 按 reason 分组折叠
- 页面刷新自动恢复 pending catalog

---

### Task 1: 添加 catalog API 调用

**Files:**
- Modify: `web/src/api.js`

**Interfaces:**
- Consumes: 现有 `api()` 函数、`withModule()` 函数
- Produces: `getCatalogPending(module)`、`postCatalogPropose(module, hint)`、`postCatalogApply(module, sessionId)`、`postCatalogReject(module, sessionId, note)`

- [ ] **Step 1: 添加 catalog API 函数**

在 `web/src/api.js` 末尾添加：

```javascript
export async function getCatalogPending(module) {
  return api(withModule('/api/catalog/pending', module));
}

export async function postCatalogPropose(module, hint) {
  return api(withModule('/api/catalog/propose', module), {
    method: 'POST',
    body: JSON.stringify({ hint }),
  });
}

export async function postCatalogApply(module, sessionId) {
  return api(withModule('/api/catalog/apply', module), {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function postCatalogReject(module, sessionId, note) {
  return api(withModule('/api/catalog/reject', module), {
    method: 'POST',
    body: JSON.stringify({ sessionId, note }),
  });
}
```

- [ ] **Step 2: 验证 API 函数**

检查文件语法正确，无 TypeScript/ESLint 错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/api.js
git commit -m "feat(catalog): add catalog API calls"
```

---

### Task 2: 创建 CatalogPanel 组件

**Files:**
- Create: `web/src/CatalogPanel.jsx`

**Interfaces:**
- Consumes: `postCatalogPropose`、`postCatalogApply`、`postCatalogReject`、`analyzeStreamUrl`
- Produces: `CatalogPanel` 组件

- [ ] **Step 1: 创建 CatalogPanel 组件骨架**

```jsx
import { useState } from 'react';
import { postCatalogPropose, postCatalogApply, postCatalogReject, analyzeStreamUrl } from './api.js';

const REASON_LABELS = {
  duplicate_code: '已有同编号',
  duplicate_title: '已有同标题',
  batch_limit: '超过单次 15 条',
  apply_conflict: '确认入库时编号已被占用',
  invalid: '字段不合法',
};

function groupByReason(skipped) {
  const groups = {};
  for (const item of skipped) {
    const reason = item.reason || 'invalid';
    if (!groups[reason]) groups[reason] = [];
    groups[reason].push(item);
  }
  return Object.entries(groups);
}

export function CatalogPanel({ moduleId, pending, draft, busy, error, onPropose, onApply, onReject, onBack, analyzing, analyzeLogs }) {
  const [hint, setHint] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  function handlePropose() {
    if (!hint.trim() || busy) return;
    onPropose(hint.trim());
  }

  function handleApply() {
    if (!pending || busy) return;
    onApply(pending.id);
  }

  function handleReject() {
    if (!pending || busy || !rejectNote.trim()) return;
    onReject(pending.id, rejectNote.trim());
  }

  return (
    <div className="catalog-panel">
      {/* 头部 */}
      <div className="catalog-hd">
        <button type="button" className="back-btn" onClick={onBack}>
          ← 返回功能点
        </button>
        <h2>补功能点</h2>
      </div>

      {/* 错误提示 */}
      {error && <div className="err">{error}</div>}

      {/* 范围提示输入 */}
      {!draft && (
        <div className="catalog-hint-section">
          <label htmlFor="catalog-hint">范围提示（必填）</label>
          <textarea
            id="catalog-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="描述需要补充的功能点范围，例如：Todo 的快速添加和完整创建流程"
            disabled={busy || analyzing}
            maxLength={2000}
          />
          <div className="hint-footer">
            <span>{hint.length}/2000</span>
            <button
              type="button"
              className="primary"
              onClick={handlePropose}
              disabled={busy || analyzing || !hint.trim()}
            >
              {analyzing ? '生成中...' : '开始生成'}
            </button>
          </div>
        </div>
      )}

      {/* 生成中状态 */}
      {analyzing && (
        <div className="catalog-generating">
          <div className="generating-header">
            <span className="generating-icon">⏳</span>
            <span>AI 正在生成功能点...</span>
          </div>
          {analyzeLogs && (
            <pre className="generating-logs">{analyzeLogs}</pre>
          )}
        </div>
      )}

      {/* 审阅区域 */}
      {draft && !analyzing && (
        <div className="catalog-review">
          {/* rationale */}
          <div className="catalog-rationale">
            <h3>分析依据</h3>
            <p>{draft.rationale}</p>
          </div>

          {/* 新功能点卡片 */}
          <div className="catalog-features">
            <h3>新增功能点 ({draft.features.length})</h3>
            {draft.features.length === 0 ? (
              <p className="muted">本次无新增功能点</p>
            ) : (
              <div className="feature-cards">
                {draft.features.map((f) => (
                  <div key={f.code} className="catalog-feature-card">
                    <div className="card-header">
                      <span className="code">{f.code}</span>
                      <span className="chapter">第 {f.chapter} 章</span>
                    </div>
                    <div className="title">{f.title}</div>
                    <div className="criteria">
                      <span className="label">判定依据：</span>
                      {f.criteria}
                    </div>
                    {f.precondition && (
                      <div className="precondition">
                        <span className="label">数据前提：</span>
                        {f.precondition}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* skipped 分组 */}
          {draft.skipped && draft.skipped.length > 0 && (
            <div className="catalog-skipped">
              <h3>已跳过 ({draft.skipped.length})</h3>
              <p className="muted">以下已有条目被跳过，不会改库里的旧条</p>
              {groupByReason(draft.skipped).map(([reason, items]) => (
                <details key={reason} className="skipped-group">
                  <summary>
                    {REASON_LABELS[reason] || reason} ({items.length})
                  </summary>
                  <div className="skipped-items">
                    {items.map((item) => (
                      <div key={`${item.code}-${item.title}`} className="skipped-item">
                        <span className="code">{item.code}</span>
                        <span className="title">{item.title}</span>
                        {item.detail && <span className="detail">({item.detail})</span>}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="catalog-actions">
            <button
              type="button"
              className="primary"
              onClick={handleApply}
              disabled={busy || !draft.features.length}
            >
              确认入库 ({draft.features.length} 条)
            </button>
            <div className="reject-section">
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="打回原因（必填）"
                disabled={busy}
                maxLength={2000}
              />
              <button
                type="button"
                className="danger"
                onClick={handleReject}
                disabled={busy || !rejectNote.trim()}
              >
                打回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证组件语法**

检查 JSX 语法正确，无导入错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/CatalogPanel.jsx
git commit -m "feat(catalog): add CatalogPanel component"
```

---

### Task 3: 在 App.jsx 中集成 CatalogPanel

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `CatalogPanel`、`getCatalogPending`、`postCatalogPropose`、`postCatalogApply`、`postCatalogReject`、`analyzeStreamUrl`
- Produces: 左侧「补功能点」入口、右侧 catalog 进度区

- [ ] **Step 1: 添加 catalog 状态和 API 调用**

在 `App.jsx` 的 imports 中添加：

```javascript
import { CatalogPanel } from './CatalogPanel.jsx';
import {
  getCatalogPending,
  postCatalogPropose,
  postCatalogApply,
  postCatalogReject,
} from './api.js';
```

在组件内部添加状态：

```javascript
// catalog 相关状态
const [catalogMode, setCatalogMode] = useState(false);
const [catalogPending, setCatalogPending] = useState(null);
const [catalogDraft, setCatalogDraft] = useState(null);
const [catalogBusy, setCatalogBusy] = useState(false);
const [catalogError, setCatalogError] = useState('');
const [catalogAnalyzing, setCatalogAnalyzing] = useState(false);
const [catalogLogs, setCatalogLogs] = useState('');
```

- [ ] **Step 2: 添加 catalog 操作函数**

```javascript
// catalog 操作
async function handleCatalogPropose(hint) {
  setCatalogBusy(true);
  setCatalogError('');
  setCatalogAnalyzing(true);
  setCatalogLogs('');
  try {
    const data = await postCatalogPropose(moduleId, hint);
    setCatalogPending(data.session);
    setCatalogDraft(data.draft);
    setCatalogLogs('');
  } catch (e) {
    setCatalogError(String(e.message || e));
  } finally {
    setCatalogBusy(false);
    setCatalogAnalyzing(false);
  }
}

async function handleCatalogApply(sessionId) {
  setCatalogBusy(true);
  setCatalogError('');
  try {
    await postCatalogApply(moduleId, sessionId);
    setCatalogMode(false);
    setCatalogPending(null);
    setCatalogDraft(null);
    await refresh();
  } catch (e) {
    setCatalogError(String(e.message || e));
  } finally {
    setCatalogBusy(false);
  }
}

async function handleCatalogReject(sessionId, note) {
  setCatalogBusy(true);
  setCatalogError('');
  try {
    await postCatalogReject(moduleId, sessionId, note);
    setCatalogPending(null);
    setCatalogDraft(null);
  } catch (e) {
    setCatalogError(String(e.message || e));
  } finally {
    setCatalogBusy(false);
  }
}

function handleCatalogBack() {
  setCatalogMode(false);
  setCatalogError('');
}
```

- [ ] **Step 3: 添加 pending catalog 检查**

在现有的 `useEffect` 中添加 catalog pending 检查：

```javascript
useEffect(() => {
  // 检查是否有 pending catalog
  async function checkCatalogPending() {
    try {
      const data = await getCatalogPending(moduleId);
      if (data.session) {
        setCatalogMode(true);
        setCatalogPending(data.session);
        setCatalogDraft(data.draft);
      }
    } catch (e) {
      // 忽略错误
    }
  }
  checkCatalogPending();
}, [moduleId]);
```

- [ ] **Step 4: 添加左侧入口按钮**

在 `<aside className="col-left">` 内部、`byChapter.map` 之前添加：

```jsx
<div className="catalog-entry">
  <button
    type="button"
    className={catalogMode ? 'active' : ''}
    onClick={() => {
      setCatalogMode(!catalogMode);
      setCatalogError('');
    }}
  >
    + 补功能点
  </button>
</div>
```

- [ ] **Step 5: 添加右侧 CatalogPanel**

在 `<section className="col-right">` 中，修改条件渲染：

```jsx
{catalogMode ? (
  <CatalogPanel
    moduleId={moduleId}
    pending={catalogPending}
    draft={catalogDraft}
    busy={catalogBusy}
    error={catalogError}
    analyzing={catalogAnalyzing}
    analyzeLogs={catalogLogs}
    onPropose={handleCatalogPropose}
    onApply={handleCatalogApply}
    onReject={handleCatalogReject}
    onBack={handleCatalogBack}
  />
) : !selected ? (
  <div className="empty">选择左侧功能点</div>
) : (
  // 现有的功能点详情
  ...
)}
```

- [ ] **Step 6: 添加 catalog 样式**

在 `styles.css` 中添加：

```css
/* Catalog 入口 */
.catalog-entry {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.catalog-entry button {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  transition: all 0.2s;
}

.catalog-entry button:hover {
  border-color: var(--ok);
  color: var(--ok);
}

.catalog-entry button.active {
  background: var(--ok);
  border-color: var(--ok);
  color: #fff;
}

/* Catalog 面板 */
.catalog-panel {
  padding: 20px;
}

.catalog-hd {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.catalog-hd h2 {
  margin: 0;
  font-size: 1.2rem;
}

.back-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
}

.back-btn:hover {
  border-color: var(--ok);
  color: var(--ok);
}

/* 范围提示输入 */
.catalog-hint-section {
  margin-bottom: 24px;
}

.catalog-hint-section label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.catalog-hint-section textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  resize: vertical;
}

.hint-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.hint-footer span {
  color: var(--muted);
  font-size: 0.9rem;
}

/* 生成中状态 */
.catalog-generating {
  padding: 20px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 24px;
}

.generating-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.generating-logs {
  padding: 12px;
  background: var(--bg-dark);
  border-radius: 4px;
  font-size: 0.85rem;
  max-height: 200px;
  overflow-y: auto;
}

/* 审阅区域 */
.catalog-review {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.catalog-rationale {
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.catalog-rationale h3 {
  margin: 0 0 8px 0;
  font-size: 1rem;
}

.catalog-rationale p {
  margin: 0;
  color: var(--text);
}

/* 功能点卡片 */
.catalog-features h3 {
  margin: 0 0 12px 0;
  font-size: 1rem;
}

.feature-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.catalog-feature-card {
  padding: 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.card-header .code {
  font-weight: 600;
  color: var(--ok);
}

.card-header .chapter {
  color: var(--muted);
  font-size: 0.9rem;
}

.catalog-feature-card .title {
  font-weight: 500;
  margin-bottom: 8px;
}

.catalog-feature-card .criteria,
.catalog-feature-card .precondition {
  font-size: 0.9rem;
  color: var(--text);
  margin-bottom: 4px;
}

.catalog-feature-card .label {
  color: var(--muted);
}

/* Skipped 分组 */
.catalog-skipped h3 {
  margin: 0 0 8px 0;
  font-size: 1rem;
}

.skipped-group {
  margin-bottom: 8px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.skipped-group summary {
  cursor: pointer;
  font-weight: 500;
}

.skipped-items {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.skipped-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.9rem;
}

.skipped-item .code {
  color: var(--muted);
  min-width: 40px;
}

.skipped-item .detail {
  color: var(--muted);
  font-size: 0.85rem;
}

/* 操作按钮 */
.catalog-actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.reject-section {
  display: flex;
  gap: 12px;
}

.reject-section textarea {
  flex: 1;
  min-height: 60px;
  padding: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  resize: vertical;
}
```

- [ ] **Step 7: 验证前端构建**

```bash
cd web && npm run build
```

Expected: 构建成功，无错误。

- [ ] **Step 8: Commit**

```bash
git add web/src/App.jsx web/src/styles.css
git commit -m "feat(catalog): integrate CatalogPanel into App"
```

---

### Task 4: 测试和验证

**Files:**
- Modify: `web/src/App.jsx` (如果需要修复问题)
- Modify: `web/src/CatalogPanel.jsx` (如果需要修复问题)

**Interfaces:**
- Consumes: 所有前面任务的产出
- Produces: 可工作的 catalog 前端功能

- [ ] **Step 1: 运行前端构建**

```bash
cd web && npm run build
```

Expected: 构建成功。

- [ ] **Step 2: 启动后端服务**

```bash
npm start
```

Expected: 服务启动成功。

- [ ] **Step 3: 测试 catalog 功能**

1. 打开浏览器访问控制台
2. 点击左侧「补功能点」按钮
3. 输入范围提示，例如："Todo 的快速添加功能"
4. 点击「开始生成」
5. 等待 AI 生成完成
6. 审阅生成的功能点卡片
7. 查看 skipped 分组
8. 测试「确认入库」和「打回」功能
9. 测试页面刷新后自动恢复 pending catalog

- [ ] **Step 4: 修复发现的问题**

如果测试中发现问题，修复代码并重新测试。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(catalog): complete catalog frontend implementation"
```

---

## Self-Review

**Spec coverage:**
- ✅ 左侧「补功能点」入口
- ✅ catalog 进度区（范围提示 → 生成 → 审阅）
- ✅ 审阅卡片（编号/章/标题/判定依据/数据前提）
- ✅ skipped 按 reason 分组折叠
- ✅ 确认入库 / 打回（必填备注）
- ✅ 页面刷新自动恢复 pending catalog

**Placeholder scan:** 无 TBD、TODO 或不完整的部分。

**Type consistency:** 所有函数名、参数名、属性名在各任务间保持一致。

**执行选项：**
1. **Subagent-Driven（推荐）** - 每个任务分发新子代理，任务间审查，快速迭代
2. **Inline Execution** - 在当前会话中执行任务，批量执行带检查点

**选择哪种方式？**