# 动态模块管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持用户动态创建新模块，模块列表从数据库加载，前端提供添加模块入口。

**Architecture:** 扩展 `module_meta` 表存储模块定义，后端提供 `/api/modules` CRUD 接口，前端从 API 动态加载模块列表并在 Tab 栏添加 "+" 按钮。

**Tech Stack:** Node.js ESM、better-sqlite3、Express、React/Vite、node:test

## Global Constraints

- 复用现有 `module_meta` 表，新增 `title` 字段
- 默认模块（todo/routine/chore）首次启动时自动导入
- 新模块 ID 格式：小写字母/数字/连字符，长度 2-20
- 新模块标题：非空，长度 ≤ 50
- 模块 ID 唯一，不能与现有模块重复

---

### Task 1: 数据库迁移和 Store 层

**Files:**
- Modify: `src/db.js`
- Modify: `src/store.js`
- Create: `test/moduleStore.test.js`

**Interfaces:**
- Consumes: 现有 `module_meta` 表
- Produces: `listModules()`、`createModule({ id, title })`

- [ ] **Step 1: 添加数据库迁移**

在 `src/db.js` 的 `migrate` 函数中添加：

```javascript
// module_meta 添加 title 字段
const metaCols = db.prepare(`PRAGMA table_info(module_meta)`).all().map((c) => c.name);
if (metaCols.length && !metaCols.includes('title')) {
  db.exec(`ALTER TABLE module_meta ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
}
```

- [ ] **Step 2: 添加 Store 方法**

在 `src/store.js` 的 `createStore` 函数中添加：

```javascript
const listModulesStmt = db.prepare(
  'SELECT module, title, notes, chapters_json, updated_at FROM module_meta ORDER BY module'
);
const getModuleStmt = db.prepare(
  'SELECT module, title, notes, chapters_json, updated_at FROM module_meta WHERE module = ?'
);
const insertModuleStmt = db.prepare(`
  INSERT INTO module_meta (module, title, notes, chapters_json, updated_at)
  VALUES (@module, @title, '', '{}', @updated_at)
`);

// 在 return 对象中添加：
listModules() {
  return listModulesStmt.all();
},

createModule({ id, title }) {
  const existing = getModuleStmt.get(id);
  if (existing) {
    throw new Error('409: 模块 ID 已存在');
  }
  const updated_at = new Date().toISOString();
  insertModuleStmt.run({ module: id, title, updated_at });
  return getModuleStmt.get(id);
},
```

- [ ] **Step 3: 编写测试**

创建 `test/moduleStore.test.js`：

```javascript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-'));
  const db = openDb(path.join(dir, 't.db'));
  return createStore(db);
}

describe('module management', () => {
  let store;
  beforeEach(() => {
    store = tmpStore();
  });

  it('lists default modules after initialization', () => {
    const modules = store.listModules();
    assert.ok(modules.length >= 3);
    const ids = modules.map((m) => m.module);
    assert.ok(ids.includes('todo'));
    assert.ok(ids.includes('routine'));
    assert.ok(ids.includes('chore'));
  });

  it('creates a new module', () => {
    const mod = store.createModule({ id: 'shopping', title: '购物清单' });
    assert.equal(mod.module, 'shopping');
    assert.equal(mod.title, '购物清单');
    
    const modules = store.listModules();
    const found = modules.find((m) => m.module === 'shopping');
    assert.ok(found);
  });

  it('rejects duplicate module ID', () => {
    store.createModule({ id: 'custom', title: '自定义' });
    assert.throws(
      () => store.createModule({ id: 'custom', title: '重复' }),
      /409/
    );
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
node --test test/moduleStore.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.js src/store.js test/moduleStore.test.js
git commit -m "feat(modules): add dynamic module management to store"
```

---

### Task 2: 后端 API

**Files:**
- Modify: `src/http.js`
- Modify: `src/constants.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `store.listModules()`、`store.createModule()`
- Produces: `GET /api/modules`、`POST /api/modules`

- [ ] **Step 1: 更新 constants.js**

将 `MODULES` 改为 `DEFAULT_MODULES`：

```javascript
/** 默认模块，首次启动时导入到 module_meta */
export const DEFAULT_MODULES = [
  { id: 'todo', title: 'Todo' },
  { id: 'routine', title: 'Routine' },
  { id: 'chore', title: 'Chore' },
];

/** @deprecated 使用 store.listModules() 获取动态模块列表 */
export const MODULES = DEFAULT_MODULES;
```

- [ ] **Step 2: 更新 server.js 初始化逻辑**

在 `server.js` 中添加默认模块导入：

```javascript
import { DEFAULT_MODULES } from './constants.js';

// 在 importIfEmpty(store) 之后添加：
function importDefaultModules() {
  for (const mod of DEFAULT_MODULES) {
    try {
      store.createModule(mod);
    } catch (e) {
      // 409 = 已存在，忽略
      if (!String(e.message).includes('409')) throw e;
    }
  }
}
importDefaultModules();
```

- [ ] **Step 3: 更新 GET /api/modules**

修改 `src/http.js` 中的 `/api/modules` 路由：

```javascript
api.get('/modules', (_req, res) => {
  const modules = store.listModules().map((m) => ({
    id: m.module,
    title: m.title,
    source: DEFAULT_MODULES.some((d) => d.id === m.module) ? 'builtin' : 'custom',
  }));
  res.json({ modules, defaultModule: DEFAULT_MODULE });
});
```

- [ ] **Step 4: 添加 POST /api/modules**

在 `src/http.js` 中添加新路由：

```javascript
api.post('/modules', (req, res) => {
  try {
    const { id, title } = req.body ?? {};
    
    if (!id || typeof id !== 'string') {
      throw new Error('400: 模块 ID 必填');
    }
    if (!/^[a-z0-9-]{2,20}$/.test(id)) {
      throw new Error('400: 模块 ID 只能是小写字母/数字/连字符，长度 2-20');
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      throw new Error('400: 模块标题必填');
    }
    if (title.length > 50) {
      throw new Error('400: 模块标题最多 50 字');
    }
    
    const mod = store.createModule({ id, title: title.trim() });
    res.json({ module: mod });
  } catch (err) {
    sendError(err, res);
  }
});
```

- [ ] **Step 5: 编写 API 测试**

在 `test/http.test.js` 中添加测试：

```javascript
it('lists modules including custom ones', async () => {
  // 创建自定义模块
  await api('/api/modules', {
    method: 'POST',
    body: JSON.stringify({ id: 'test-mod', title: '测试模块' }),
  });
  
  const data = await api('/api/modules');
  const ids = data.modules.map((m) => m.id);
  assert.ok(ids.includes('todo'));
  assert.ok(ids.includes('test-mod'));
});

it('rejects invalid module ID', async () => {
  await assert.rejects(
    api('/api/modules', {
      method: 'POST',
      body: JSON.stringify({ id: 'Invalid!', title: '测试' }),
    }),
    /400/
  );
});
```

- [ ] **Step 6: 运行测试**

```bash
npm test
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/http.js src/constants.js src/server.js test/http.test.js
git commit -m "feat(modules): add GET/POST /api/modules endpoints"
```

---

### Task 3: 前端模块管理

**Files:**
- Modify: `web/src/api.js`
- Modify: `web/src/App.jsx`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/modules`、`POST /api/modules`
- Produces: 模块 Tab 栏 "+" 按钮、添加模块模态框

- [ ] **Step 1: 添加 API 函数**

在 `web/src/api.js` 中添加：

```javascript
export async function getModules() {
  return api('/api/modules');
}

export async function createModule(id, title) {
  return api('/api/modules', {
    method: 'POST',
    body: JSON.stringify({ id, title }),
  });
}
```

- [ ] **Step 2: 更新 App.jsx 状态和初始化**

```javascript
import { getModules, createModule } from './api.js';

// 替换硬编码的 MODULES
const [modules, setModules] = useState([]);
const [showAddModule, setShowAddModule] = useState(false);
const [newModuleId, setNewModuleId] = useState('');
const [newModuleTitle, setNewModuleTitle] = useState('');
const [moduleError, setModuleError] = useState('');

// 加载模块列表
useEffect(() => {
  async function loadModules() {
    try {
      const data = await getModules();
      setModules(data.modules || []);
    } catch {
      // fallback
      setModules([
        { id: 'todo', title: 'Todo' },
        { id: 'routine', title: 'Routine' },
        { id: 'chore', title: 'Chore' },
      ]);
    }
  }
  loadModules();
}, []);
```

- [ ] **Step 3: 添加创建模块函数**

```javascript
async function handleCreateModule() {
  const id = newModuleId.trim().toLowerCase();
  const title = newModuleTitle.trim();
  
  setModuleError('');
  
  if (!id || !/^[a-z0-9-]{2,20}$/.test(id)) {
    setModuleError('ID 只能是小写字母/数字/连字符，长度 2-20');
    return;
  }
  if (!title) {
    setModuleError('标题必填');
    return;
  }
  
  try {
    await createModule(id, title);
    const data = await getModules();
    setModules(data.modules || []);
    setShowAddModule(false);
    setNewModuleId('');
    setNewModuleTitle('');
    switchModule(id);
  } catch (e) {
    setModuleError(String(e.message || e));
  }
}
```

- [ ] **Step 4: 更新模块 Tab 栏**

```jsx
<div className="module-tabs">
  {modules.map((m) => (
    <button
      key={m.id}
      type="button"
      className={m.id === moduleId ? 'active' : ''}
      onClick={() => switchModule(m.id)}
    >
      {m.title}
    </button>
  ))}
  <button
    type="button"
    className="module-add"
    onClick={() => setShowAddModule(true)}
  >
    +
  </button>
</div>
```

- [ ] **Step 5: 添加模态框**

```jsx
{showAddModule && (
  <div className="modal-backdrop" onClick={() => setShowAddModule(false)}>
    <div className="step-modal" onClick={(e) => e.stopPropagation()}>
      <div className="step-modal-hd">
        <h3>添加新模块</h3>
        <button onClick={() => setShowAddModule(false)}>×</button>
      </div>
      <div className="step-modal-body">
        {moduleError && <div className="err">{moduleError}</div>}
        <div className="module-form">
          <label>
            模块 ID
            <input
              type="text"
              value={newModuleId}
              onChange={(e) => setNewModuleId(e.target.value)}
              placeholder="例如：shopping"
              pattern="[a-z0-9-]{2,20}"
            />
            <small>小写字母/数字/连字符，长度 2-20</small>
          </label>
          <label>
            模块标题
            <input
              type="text"
              value={newModuleTitle}
              onChange={(e) => setNewModuleTitle(e.target.value)}
              placeholder="例如：购物清单"
              maxLength={50}
            />
          </label>
          <div className="flow-actions">
            <button className="primary" onClick={handleCreateModule}>
              创建
            </button>
            <button onClick={() => setShowAddModule(false)}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: 添加样式**

在 `styles.css` 中添加：

```css
.module-add {
  border-style: dashed;
  opacity: 0.7;
}

.module-add:hover {
  opacity: 1;
}

.module-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.module-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
}

.module-form input {
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--txt);
  font: inherit;
}

.module-form input:focus {
  outline: none;
  border-color: var(--hand);
}

.module-form small {
  color: var(--faint);
  font-size: 12px;
  font-weight: 400;
}
```

- [ ] **Step 7: 更新 CHAPTER_TITLES 引用**

移除 `App.jsx` 中硬编码的 `CHAPTER_TITLES`，改为从 API 响应中获取或使用空对象。

- [ ] **Step 8: 运行前端构建**

```bash
cd web && npm run build
```

Expected: 构建成功

- [ ] **Step 9: Commit**

```bash
git add web/src/api.js web/src/App.jsx web/src/styles.css
git commit -m "feat(modules): add module creation UI with + button in tab bar"
```

---

### Task 4: 测试和验证

**Files:**
- 修改文件（如果需要修复问题）

**Interfaces:**
- Consumes: 所有前面任务的产出
- Produces: 可工作的动态模块管理功能

- [ ] **Step 1: 运行完整测试**

```bash
npm test
```

Expected: 所有测试通过

- [ ] **Step 2: 运行前端构建**

```bash
cd web && npm run build
```

Expected: 构建成功

- [ ] **Step 3: 功能验证**

1. 启动服务 `npm start`
2. 看到模块 Tab 栏有 Todo、Routine、Chore 和 "+" 按钮
3. 点击 "+" 按钮，弹出添加模块模态框
4. 输入 ID "shopping" 和标题 "购物清单"
5. 点击创建，新模块出现在 Tab 栏
6. 切换到新模块，可以使用「补功能点」功能
7. 刷新页面，新模块仍然存在

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat(modules): complete dynamic module management"
```

---

## Self-Review

**Spec coverage:**
- ✅ 扩展 module_meta 表存储模块定义
- ✅ GET /api/modules 返回所有模块
- ✅ POST /api/modules 创建新模块
- ✅ 默认模块首次启动自动导入
- ✅ 前端模块 Tab 栏 "+" 按钮
- ✅ 添加模块模态框
- ✅ 模块持久化到 SQLite

**Placeholder scan:** 无 TBD、TODO 或不完整的部分。

**Type consistency:** 所有函数名、参数名、属性名在各任务间保持一致。