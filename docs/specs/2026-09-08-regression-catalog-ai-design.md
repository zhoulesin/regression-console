# 回归控制台：AI 增量生成功能点

日期：2026-09-08  
范围：`tools/regression-console`（SQLite + HTTP + web UI + Claude 提示）  
不改：Android App、已入库功能点内容、Maestro YAML、现有「AI 分析」写脚本流程

## 排期（先读）

本功能**不是当前交付单元**。它往上游加「待写」库存，验证仍要穿过现在的：写脚本 → 确认 → `maestro test`。那条链路若 maestro 不在 PATH、flow 绑错号，新功能点无法闭环。

当前顺序：

1. **AI 槽位占用**（已从本方案拆出、单独做）：`analyzeHub` 今天没有 busy，两次 analyze 会互相 `begin()` 清日志。catalog 若「复用 409」是假的，必须先有 `tryBegin` / 票号 `release` / `abort` 必释放。
2. 执行链路（maestro 能跑、flow 不要串号）——另一单元。
3. 本 catalog 功能。

下面正文仍是 catalog 的设计，实现时以占用层已经存在为前提，不再假装现在就有 409。

## 问题

左侧功能点（编号、标题、判定依据、数据前提）目前来自 `src/seed/*.js`，只在 `feature` 表为空时导入一次。用户不要再手写 seed，也不要改 importer 做全量 upsert。希望在 Web 上按一句范围提示，让 AI **读项目代码** 产出一批**新**功能点，用和 YAML 相同的「中文审阅 → 确认入库 / 打回再生成」流程。

## 已确认决策

- 输入：用户提示 + 当前模块已有功能点 + **服务端先塞的参考文件** + Claude 仅 `Read` 补洞。
- 粒度：增量。一次只覆盖提示所说的范围，不是扫整个 App。
- 确认：先看中文卡片，点确认才写库；打回必填备注，备注永久留下并进入下一轮提示。
- 对撞：只提议新功能点。编号或标题与已有明显重复则跳过，**不改**已入库条目。已有条目写错了判定依据，本流程不管，用户用该条的手工编辑 / 备注处理。
- 入库后状态为 `待写`。不自动生成 Maestro；脚本仍走该条的「AI 分析」。
- 不改 `seed/*.js`；库是真源。

## 入口与页面

入口在**模块级**，不在某条功能点详情里（功能点还不存在）。

左侧栏顶部（模块 Tab 下方、章节列表上方）增加「补功能点」。Routine / Chore 空列表时，空状态文案改为引导点这个按钮，不再写「去改 seed」。

点开后，右侧未选中功能点时（或选中时仍可用同一底部操作区）进入 **catalog 当前进度**：

```text
[模块 Todo]
  [补功能点]

  第 0 章 …
  第 1 章 …

右侧 / 底部当前进度（catalog 进行中）：
  范围提示（必填）
  → 生成中：复用现有 TaskPanel + SSE
  → 审阅：新功能点卡片 + 「已跳过」列表
  → 确认入库 / 打回（必填备注）
```

未开始 catalog 且未选功能点时，右侧仍是「选择左侧功能点」。

**占用（实现时已存在，不是「顺带复用」）：** `analyzeHub.tryBegin(kind)` 失败 → HTTP 409。`abort` 作废当前票号并释放；请求 `finally` 用同一票号 `release`，避免中止后旧 finally 清掉新占用。`GET /api/analyze/status` 给前端灰按钮。pending 审阅**不是**占用。

前端：`aiSlot.busy` 或本地 `taskKind` 为另一类任务时，灰掉冲突入口；点了仍可能 409，展示服务端文案。

不要改 `assertCanRun`。pending 查询已是 `(module, code)` 且 `kind='analyze'`，catalog 用哨兵 `__catalog__`，真实功能点执行门禁天然看不到它。

## 一轮 catalog 的节点

| 节点 | 何时出现 | 操作 |
|---|---|---|
| 范围提示 | 开始前，或打回后再生成 | 必填；生成开始后本轮只读 |
| 生成 | 已 POST propose | TaskPanel：阶段、耗时、中止 |
| 确认 | 已有 pending 的 `kind=catalog` 会话 | 中文卡片；确认 / 打回 |

不跑 Maestro，没有执行/失败节点。  
打回结束本轮会话（`decision=rejected`），不自动再开一轮；用户改提示或带着备注再点生成。

## 草稿字段（人工只看这些）

每条提议：

| 字段 | 含义 |
|---|---|
| `code` | 模块内编号，必须是 `章.序号`（如 `2.6`），与现有 seed 一致。**不允许**光秃编号 `6`。 |
| `chapter` | 整数章节号 |
| `title` | 一句话功能点 |
| `criteria` | 判定依据：可观察、绑容器，禁止「点了就算过」 |
| `precondition` | 数据前提 |
| `chapter_title` | 可选。仅当该 `chapter` 不在 `CHAPTER_TITLES[module]` 时用于展示；**不写入** `constants.js` |

服务端校验失败则整次 propose 422，不落 pending。单条不合规则从 `features` 挪到 `skipped` 并写原因，其余仍可审阅。

硬规则（服务端再拦一遍，不信任模型）：

- `code` 匹配 `^\d+\.\d+$`（例：`0.1`、`2.6`）。不合则 `invalid`。
- `(module, code)` 已存在 → 跳过。
- `title` 与已有标题去空白后全等（大小写不敏感）→ 跳过。
- `title`、`criteria` 非空；`chapter` 为 ≥0 整数。
- 单次最多 **15** 条进入 `features`；超出部分进 `skipped`。
- `features` 与 `skipped` 都空且没有可解释的 `rationale` → 422。

`skipped` 必须带机器可读 `reason`，前端按类展示，不要混成一句「跳过了」：

| `reason` | 给用户看的分组 |
|---|---|
| `duplicate_code` | 已有同编号，未改旧条目 |
| `duplicate_title` | 已有同标题，未改旧条目 |
| `batch_limit` | 超过单次 15 条，请缩小范围再生成 |
| `apply_conflict` | 确认入库时编号已被占用（例如另一窗口手工建了同一号） |
| `invalid` | 字段不合法，本条未入库 |

审阅区折叠「以下已有条目被跳过（不会改库里的旧条）」；`batch_limit` / `invalid` 另组，避免用户以为是重复。  
**确认入库之后**若又产生 `apply_conflict`，底部用同一套分组展示本次实际入库条数 + 新 skipped，不要只刷新左侧列表、把冲突吞掉。

## 数据模型

`ai_session` 增加（或复用已有）`kind='catalog'`。

- `feature_module` = 当前模块
- `feature_code` = 常量 `CATALOG_FEATURE_CODE = '__catalog__'`（**哨兵，不是功能点**）。只出现在 `ai_session`，永不 `INSERT` 进 `feature`。查询功能点一律走 `feature` 表；按 session 列功能点时必须 `kind != 'catalog'` 且 `feature_code != '__catalog__'`。代码里常量上方写清：后人不要对这个 code 做级联当真实条目。
- `diff` = 空
- `response` = JSON：`{ rationale, skipped, features }`（`skipped[].reason` 见上表）
- `decision`：`pending` / `approved` / `rejected`
- `user_hint` = 本轮范围提示

`assertCanRun` 不用为 catalog 改。同一模块同时只允许一条 `kind=catalog` 且 `decision=pending`；再 propose 返回 409，提示先确认或打回。

章节标题（现在有三份：`src/constants.js`、`web/src/App.jsx`、exporter 读 constants）：

- `module_meta` 增加 `chapters_json TEXT NOT NULL DEFAULT '{}'`（`{"6":"某某"}`）。
- apply 时若草稿带 `chapter_title` 且该章还没有标题，写入 `chapters_json`。
- `GET /api/features` 返回 `chapterTitles`：constants 默认 ∪ 库里的覆盖。
- 前端删掉本地硬编码，只用接口。
- exporter 用同一合并结果，禁止新章退化成「第 N 章」却有标题可写。

模块级备注（打回/再生成）：

```sql
CREATE TABLE IF NOT EXISTS module_meta (
  module TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
```

打回或再生成时追加备注，格式与功能点备注相同（时间戳 + 原文）。下一轮 propose 把 `module_meta.notes` 和已有功能点列表一并送进 prompt。

`notes` 上限 **8000** 字：超出则丢掉最旧的若干段（按分隔符切），保留最近的。三个模块、低频备注，不做独立历史表。

确认入库：对 `features` 逐条 `INSERT`（`status=待写`，`notes=''`）。插入前再查一次唯一约束，竞态冲突则 `reason=apply_conflict` 记入本次 apply 返回的 `skipped`，HTTP 仍 200。响应形状：`{ inserted: Feature[], skipped: Skipped[] }`。不写 `flow` 行。

## HTTP

均带现有 `module` 查询参数（或路径参数），与其它 API 一致。

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/catalog/propose` | body：`{ hint }` 必填，≤2000 字。占用 analyzeHub，调 Claude，校验后 `createAiSession(kind=catalog)` |
| POST | `/api/catalog/apply` | 把 pending catalog 写入 `feature`，`decision=approved`；返回 `inserted` + `skipped` |
| POST | `/api/catalog/reject` | body：`{ note }` 必填。`decision=rejected`，追加 `module_meta.notes` |
| GET | `/api/catalog/pending` | 当前模块 pending catalog 会话（刷新可恢复审阅） |

`GET /api/features` 可附带 `catalog_pending` 与 `module_notes`，减少前端一次请求。

中止：复用 `POST /api/analyze/abort`。SSE 复用 `/api/analyze/stream`。日志前缀 `[catalog]`。

`POST /api/features` 手工建条保留，本功能不依赖它。

## Claude 提示与参考文件

独立 `catalogPrompt.js`（不要塞进写 YAML 的 analyze prompt）。  
**不要**让模型自己从整个 `app/` 猜该读哪些文件。

参考文件由服务端拼进 prompt，复用 `CONTEXT_FILES_BY_MODULE`：

- 取该模块 **所有 chapter 路径的并集**（catalog 没有单一 chapter；用户提示可能跨章）。
- 仍走现有 `buildContext` 的 200 行截断与 maestro/app 分根读取。
- 该并集为空（Routine / Chore 尚未配映射）时：prompt 里写死「先读这些目录、不要全仓扫」的短列表（例如 `app/src/main/java/com/cozyla/choresreward/ui/todo/`、对应 `res/layout/`），再允许 `Read` 补具体文件。后续为模块补 `CONTEXT_FILES_BY_MODULE` 即可收紧，不在本轮扫全仓。

`Read` 只用于映射里没有、但提示点名的文件（例如某个 Dialog layout）。禁止当搜索引擎用。

系统/用户提示还必须包含：

1. 当前模块名、已有功能点表（code / title / criteria / precondition / chapter）。
2. 用户范围提示 + 模块备注。
3. 功能点定义：一个可独立验收的产品行为；判定依据必须是界面上可观察的结果，并设想绑到行/卡容器；数据前提写清要不要 list、todo、Display/Filter。
4. 只输出提示范围内的**新**点；已有的放进 `skipped`（`reason`: `duplicate_code` 或 `duplicate_title`），禁止改已有字段。模型侧跳过与服务端校验双保险。
5. 控件 id 必须来自参考文件或本次 `Read` 到的 layout，禁止编造。
6. 允许工具：仅 `Read`。工作目录为 App 根（`appRoot`）。不要写文件、不要输出 YAML。
7. 输出 JSON：

```json
{
  "rationale": "这一批覆盖什么、从哪段代码看出来的（短中文）",
  "skipped": [{ "code": "1.1", "reason": "duplicate_code", "title": "创建 List" }],
  "features": [{
    "code": "2.6",
    "chapter": 2,
    "chapter_title": "",
    "title": "…",
    "criteria": "…",
    "precondition": "…"
  }]
}
```

流式展示仍走现有「过滤工具 JSON、只给人看文本」的通道，避免审阅前刷屏。

## 前端

- 左侧「补功能点」打开 catalog 进度区；`taskKind === 'catalog'` 时 TaskPanel 绑同一 SSE。
- 审阅区：每张卡片展示编号、章、标题、判定依据、数据前提；上方一段 `rationale`。
- `skipped` 按 `reason` 分组折叠，标题写明「不会改库里已有条目」。
- 不展示 JSON / 源码。
- 确认入库：用 apply 返回的 `inserted` / `skipped` 刷新列表；若有 `apply_conflict` 留在当前进度区展示，不要假装全部成功。有 `inserted` 则选中第一条新条。
- 打回、再生成：复用 `RegressionNoteInput`（必填）。
- 页面刷新：若该模块有 pending catalog，自动回到审阅，不丢草稿。

## 错误与占用

- analyze / diagnose / catalog 的 **Claude 进行中**：`tryBegin` 失败 → 409。
- pending 审阅、功能点执行：不占用 hub。
- Claude 超时、非 JSON：422，不落 pending，`finally` 释放槽位。
- 中止：`abort` 释放；旧请求 finally 因票号作废不能误清新占用。

## 测试

- 解析器：合法草稿、撞号、撞标题、超 15 条（`batch_limit`）、缺字段、`reason` 枚举。
- store：catalog pending **不必**改 `assertCanRun`（按 code 查不到哨兵）；同模块第二条 catalog pending → 错；apply 插入待写且不改已有行；apply 时已存在同号 → `apply_conflict` 且 HTTP 200。
- `module_meta.notes` 超 8000 字截断后仍含最近一段。
- HTTP：无 hint / 无打回备注 → 400；apply 响应含 `inserted` + `skipped`。
- 不测真 Claude；`catalogFn` 可注入。
- 参考文件：catalog prompt 含该模块 `CONTEXT_FILES_BY_MODULE` 并集里至少一篇存在的路径标题。

## 不做

- 不改 Android。
- 不把功能点写回 `seed/*.js` 或 `TESTING_DEVICE_REGRESSION.md`（文档仍是人工快照）。
- 不在本轮生成或绑定 YAML。
- 不更新已有功能点的标题/判定依据/前提。
- 不扫全模块除非用户提示就是「扫整个 Todo」。
