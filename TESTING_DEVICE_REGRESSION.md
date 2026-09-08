# 真机回归（Maestro）

日期：2026-09-07　设备：`EW400003C`（Cozyla Calendar，与日常手测同一台）　包：`:app_calendar` 的 `uatDebug`

用 USB 真机脚本替代发版前「装包 → 点一遍主路径」的手测。脚本不负责编译、不负责装包。

---

## 一、文档怎么读

三个概念分开看，后面所有章节都按这三层组织：

| 概念 | 含义 | 在哪 |
|---|---|---|
| **功能点** | 被测的产品行为，是「验什么」。带数据前提，独立于脚本 | 第三节 |
| **执行流（flow）** | 可单独 `maestro test` 的入口脚本，是「怎么验」。一个 flow 只覆盖一个功能点 | 第四节 |
| **子流程（subflow）** | 被 flow 复用的片段（进页面、造夹具、清夹具），不单独作为用例 | 第四节 |
| **夹具（fixture）** | 脚本自己造、自己删的测试数据（`E2E Todo*` / `E2E_*`） | 第五节 |

---

## 二、边界

**做**：启动与导航冒烟、Todo 模块的增删改查与持久化、失败留截图并能对上 logcat。

**不做**（继续手测或交给单测）：

- 登录/登出竞态、ID App 登录页、主动登出
- Widget、ContentProvider 对外契约、跨设备同步冲突、断网对账
- 家长锁 PIN
- chore 打卡 / uncheck（依赖列表数据与点击区域，太脆）
- 重复规则、顺延、UseCase 等细规则 → 归 `app/src/test`（JVM）

不进默认 `./gradlew test`，不拿编译当验收。

会话前提：ID 已登录、token 可用。脚本开头即断言能进主 Tab —— 登录坏了就不该继续跑业务。

---

## 三、功能点清单

按**模块**再按**数据前提**分章。状态来自回归控制台 SQLite 当前值。

### 模块 `todo`

#### 第 0 章　App 级冒烟（无数据前提）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 0.1 | 冷启动进主界面，不停在 Welcome | `czl_nav_bar` 可见 且 `txtGetStarted` 不可见 | 通过 |
| 0.2 | 杀进程再进仍是登录态 | 同上，且不清数据 | 通过 |
| 0.3 | 日视图 / 周视图切换 | 日视图统计区 ↔ `tl_2` | 通过 |
| 0.4 | Todo 竖屏入口与根页 | 底部切到 To-do 后 `rvTodo` 可见 | 通过 |

#### 第 1 章　todo-list（有 list，无 todos；不点 Display / Filter）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 1.1 | 创建 List（名称 + 颜色 + 图标） | 根页出现该卡片；Lists 弹窗内有该行 | 通过 |
| 1.2 | 编辑 List | 编辑弹窗预填旧名（不符即失败，不写数据）；保存后新名可见 | 通过 |
| 1.3 | 改动落库 | 杀进程重进，改名仍在 | 通过 |
| 1.4 | 删除 List | 卡片与 Lists 行都消失；整轮只发 1 个 delete 请求 | 通过 |
| 1.5 | 拖拽排序 | 手柄拖动后相邻顺序变化；杀进程重进后顺序保持 | 通过 |
| 1.6 | List 数量上限 | 到 `MAX_TODO_LIST_COUNT` 时出提示、不再新增 | 留手测 |

#### 第 2 章　单 List 内的 Todo（有 1 个夹具 List；仍不点 Display / Filter）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 2.1 | 卡片内快速添加 | 夹具卡片里出现 `E2E_Fast` | 通过 |
| 2.2 | 根页 Add 完整创建 | 保存前确认弹窗选中的是夹具 List，否则失败不保存；出现 `E2E_Full` | 通过 |
| 2.3 | 编辑改名 | 旧名消失、新名可见 | 通过 |
| 2.4 | 删除单条 Todo | 该条消失，夹具 List 仍在 | 通过 |
| 2.5 | Todo 落库 | 杀进程重进，2.1/2.2 的条目仍在 | 通过 |

#### 第 3 章　Display 排序（同一 List 内多条 Todo，标题与截止时间可区分）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 3.1 | group by List / Profile | **卡片集合变化**（List → 每个 list 一张卡；Profile → 每人一张卡） | 通过 |
| 3.2 | sort by title | 相邻顺序断言（`above` / `below`） | 待写 |
| 3.3 | sort by due date | 同上 | 待写 |
| 3.4 | 配置落库 | 杀进程重进，配置仍在 | 假绿 |

#### 第 4 章　完成态（有已完成的 Todo）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 4.1 | 勾选完成 | 该条进入完成态 | 待写 |
| 4.2 | Show completed 开关 | 关闭时完成项不可见、开启时可见 | 待写 |
| 4.3 | 反完成 | 回到未完成态 | 待写 |

#### 第 5 章　Filter（多成员 + 已指派的 Todo）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 5.1 | 按成员筛选 | 只剩该成员的条目 | 待写 |
| 5.2 | 清除筛选 | 恢复全量 | 待写 |

---

## 四、执行流

### 入口 flow（可单独跑）

| 文件 | 覆盖功能点 | 状态 |
|---|---|---|
| `maestro/cold-launch.yaml` | 0.1 | ✅ |
| `maestro/kill-relaunch.yaml` | 0.2 | ✅ |
| `maestro/switch-day-week.yaml` | 0.3 | ✅（依赖第六节的临时改动） |
| `maestro/todo/open-root.yaml` | 0.4 | ✅ |
| `maestro/todo/list-crud.yaml` | 1.1 – 1.4 | ✅ |
| `maestro/todo/list-drag-sort.yaml` | 1.5 | ✅ |
| `maestro/todo/item-fast-add.yaml` | 2.1 | 结果断言绑在夹具卡片内 |
| `maestro/todo/item-create.yaml` | 2.2 | 待按第 2 章口径重写 |
| `maestro/todo/display-modes.yaml` | 原意 3.x | ⚠️ 假绿，待重做 |
| `maestro/todo/todo-crud.yaml` | 旧的大 flow（2.x 混在一起） | 待删，由 item-* 拆分取代 |

### 子流程

| 文件 | 职责 |
|---|---|
| `subflows/open-todo.yaml` | 竖屏 → 启动 → 切到 To-do → 等 `rvTodo` |
| `subflows/require-list-grouping.yaml` | **只断言**当前分组是 List，不点 Display（第 1、2 章的前提校验） |
| `subflows/create-fixture-list.yaml` | 造夹具 List `E2E Todo`（名字硬编码，见第七节） |
| `subflows/cleanup-fixture.yaml` | 删除标题匹配 `E2E Todo.*` 的行，最多 5 个 |
| `subflows/set-list-manual.yaml` | 会点 Display 设成 List + Manual。**第 1、2 章不得使用**，留给第 3 章 |

### 运行

```bash
export PATH="$HOME/.maestro/bin:$PATH"
cd tools/regression-console

# 每场开始先清残留夹具
maestro test maestro/todo/subflows/cleanup-fixture.yaml

# 第 0 章
maestro test maestro/cold-launch.yaml
maestro test maestro/kill-relaunch.yaml
maestro test maestro/switch-day-week.yaml
maestro test maestro/todo/open-root.yaml

# 第 1 章
maestro test maestro/todo/list-crud.yaml
maestro test maestro/todo/list-drag-sort.yaml
```

`maestro/` 是 Regression Console 的产物目录，实际位置为
`tools/regression-console/maestro/`；表格与控制台仍使用相对控制台根的 `maestro/...` 路径。

一次只跑一条、只判一件事。失败产物在 `~/.maestro/tests/<时间戳>/`，含 `maestro.log`、`device-logcat.txt`、失败步骤的截图与界面层级 JSON。

**跑之前**：设备需停在 List 分组（第 1、2 章脚本不会替你切）；已装好要验的包。

---

## 五、夹具与数据约定

- 命名：List 用 `E2E Todo`、`E2E Todo A/B`、`E2E Todo Edited`；Todo 用 `E2E_` 前缀。
- 每个 flow 自己 **先清后造、用完再清**，不依赖上一条 flow 的残留。
- 删除只针对标题匹配 `E2E Todo.*` **且行内绑定命中**的那一行；删除 List 会连带它的 Todo。
- 清理上限是 5，残留超过 5 个需要手动或多跑一次。

---

## 六、待还原的临时改动

| 位置 | 改了什么 | 为什么 | 何时还原 |
|---|---|---|---|
| `app/src/main/java/com/cozyla/choresreward/init/AppRuntimeBootstrap.kt` | 关掉性能监控浮窗 | 浮窗遮挡，导致 0.3 的点击打不中 | 自动化不跑时应还原，**别带进发版分支** |

---

## 七、编写铁律（都是踩出来的）

### 1. 坐标关系不得用于定位操作目标

`rightOf` / `below` / `leftOf` / `above` **只比较屏幕坐标**，不含任何行内或层级约束。

曾用 `tapOn: {id: iv_todolist_sort_more, rightOf: "E2E Todo.*"}` 删夹具：Lists 弹窗每行右侧都有 more 图标，
「在夹具右边」对所有行都成立，Maestro 取树序第一个 —— 于是打开的是**最上面那一行**的菜单。
外层还套了 `repeat`，把用户 7 个真实 List 全删了，另有 1 个被改错名。

**正确写法**：绑定到行容器。

```yaml
- tapOn:
    id: "com.cozyla.choresreward:id/iv_todolist_sort_more"
    childOf:
      containsChild:
        id: "com.cozyla.choresreward:id/tv_todolist_title"
        text: "E2E Todo.*"
```

父节点有多个同类子节点时还要限定中间层（例：卡片根下的快速添加，用 `containsChild` 指向自身 id 来消歧）。

**唯一例外**：`above` / `below` 用于**顺序断言**（判断谁在谁上面）是正确用法，见 1.5。

### 2. 写入前做 fail-closed 断言

编辑类操作在输入前先断言对象正确，不符就失败、不写数据：

```yaml
- assertVisible:
    id: "com.cozyla.choresreward:id/et_todolist_name"
    text: "E2E Todo"
```

选错行时会立刻停住，而不是改坏别人的数据。

### 3. 没有数据支撑的断言就是假绿

断言必须落在**数据可观察的效果**上，不能只断言控件自身的 `selected`。详见第 3.4 与下面「已知假绿」。

### 4. 一次只交一个可验证单元

一个 flow 只做一件事。旧的 `todo-crud.yaml` 把快速添加 + 完整创建 + List 选择 + Flag + 编辑 + 杀进程 + 删除塞在一起，
单次 3 分钟、失败只暴露一个点，改一处要重跑全套。

### 5. 工具行为备忘

| 现象 | 结论 |
|---|---|
| `runFlow` 的 `env` 传参 | **无效**：子流程 header 里的默认值胜出，两次调用建出两个同名 List。多参数场景请内联步骤 |
| 步骤日志里的 `${VAR}` | 打印的是**未插值**的原始命令，不能据此判断变量有没有替换成功 |
| 自定义 `SwitchButton` | 不向无障碍层暴露真实 `checked`，只能验行为效果（4.2），不能断言状态 |
| List 卡片 | 横向排列，新建的可能在屏幕外，需 `scrollUntilVisible` + `direction: RIGHT` |
| 拖拽排序 | `isDragOnLongPressEnabled=false`、`toggleViewId=iv_todolist_sort`，触摸手柄即开始拖；Maestro 用 `swipe` 锚定手柄 + `duration: 1500` 可触发 |
| Maestro driver app | 不要卸载 `dev.mobile.maestro`：这台受管设备卸载后重装会报 `INSTALL_FAILED_USER_RESTRICTED`，需重启设备才恢复 |

---

## 八、已知假绿

`maestro/todo/display-modes.yaml` 全绿但**不证明任何功能**：它只断言 Display 弹窗自身的 `selected` 状态和配置持久化，
而那次运行账号里没有 todos —— sort by title / due date、Show completed 三项本就不可能产生可见变化，等于只测了「开关能按下去」；
真正有效果的 group by（卡片集合变化）反而没断言。

重做方式：拆成 3.1（卡片集合，第 3 章）和 3.4（纯配置持久化，不假装测排序）。

---

## 九、验收

- 同一台已登录真机，逐条命令能跑完当时已落地的 flow。
- 失败有截图与 logcat，能在一次 session 内判断「回退改动」还是「修脚本」。
- 发版前用它代替「点一遍主路径」；细规则仍看 `app/src/test` 与指定手测。

## 十、与其他测试文档的关系

| 文档 | 职责 |
|---|---|
| 本文件 | 真机 Maestro 回归 |
| `TESTING_UI_REPEAT_VIEWS.md` | instrumented：重复选择 View |
| `TESTING_ROUTINE_*.md` | 日常/周常/月常手测或规则清单 |
| `app/src/test` | JVM：规则与 UseCase |
