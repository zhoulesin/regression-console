# 真机回归控制台 Design Spec

日期：2026-09-07  
仓库：`choresReward`  
落地：`tools/regression-console/`（本仓，不单独建仓）

## 1. 问题

现有 Maestro 真机回归靠对话里改 YAML、终端里跑、Markdown/HTML 手工同步进度。要变成可交互工作台：在网页里建功能点、让 AI 起草 YAML、人审 Diff、点执行、自动记结果。

## 2. 已拍板决定

| 项 | 取值 |
|---|---|
| 部署 | 仅本机单人。Web + 本地服务，访问当前仓库与 USB 真机。无账号、无公网 |
| 主界面 | **A · 看板优先**：左列功能点，右列当前条的分析 / Diff / 执行 / 日志。视觉沿用 Primer Dark 进度页 |
| 主路径 | 建功能点 → AI 分析并起草执行流 → 审 Diff → 写入 → 手动执行 → 自动落记录 |
| AI | 首发 Claude CLI（`/opt/homebrew/bin/claude`）。Provider 接口预留 Cursor Agent / Codex |
| 权限 | 两道闸：**批准写入** 才落盘；**执行** 另点一次。AI 永不直接写盘、永不直接跑 Maestro |
| 真源 | 本地 SQLite。`TESTING_DEVICE_REGRESSION.md` 与 `docs/testing/device-regression-plan.html` 为导出物 |
| 文件闸门 | 只允许改 `maestro/**/*.yaml`（解析真实路径防穿越）。不改 Kotlin/XML、不改 Gradle |
| 并发 | 同一时刻只跑一条 Maestro |
| 不做 | 自动修复循环、多设备并行、编译打包、多项目、云端、账号 |

## 3. 用户可见行为

打开 `http://127.0.0.1:<port>/?token=...`（只绑 loopback + 启动时生成的一次性 token）。

顶栏：已通过数 / 运行中 / 当前卡住的功能点编号。

左列：按第 0–5 章分组的功能点。状态 pill：通过、待写、失败、假绿、留手测、运行中。点一条进入右列。

右列按状态解锁按钮：

1. `待写` / `失败`：可点「AI 分析」
2. 有未批准 Diff：「批准写入」或「打回」；可就地改 Diff 再批
3. 磁盘上已有对应 flow 且无未批 Diff：「执行」
4. 运行中：日志流 + 「中止」

「AI 分析」把功能点（编号、判定、数据前提）+ 相关布局/代码摘录 + 铁律清单发给 Claude，要求返回结构化三块：依据（控件 id）、完整 YAML、风险。解析失败则报错，不半写。

「批准写入」前展示 unified diff；通过闸门后备份原文件为 `*.bak`（若存在），再写盘，把 `flow.path` 写入 SQLite。

「执行」调用 `maestro test <path>`，cwd 为仓库根。stdout/stderr 经 SSE 推到页面。结束按 exit code 写 `run`，功能点状态改为通过（0）或失败（非 0）。失败时把 `~/.maestro/tests/<最新>/` 里截图路径记到 `run.artifact_dir`。

首次启动若 `feature` 表为空，从 `TESTING_DEVICE_REGRESSION.md` 第三节导入现有 23 条（状态按文档：通过 / 待写 / 假绿 / 留手测）。导入是一次性，之后以 SQLite 为准，导出再覆盖 Markdown/HTML。

## 4. 架构

```
浏览器看板
    HTTP + SSE (127.0.0.1 + token)
本地 Node 服务
    SQLite | Claude Provider | 文件闸门 | Maestro Runner
USB 真机（maestro/adb）
导出 Markdown + HTML
```

浏览器不做 CLI、不做文件 IO。服务是唯一动手进程。

组件职责：

| 单元 | 做什么 | 怎么用 | 依赖 |
|---|---|---|---|
| HTTP API | CRUD 功能点、触发分析/写入/执行、鉴权 | REST + SSE | 下列四者 |
| FeatureStore | 功能点与状态机 | SQLite | better-sqlite3 |
| AiProvider | `analyze(feature, context) → {rationale, files[]}` | Claude CLI 实现 + 空接口 | child_process |
| FileGate | 校验路径 ∈ `maestro/**/*.yaml`、写前备份、返回 diff | `apply(files)` | fs |
| Runner | 单槽队列、spawn maestro、超时可 kill | `start(flowId)` / `abort()` | child_process |
| Exporter | 从 SQLite 生成 md + html | 每次状态变更后调用 | fs |

状态机（`feature.status`）：

`待写` →（分析产出 Diff，仍待写）→（批准写入）`待执行` →（执行中）`运行中` → `通过` | `失败`。`留手测`、`假绿` 可手改，不自动进入执行。失败可再次分析或再次执行。

## 5. 数据模型

SQLite 文件：`tools/regression-console/data/console.db`（gitignore）。

**feature**：`id`, `code` UNIQUE（如 `2.1`）, `chapter`（0–5）, `title`, `criteria`, `precondition`, `status`, `notes`, `updated_at`

**flow**：`id`, `feature_code`, `path`（相对仓库根）, `kind`（`flow` \| `subflow`）, `updated_at`

**run**：`id`, `flow_id`, `started_at`, `ended_at`, `duration_ms`, `exit_code`, `failed_step`, `artifact_dir`, `log_excerpt`

**ai_session**：`id`, `feature_code`, `provider`（`claude`）, `prompt`, `response`, `diff`, `decision`（`pending` \| `approved` \| `rejected`）, `created_at`

## 6. HTTP API（均需 token）

- `GET /api/features` / `POST /api/features` / `PATCH /api/features/:code`
- `POST /api/features/:code/analyze` → 创建 `ai_session`（decision=pending）
- `POST /api/features/:code/apply` body: `{ sessionId, editedFiles? }` → FileGate
- `POST /api/features/:code/reject` 
- `POST /api/flows/:id/run` / `POST /api/runs/abort`
- `GET /api/runs/:id/stream` SSE
- `POST /api/export`

错误：越权路径 → 400 不写盘；无 token → 401；已有运行中 → 409；Claude 非结构化 → 422。

## 7. Claude 契约

Prompt 必须包含：功能点全文、铁律（禁止用 rightOf/below/leftOf 定位操作目标；顺序断言才可用 above/below；写入前 fail-closed；一个 flow 一件事；env 传参不要用）、相关已有 yaml 路径、布局 id 摘录（服务侧按功能点章节白名单读少量 xml，不把整个 app 塞进 prompt）。

响应必须是单个 JSON 对象（可包在 markdown fence 里）：

```json
{
  "rationale": "string",
  "risks": ["string"],
  "files": [{ "path": "maestro/todo/item-fast-add.yaml", "content": "完整 yaml 文本" }]
}
```

`path` 必须相对仓库根且通过 FileGate。`content` 必须是完整文件，禁止 patch 片段。解析失败整次作废。

Claude CLI 调用方式：非交互、从 stdin 或 `-p` 传入 prompt；超时 120s；不传 `--dangerously-skip-permissions` 去改文件——服务自己写盘。

## 8. 前端

`tools/regression-console/web/`：Vite + React。单页。不引入重型 UI 库。CSS 变量沿用进度页：`--bg #0f1115`、`--ok #3fb950`、`--wait #d29922`、`--warn #f85149`、`--hand #58a6ff`。

布局：顶栏统计 + 左 38% 功能点列表 + 右详情。详情内 Tab：说明 / Diff / 日志 / 历史。

## 9. 启动与安全

`npm start`（在 `tools/regression-console`）启动 API + 静态前端。固定监听 `127.0.0.1:4780`。启动打印带 token 的 URL，并尝试 `open`。端口占用则退出并报错，不改绑其他端口。

所有 `/api/*` 校验 `Authorization: Bearer <token>` 或 `?token=`。token 仅内存，重启更换。

不扫描局域网、不写 0.0.0.0。

`.gitignore` 增加：`tools/regression-console/data/`、`tools/regression-console/web/node_modules/`、`.superpowers/`。

## 10. 测试

- FileGate 单测：合法 yaml 路径通过；`../`、绝对路径、`.kt`、`.md` 拒绝。
- 状态机单测：未批准不能 run；运行中第二次 run → 409。
- Provider 契约：fixture 响应缺 files / 路径越权 → 422。
- 不把真机 Maestro 放进 CI。本机验收：导入 23 条 → 对已有 `list-crud.yaml` 点执行（需 USB）→ 记录出现。

## 11. 与现有资产关系

- 不替代 `TESTING_DEVICE_REGRESSION.md` 作为人类可读计划；它变成导出。
- 已有 `maestro/todo/list-crud.yaml` 等继续用，导入时按文档第四节把 path 绑到功能点。
- `AppRuntimeBootstrap` 浮窗关闭仍是已知临时改动，本工具不自动还原。

## 12. 非目标（再次写死）

失败后自动改脚本重跑；多设备；`./gradlew`；AI 改应用代码；托管云；多仓库。
