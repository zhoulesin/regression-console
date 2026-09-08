# 回归控制台：轮次时间线

日期：2026-09-08  
范围：`tools/regression-console`（SQLite + HTTP + web UI）  
不改：Android App、Maestro YAML 语义、Claude prompt 铁律（除非本轮诊断回流已有逻辑）

## 问题

右侧详情现在是固定 6 段（说明 / 生成 / 审阅 / 执行 / 诊断 / 本会话历史）。失败后再生成会覆盖同一组区块，刷新后轮次关系只能靠 `latestRun` / `pendingSession` 猜测。用户要的页面是：

```text
说明
└─ 第 1 轮：生成 → 确认 → 执行 → 失败 → 诊断
└─ 第 2 轮：补充线索 → 生成 → 确认 → 执行 → 通过   （当前节点高亮）
[ 页面底部 = 当前进度的完整操作区 ]
```

点击任意步骤弹出只读详情；主操作永远在底部当前进度区，不在弹框里。

## 页面结构

选中功能点后，右侧从上到下只有三块：

1. **说明**：判定依据、数据前提、备注。与轮次无关，始终在顶部。
2. **轮次时间线**：若干行 `第 N 轮：节点 → 节点 → …`。当前轮次整行强调；当前节点高亮（进行中可带动画）。历史轮次默认折叠成一行摘要，可展开看节点。
3. **当前进度详情**：跟在时间线后面，是普通文档流（`max-width` 居中，不 `position: sticky`）。内容随「当前节点」切换。

左侧功能列表、模块切换、顶栏状态保持不变。

## 一轮里有哪些节点

节点按出现顺序固定，未发生的节点不渲染（不要画灰掉的未来节点占位）。

| 节点 | 何时出现 | 底部详情里做什么 |
|---|---|---|
| 补充线索 | 第 2 轮及以后，且本轮带着用户 hint 开局 | 展示 hint；本轮一旦开始生成，此处只读 |
| 生成 | 本轮调用过 analyze（含进行中） | TaskPanel：阶段、耗时、中止；完成后给中文摘要 |
| 确认 | 已有 pending 或已批准/打回的 analyze 会话 | 中文测试步骤；批准 / 打回。打回结束本轮，不自动开新轮 |
| 执行 | 本轮至少开始过一次 run | 开始执行 / 中止 / 再跑一次（不改脚本） |
| 失败 或 通过 | 最近一次已结束的 run 有结果 | 失败步骤、耗时、日志摘要；通过则本轮结束 |
| 诊断 | 本轮最近一次 run 失败后 | 诊断对话、补充线索、带线索再诊断、按诊断开新一轮生成 |

同一轮可以多次「再跑一次」，时间线上仍只有一个「执行」节点，摘要显示 `共 N 次，最近失败/通过`。多次诊断同理，只显示一个「诊断」节点，对话在详情和弹框里展开。

「当前节点」按最新一轮、从上到下取第一条命中规则（底部始终跟这条，点击历史节点只开弹框、不改绑）：

1. 生成进行中 → 生成
2. 有 pending 会话未批准/打回 → 确认
3. run 进行中 → 执行
4. 最近 run 失败且尚未有诊断 → 失败（底部：结果 + 开始诊断 + 再跑一次）
5. 最近 run 失败且已有诊断 → 诊断（底部可继续补线索，也可再跑一次 / 按诊断开新轮）
6. 最近 run 通过 → 通过
7. 已打回 → 确认（终态）；再点生成才开新轮
8. 否则取该轮最后一个已出现的节点

## 点击步骤：弹框

点击时间线上任意已存在的节点，打开模态框，只读回看该节点快照。

- 生成：中文摘要、风险、技术日志折叠
- 确认：当时的中文步骤清单、批准或打回结果与时间
- 执行：各次 run 列表（时间、exit_code、失败步骤、产物路径）；可看日志摘要
- 失败 / 通过：最近一次结果的失败步骤与 log excerpt
- 诊断：该轮诊断对话（AI 结论 + 用户 hint）
- 补充线索：本轮开局 hint 原文

弹框没有批准、执行、中止、再诊断等主按钮。那些只出现在底部当前进度区。Esc / 遮罩点击关闭。

## 轮次生命周期

```text
无轮次
  → 用户点「生成脚本」→ 创建第 1 轮（生成中）
  → 生成完成 → 确认
  → 打回 → 本轮 ended=rejected；用户再点生成才开第 2 轮
  → 批准 → 执行
  → 执行中可中止 → 记一次失败类结果，本轮仍打开，可再跑或去诊断
  → 通过 → 本轮 ended=passed；底部提供「再开一轮」可选入口（不自动开）
  → 失败 → 诊断（可多轮对话，仍属本轮）
  → 「按诊断生成脚本」→ 创建第 N+1 轮，hint 写入新轮「补充线索」
```

硬规则：

- 重新生成脚本才创建新 `workflow_attempt`。
- 不改脚本的「再跑一次」只在当前轮追加 `run`。
- 诊断对话继续挂在失败的 `run_id` 上，同时带 `attempt_id`。
- 同时只允许一个进行中的 AI 任务或 Maestro run（沿用现有单槽 `analyzeHub` / 全局 active run）。
- 功能点状态（待写 / 待执行 / 运行中 / 通过 / 失败）仍由现有 `feature.status` 门禁驱动，轮次表不替代门禁。

## 数据

新增表 `workflow_attempt`：

```text
id
feature_module
feature_code
sequence            -- 从 1 递增，同一功能点内唯一
analyze_session_id  -- 本轮那次 kind=analyze 的会话，生成前为空
status              -- open | reviewing | running | failed | passed | rejected
hint                -- 开局用户线索，可空
created_at
ended_at            -- 终态时写入
```

改现有表（可空列 + 迁移）：

- `run.attempt_id`
- `ai_session.attempt_id`

查询：按 `(module, code)` 列出 attempts，`sequence ASC`。每个 attempt 附带：analyze 会话摘要、该轮 runs、该轮 diagnoses。列表接口不返回完整 prompt/diff/日志；弹框或底部需要时再取详情。

旧数据回填（一次性 migration）：

1. 按时间列出该功能点的 `kind=analyze` 会话，每个会话生成一个 attempt（`sequence` 按时间）。
2. `decision=pending` → `reviewing`；`approved` 且其后有 run → 按最后一次 run 的 exit_code 设 `failed`/`passed`；`rejected` → `rejected`；无会话的历史 run 并入最近一个 attempt，若没有则单独建一轮（无 analyze）。
3. `kind=diagnose` 且有 `run_id` 的会话，attempt 取该 run 的 `attempt_id`。

回填允许粗糙，目标是刷新后时间线不空，不要求历史 100% 语义正确。

## HTTP

在现有 `/api/features` 每条功能点上增加 `attempts[]` 摘要（最近 20 轮封顶，足够本工具）。新增只读详情：

- `GET /api/attempts/:id`：一轮的 analyze 会话（含 steps）、runs、diagnoses。

现有 analyze / apply / reject / run / abort / diagnose 行为不变，但服务端必须：

- analyze 开始时若无 `open` 轮，则创建新 attempt；写入 `attempt_id`。
- apply/reject 更新该轮 `status` / `ended_at`（reject 结束轮次）。
- startRun/finishRun 写入 `run.attempt_id`，并更新 attempt `status`。
- diagnose 写入 `ai_session.attempt_id`。

前端刷新仍走 `/api/features?module=`，用返回的 `attempts` 渲染时间线。

## UI 实现要点

- 拆组件，避免继续堆 `App.jsx`：`AttemptTimeline`、`StepModal`、`CurrentDetail`。现有 `TaskPanel`、`StepList`、`DiagnosisConversation` 复用到当前进度区和弹框。
- 去掉固定「1–6 步」区块和「本会话执行记录」表；执行记录并进执行节点。
- 当前进度区标题等于当前节点名，例如「当前：执行」。
- 空状态（待写、无轮次）：时间线下一行提示「还没有轮次」，底部就是「生成脚本 Diff」。
- 页面宽度继续用已有 `--app-max` 居中。

## 测试与验收

后端（node:test，不跑 Gradle）：

- attempt 创建：analyze → sequence=1；失败后再 analyze → sequence=2。
- 同轮 rerun 不新增 attempt，只增加 run。
- reject 结束当前轮；下次 analyze 新开轮。
- `/api/features` 返回 attempts 摘要；`GET /api/attempts/:id` 带 steps/runs/diagnoses。
- 回填：旧库只有 session+run 时，打开功能点能看到至少一轮。

前端手验（一次真机会话内能看完）：

1. 选一个待写功能点：说明 + 空时间线 + 底部生成。
2. 生成完成后时间线出现「生成 → 确认」，底部是中文步骤和批准。
3. 批准后当前节点变执行；跑失败后出现失败、诊断。
4. 补充线索再诊断仍在第 1 轮；「按诊断生成」出现第 2 轮且第 1 个节点是补充线索。
5. 点击第 1 轮「执行」弹出历史 run，底部仍停在第 2 轮当前节点。
6. 刷新页面：轮次与当前节点仍在，不丢。

## 非目标

- 不做无限滚动的完整事件流 UI。
- 不改 Maestro 选择器铁律、不改 FileGate。
- 不把弹框做成第二套操作系统。
- 不一次改 Android 或其它模块。
