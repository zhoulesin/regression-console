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

#### 第 0 章　App 级冒烟（无数据前提；App 已登录过（非首次安装）。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 0.1 | 冷启动进主界面，不停在 Welcome | App 冷启动后底部导航栏（czl_nav_bar）可见，引导页按钮（txtGetStarted）不可见；直接进入主界面。 | 通过 |
| 0.2 | 杀进程再进仍是登录态 | 执行 stopApp → launchApp 后，底部导航栏（czl_nav_bar）可见、txtGetStarted 不可见；不弹登录页，不清本地数据。 | 通过 |
| 0.3 | 日视图 / 周视图切换 | 在统计区点击日/周切换按钮 → 日视图时 tl_1 可见（日统计），周视图时 tl_2 可见（周统计）；切换后对应 Tab 高亮态变化。 | 通过 |
| 0.4 | Todo 竖屏入口与根页 | 点击底部导航栏的 To-do Tab → Todo 根页的 RecyclerView（rvTodo）可见；页面标题或 Tab 高亮态正确。 | 通过 |

#### 第 1 章　todo-list（Todo 根页无自定义 List；不点 Display / Filter。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 1.1 | 创建 List（名称 + 颜色 + 图标） | 点击创建 List → 输入名称、选择颜色和图标 → 点击保存 → 根页出现该 List 卡片（tv_todolist_title 文本匹配）；打开 Lists 弹窗（点击列表选择器）→ 弹窗内可见该 List 行。 | 通过 |
| 1.2 | 编辑 List | 长按 List 卡片 → 点击编辑 → 编辑弹窗内 editName 预填旧名称（不符即失败，不写数据）→ 修改名称后点 txtSave 保存 → 根页卡片 tv_todolist_title 更新为新名称。 | 通过 |
| 1.3 | 改动落库 | 执行 1.2 改名后 → stopApp → launchApp → 进入 Todo 根页 → 卡片 tv_todolist_title 仍显示修改后的名称。 | 通过 |
| 1.4 | 删除 List | 长按 List 卡片 → 点击删除 → 确认删除 → 根页该卡片（tv_todolist_title）不可见；打开 Lists 弹窗 → 该 List 行不可见；整轮只发 1 个 delete 网络请求。 | 通过 |
| 1.5 | 拖拽排序 | 长按 List 卡片拖拽手柄 → 将 A 拖到 B 下方 → 松手后 A 的卡片出现在 B 下方（above/below 断言）→ stopApp → launchApp → 顺序保持不变。 | 通过 |
| 1.6 | List 数量上限 | 创建 List 直到数量达到 MAX_TODO_LIST_COUNT → 再次点击创建时出现上限提示（Toast 或弹窗文案可见）→ 不再新增 List 卡片。 | 留手测 |

#### 第 2 章　单 List 内的 Todo（有 1 个夹具 List（E2E Todo）；Todo 根页处于 List group-by + Manual sort；不点 Display / Filter。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 2.1 | 卡片内快速添加 | 在含 tv_todolist_title=E2E Todo 的卡片内，点击快速添加输入框（editFastAdd）输入 E2E_Fast 并确认；该卡片的 RecyclerView（rvTodoItem）内出现标题为 E2E_Fast 的 Todo 条目（tv_todoitem_title 文本匹配）；不得只断言全屏文字出现。 | 通过 |
| 2.2 | 根页 Add 完整创建 | 点击根页 Add 按钮（txtAdd）→ 弹窗内输入标题 E2E_Full → 点击 txtSave → 若弹出 List 选择弹窗则确认选中的是夹具 List（tv_todolist_title=E2E Todo），否则失败不保存 → 创建成功后回到根页，夹具卡片的 RecyclerView 内出现标题为 E2E_Full 的条目（tv_todoitem_title 文本匹配）。 | 通过 |
| 2.3 | 编辑改名 | 长按夹具卡片内一条 Todo（如 E2E_Fast）→ 点击编辑（或点击条目进入编辑弹窗）→ editName 文本清空后输入 E2E_Renamed → 点击 txtSave 保存 → 弹窗关闭后，原 E2E_Fast 的 tv_todoitem_title 不可见，E2E_Renamed 的 tv_todoitem_title 可见且文本匹配。 | 通过 |
| 2.4 | 删除单条 Todo | 长按夹具卡片内一条 Todo（如 E2E_Fast）→ 点击删除 → 确认删除弹窗点 txtConfirm → 该条目的 tv_todoitem_title 不可见；夹具 List 卡片本身（tv_todolist_title=E2E Todo）仍然可见。 | 通过 |
| 2.5 | Todo 落库 | 先通过 2.1（快速添加 E2E_Persist）或 2.2（完整创建 E2E_Persist）创建一条 Todo → 杀进程（stopApp）→ 重新启动 App → 进入 Todo 根页 → 夹具卡片（tv_todolist_title=E2E Todo）的 RecyclerView 内仍可见标题为 E2E_Persist 的条目（tv_todoitem_title 文本匹配）。 | 通过 |
| 2.6 | 完整创建时设置截止日期，卡片展示 DueTime | 在根页 Add 弹窗内点击 selectDate → 弹出日历弹窗选择明天 → 点击 llSelectTime 选择一个时间（如 10:00 AM）→ 点击 txtSave 关闭日历弹窗；创建对话框内 llDate 可见、txtTime 文本包含所选日期/时间；点 txtSave 创建后回到 Todo 根页，夹具 List 卡片内出现该条 Todo，cons_extra_container 可见且 ll_duetime_container 可见，tv_todoitem_duetime 文本包含所选日期（如 "Tomorrow" 或 "Sep 9"）。 | 失败 |
| 2.7 | 完整创建时设置优先级旗标，卡片展示旗标图标 | 在根页 Add 弹窗内输入标题后点击 imgFlag；imgFlag 背景变为 amber_50 底色 + amber_500 描边（可通过 selected:true 或 drawable 切换判断）；点 txtSave 创建后回到 Todo 根页，夹具卡片内该条 Todo 的 iv_todo_info_flag 可见（未设 flag 时该 ImageView 被 setGone 隐藏）。 | 通过 |
| 2.8 | 完整创建时指派成员，卡片展示成员头像 | 在根页 Add 弹窗内输入标题后点击 selectMember → 弹出 SelectMemberPopup（rvPopupMember 可见）→ 点击任一成员头像 → llMember 可见且 txtMemberName 显示该成员名、imgMemberAvatar 可见 → 点击 txtSave 关闭弹窗 → 点击创建弹窗的 txtSave 创建后回到 Todo 根页；夹具卡片内该条 Todo 的 iv_todoitem_avatar 可见（未指派时该 ImageView 被 setGone 隐藏）。 | 失败 |
| 2.9 | 完整创建时添加描述，卡片展示描述文本 | 在根页 Add 弹窗内输入标题后，在 editDesc 输入 "E2E_Desc_Note"；点 txtSave 创建后回到 Todo 根页；夹具卡片内该条 Todo 的 tv_todo_info_desc 可见（非 gone）且文本为 "E2E_Desc_Note"（无描述时该 TextView 被 setGone 隐藏）。 | 待写 |
| 2.10 | 创建弹窗空标题拦截 | 在根页 Add 弹窗打开后，editName 为空（未输入或全部删除）；txtNameTips 可见且文本显示非空校验提示文案（资源 id nameTips，coral_500 色），txtSave 不可见（visibility = gone）、txtNoSave 可见（visibility = visible，灰色禁用态）。 | 待写 |
| 2.11 | 创建弹窗超长标题拦截 | 在根页 Add 弹窗的 editName 输入超过 100 个可见字符的文本（如 101 个 'A'）；txtNameTips 可见且文本显示超长校验提示文案（资源 id nameCharactersMax1，coral_500 色），txtSave 不可见（visibility = gone）、txtNoSave 可见（visibility = visible，灰色禁用态），无法完成创建。 | 待写 |

#### 第 3 章　Display 排序（至少 2 个 List 各有 Todo；至少 2 个成员有 Todo。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 3.1 | group by List / Profile | 打开 Display 弹窗 → 选择 group by List → 根页每张卡片对应一个 List（tv_todolist_title 不同）→ 再切换 group by Profile → 卡片变为每人一张（tv_member_name 不同）。两组卡片集合完全不同。 | 通过 |
| 3.2 | sort by title | 打开 Display 弹窗 → 选择 sort by title → 根页同卡片内 Todo 条目按 tv_todoitem_title 字母序排列（above/below 断言相邻条目顺序）。 | 待写 |
| 3.3 | sort by due date | 打开 Display 弹窗 → 选择 sort by due date → 根页同卡片内 Todo 条目按 tv_todoitem_duetime 日期序排列（above/below 断言相邻条目顺序）。 | 待写 |
| 3.4 | 配置落库 | 执行 3.2 或 3.3 切换排序后 → stopApp → launchApp → 进入 Todo 根页 → Display 配置保持上次选择（sort by title / due date），条目顺序与杀进程前一致。 | 假绿 |
| 3.5 | 组合排序 — 多 List 下 sort by due date 各卡片内独立排序 | 根页出现两张 List 卡片 A（tv_todolist_title='E2E Todo A'）和 B（tv_todolist_title='E2E Todo B'）；A 卡片 RecyclerView 内 3 条 Todo 的 tv_todoitem_duetime 按日期升序排列（above/below 断言相邻行：Aug 10 → Sep 10 → Oct 10），B 卡片内仅 1 条 Todo 无顺序约束；切换排序不影响卡片出现顺序（A 仍在 B 左侧）。 | 待写 |
| 3.6 | 排序类型切换 — 从 sort by date 切到 sort by title 后卡片内顺序翻转 | 先确认当前卡片内 tv_todoitem_title 顺序为 Gamma_Due（Oct 10）→ Beta_Due（Sep 10）→ Alpha_Due（Aug 10）；打开 Display 弹窗（id llDisplay）→ 点击 ll_sort_title_container → 弹窗内 ll_sort_title_container selected=true、ll_sort_duedate_container selected=false → 关闭弹窗（back）→ 同一卡片内 tv_todoitem_title 顺序变为 Alpha_Due → Beta_Due → Gamma_Due（above/below 断言），与之前顺序相反。 | 待写 |
| 3.7 | 组合排序 — group by Profile + sort by title 按成员卡片内字母序 | 打开 Display 弹窗（id llDisplay）→ 选择 rl_group_profile_container 和 ll_sort_title_container → 弹窗内两容器 selected=true → 关闭弹窗（back）→ 根页出现以该成员名命名的 Profile 卡片（tv_todoprofile_name 文本匹配）；卡片 RecyclerView 内 3 条 Todo 的 tv_todoitem_title 按字母序排列（above/below 断言：Alpha_M → Beta_M → Gamma_M）。 | 待写 |
| 3.8 | 无数据 List 在 sort by title 下仍展示卡片及内联空态 | 根页出现 tv_todolist_title='E2E Todo' 的卡片（可见）；卡片内 RecyclerView（rv_todolist_child）无可滚动的 Todo 条目，显示该 List 对应颜色的空态图片（空态 layout 可见，colorPalette.todoEmptyLayoutId）；该卡片本身不受排序类型影响始终可见。 | 待写 |
| 3.9 | sort by due date 混合有无截止日期 Todo — 无日期项排在末尾 | 夹具卡片（tv_todolist_title='E2E Todo'）RecyclerView 内前 2 条 Todo 的 tv_todoitem_duetime 按日期升序排列（Tomorrow → 后天，above/below 断言）；第 3 条 Todo（NoDate_Todo）的 ll_duetime_container 不可见（gone）且排在所有有截止日期项之后（位于列表最底部）。 | 待写 |

#### 第 4 章　完成态（有 1 个夹具 List 且内有至少 1 条未完成 Todo。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 4.1 | 勾选完成 | 点击一条未完成 Todo 的勾选框（checkbox）→ 该条目的 tv_todoitem_title 出现删除线样式（paintFlags 包含 STRIKE_THRU_TEXT_FLAG）或视觉变为灰色完成态。 | 待写 |
| 4.2 | Show completed 开关 | 打开 Display 弹窗 → 关闭 Show completed 开关 → 已完成 Todo 条目不可见 → 再开启 → 已完成条目重新可见（tv_todoitem_title 可见）。 | 待写 |
| 4.3 | 反完成 | 点击一条已完成 Todo 的勾选框 → 该条目的删除线样式消失、恢复为正常未完成态（tv_todoitem_title 样式正常）。 | 待写 |

#### 第 5 章　Filter（至少 2 个成员；有已指派给不同成员的 Todo。）

| # | 功能点 | 判定依据 | 状态 |
|---|---|---|---|
| 5.1 | 按成员筛选 | 点击 Filter 按钮 → 选择某个成员头像 → 根页只显示该成员被指派的 Todo 条目（iv_todoitem_avatar 可见且归属正确）；未被指派该成员的条目不可见。 | 待写 |
| 5.2 | 清除筛选 | 在 5.1 已按成员筛选后 → 点击清除筛选（或再次点击已选成员取消）→ 根页恢复显示全部 Todo 条目，数量与筛选前一致。 | 待写 |

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
