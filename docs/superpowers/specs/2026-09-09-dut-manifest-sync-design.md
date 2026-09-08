# DUT Manifest 同步 — Design Spec

日期：2026-09-09  
仓库：`regression-console`

取代「功能点 seed + 本仓 `maestro/` 为真源」的模型。控制台只做发现、同步、执行、记账。

## 1. 问题

模块名（todo / routine / chore）、功能点 seed、Maestro YAML 都写死在控制台仓，和 choresReward 强绑定。控制台本应是通用的真机回归执行器；换被测项目无法只改配置。

## 2. 已拍板决定

| 项 | 取值 |
|---|---|
| 资产所有权 | 跟被测项目（DUT）走：`maestro/` + 显式 manifest |
| 发现方式 | 被测仓根目录 `regression.manifest.json`（可用配置覆盖路径） |
| 看板改清单 | 只读。改「验什么」去 DUT 改文件再同步 |
| 脚本生成 | 不在控制台内核。YAML/清单只在 DUT 里写（人或 DUT 侧 skill） |
| 现有资产 | 迁到 DUT；控制台清空产品脚本。单测用 `test/fixtures/app/` |
| 同步策略 | 启动 + 手动 `POST /sync` 物化到 SQLite。无文件 watch |
| SQLite | 目录快照（module/feature/flow）+ 执行态（attempt/run）。status 由 run 更新，不同步覆盖 |
| 执行 cwd | `maestro test` 的 cwd = `appRoot` |
| 无 appRoot / 清单坏 | 不回退本仓旧 seed |
| 本轮导出 | 禁用写控制台仓的功能点 Markdown/HTML 导出 |

## 3. 术语

| 术语 | 含义 |
|---|---|
| DUT | 被测项目，路径为 `appRoot` |
| Manifest | DUT 上的功能点/模块/flow 绑定文件，目录真源 |
| 目录快照 | 同步后 SQLite 里的 module / feature / flow |
| 执行态 | attempt、run、日志摘要、产物路径、`feature.status` |
| 隐藏功能点 | 曾同步过、当前清单没有的 feature；列表不展示，历史 attempt 可开 |

## 4. Manifest

路径：`{appRoot}/{manifestPath}`，默认 `regression.manifest.json`。

```json
{
  "version": 1,
  "modules": [{ "id": "todo", "title": "Todo" }],
  "features": [{
    "module": "todo",
    "code": "2.1",
    "chapter": 2,
    "chapterTitle": "单 List 内的 Todo",
    "title": "…",
    "criteria": "…",
    "precondition": "…",
    "flow": "maestro/todo/item-fast-add.yaml"
  }]
}
```

校验（失败则整份拒绝，不半导入）：

- `version` 必须为 `1`
- `modules` 非空；`id` 匹配 `^[a-z0-9-]{2,20}$`；`title` 非空
- 每条 feature：`module` 必须出现在 `modules`；`code` 匹配 `^\d+\.\d+$`；`chapter` 为 ≥0 的整数；`title`、`criteria`、`flow` 非空
- `flow` 相对 `appRoot`，规范化后不得逃出 `appRoot`
- 同一 `(module, code)` 不得重复
- `precondition`、`chapterTitle` 可空

sync 成功时：yaml 文件不存在不导致整份失败，该 feature 标记不可执行（见 §6）。

控制台 **永不写入** 该文件。

## 5. 同步语义

同一函数：进程启动调用一次；`POST /sync` 再调。

成功时：

1. `module_meta`：按 `id` upsert `title`（表已有 `title` 列）。清单没有的模块不从 `GET /modules` 返回，行可保留。
2. `feature`：清单内按 `(module, code)` upsert `chapter/title/criteria/precondition`，`hidden=0`。`status` 不改（新行初始 `待执行`）。`notes` 视为控制台本地操作备注，**不在 manifest 中、同步不清空**。
3. `chapterTitle` 写入该模块 `module_meta.chapters_json`（按 chapter 号）。
4. `flow`：每条 feature 一条 `kind=flow`，path 为 manifest 的 `flow`。
5. 本次清单没有的 feature：`hidden=1`，不删行（保留 run/attempt 外键）。

失败时（文件缺失、JSON 坏、校验失败）：抛错；目录快照保持上一次成功结果；执行态不动。

## 6. 不可执行

feature 在列表中，但 `flow` 指向的文件不存在（sync 时检查）：`runnable=false`（API 字段即可，不一定加列）。点执行 → 4xx。其余功能点照常。

## 7. 配置

优先级不变：`REGRESSION_APP_ROOT` > `regression.config.json` 的 `appRoot`。

新增可选 `manifestPath`（相对 appRoot）。`sourceDirs` 本轮可留在 example 里但不参与内核（生成已移出控制台）。

无有效 `appRoot`：进程可听端口；`GET /features`、`POST /sync` 返回明确 4xx JSON（稳定 `code`，如 `NO_APP_ROOT` / `MANIFEST_INVALID`）。UI 提示配置，不加载任何本仓 yaml。

## 8. HTTP / UI

保留：token、`GET /modules`、`GET /features?module=`（必填，默认只返回 `hidden=0`）、`GET /attempts/:id`、执行、中止、日志流。看板始终带当前模块，无默认 `todo`。

新增：`POST /sync`。

去掉或 410：`POST /modules`、catalog apply、analyze apply、任何把 YAML 写进控制台仓或 DUT 的批准写盘。看板上「补功能点」若只是改库则删除。

诊断（只读日志）本轮不改、不依赖。

本轮禁用 `POST /export` 写控制台根 `TESTING_DEVICE_REGRESSION.md` / 进度 HTML。进度以看板 + SQLite 为准。

## 9. Runner

`createRunner` 的脚本根改为 `appRoot`。`spawn(maestroBin, ['test', flow.path], { cwd: appRoot })`。`flow.path` 为相对 DUT 的 posix 路径。`MAESTRO_BIN` 解析不变。单槽与 409 不变。

## 10. 迁出与本仓清空

迁到 DUT（`appRoot` 指向的仓库，通常是 choresReward）：

- 本仓 `maestro/` 整树（含 subflows），保持 `maestro/...` 相对路径
- 由 `src/seed/*.js` + `FLOW_BINDINGS` 生成第一份 `regression.manifest.json`
- 控制台不再维护功能点 Markdown 真源

本仓删除产品资产：`src/seed/`、`maestro/`（除测试夹具外）。删除 `importIfEmpty` / seed 版 `syncFlowBindings`。删除硬编码 `DEFAULT_MODULES`、`CHAPTER_TITLES`、Catalog 按模块 hint 模板。

单测夹具：`test/fixtures/app/regression.manifest.json` + 最小 yaml。覆盖：整份校验失败、缺 yaml 则不可跑、列表与清单一致、条目从清单删除后列表隐藏且旧 run 可查、spawn 的 cwd/argv 指向 fixture。

DUT 侧文件若在另一 git 仓库，在该仓库单独提交；本仓 spec/实现只负责生成或复制到配置的 `appRoot`（存在时）。

## 11. SQLite 变更

`feature` 增加 `hidden INTEGER NOT NULL DEFAULT 0`（沿用 `db.js` 现有迁移风格）。不删 feature/flow 行以免打断 `run.flow_id`。

## 12. 错误

| 情况 | 行为 |
|---|---|
| 无 appRoot | 4xx `NO_APP_ROOT`，无目录回退 |
| manifest 缺失/坏/越权 path | sync 失败，快照不变 |
| 单条 yaml 缺失 | sync 成功，该条不可跑 |
| maestro 二进制没有 | 现有 exit 127 |

## 13. 范围外

看板写回 manifest；控制台内 Claude 写 YAML；多 appRoot；文件 watch；把 diagnose 做成完整产品；用导出生成 DUT 功能点正文。

## 14. 验收

1. 删除本仓产品 `maestro/` 与 `src/seed/` 后 `npm test` 仍绿（只靠 fixture）。
2. 配置真实 DUT 后，列表与 manifest 一致；执行 cwd 为 DUT。
3. 改 DUT 清单并 sync，看板跟上；删除的功能点从列表消失，旧 attempt 仍可打开。
4. 不配 `appRoot` 时不会执行本仓旧脚本（本仓也没有旧脚本）。

## 15. 与旧 spec 的关系

`docs/specs/2026-09-07-regression-console-design.md` 中「SQLite 为功能点真源、AI 起草 YAML、本仓 maestro 写盘」被本文件覆盖。执行链（单槽 Maestro、token、attempt/run）仍然有效。
