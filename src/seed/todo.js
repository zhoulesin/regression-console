import { STATUS } from '../constants.js';

/** @typedef {{ module: string, code: string, chapter: number, title: string, criteria: string, precondition: string, status: string }} SeedRow */

/** @type {SeedRow[]} */
export const SEED_TODO = [
  // 第 0 章　App 级冒烟（无数据前提）
  {
    module: 'todo',
    code: '0.1',
    chapter: 0,
    title: '冷启动进主界面，不停在 Welcome',
    criteria:
      'App 冷启动后底部导航栏（czl_nav_bar）可见，引导页按钮（txtGetStarted）不可见；直接进入主界面。',
    precondition: '无数据前提；App 已登录过（非首次安装）。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '0.2',
    chapter: 0,
    title: '杀进程再进仍是登录态',
    criteria:
      '执行 stopApp → launchApp 后，底部导航栏（czl_nav_bar）可见、txtGetStarted 不可见；不弹登录页，不清本地数据。',
    precondition: '无数据前提；App 已登录过。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '0.3',
    chapter: 0,
    title: '日视图 / 周视图切换',
    criteria:
      '在统计区点击日/周切换按钮 → 日视图时 tl_1 可见（日统计），周视图时 tl_2 可见（周统计）；切换后对应 Tab 高亮态变化。',
    precondition: '无数据前提。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '0.4',
    chapter: 0,
    title: 'Todo 竖屏入口与根页',
    criteria:
      '点击底部导航栏的 To-do Tab → Todo 根页的 RecyclerView（rvTodo）可见；页面标题或 Tab 高亮态正确。',
    precondition: '无数据前提。',
    status: STATUS.PASSED,
  },

  // 第 1 章　todo-list（前提：有 list，无 todos；不点 Display / Filter）
  {
    module: 'todo',
    code: '1.1',
    chapter: 1,
    title: '创建 List（名称 + 颜色 + 图标）',
    criteria:
      '点击创建 List → 输入名称、选择颜色和图标 → 点击保存 → 根页出现该 List 卡片（tv_todolist_title 文本匹配）；打开 Lists 弹窗（点击列表选择器）→ 弹窗内可见该 List 行。',
    precondition: 'Todo 根页无自定义 List；不点 Display / Filter。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '1.2',
    chapter: 1,
    title: '编辑 List',
    criteria:
      '长按 List 卡片 → 点击编辑 → 编辑弹窗内 editName 预填旧名称（不符即失败，不写数据）→ 修改名称后点 txtSave 保存 → 根页卡片 tv_todolist_title 更新为新名称。',
    precondition: '已有 1 个 List（如 E2E Todo）；不点 Display / Filter。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '1.3',
    chapter: 1,
    title: '改动落库',
    criteria:
      '执行 1.2 改名后 → stopApp → launchApp → 进入 Todo 根页 → 卡片 tv_todolist_title 仍显示修改后的名称。',
    precondition: '已有 1 个 List 且已执行 1.2 改名；不点 Display / Filter。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '1.4',
    chapter: 1,
    title: '删除 List',
    criteria:
      '长按 List 卡片 → 点击删除 → 确认删除 → 根页该卡片（tv_todolist_title）不可见；打开 Lists 弹窗 → 该 List 行不可见；整轮只发 1 个 delete 网络请求。',
    precondition: '已有 1 个 List（如 E2E Todo）；该 List 内无 Todo 条目；不点 Display / Filter。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '1.5',
    chapter: 1,
    title: '拖拽排序',
    criteria:
      '长按 List 卡片拖拽手柄 → 将 A 拖到 B 下方 → 松手后 A 的卡片出现在 B 下方（above/below 断言）→ stopApp → launchApp → 顺序保持不变。',
    precondition: '已有至少 2 个 List（如 E2E Todo A、E2E Todo B）；不点 Display / Filter。',
    status: STATUS.PASSED,
  },
  {
    module: 'todo',
    code: '1.6',
    chapter: 1,
    title: 'List 数量上限',
    criteria:
      '创建 List 直到数量达到 `MAX_TODO_LIST_COUNT` → 再次点击创建时出现上限提示（Toast 或弹窗文案可见）→ 不再新增 List 卡片。',
    precondition: '已有 `MAX_TODO_LIST_COUNT - 1` 个 List；不点 Display / Filter。',
    status: STATUS.MANUAL,
  },

  // 第 2 章　单 List 内的 Todo（前提：有 1 个夹具 List；仍不点 Display / Filter）
  {
    module: 'todo',
    code: '2.1',
    chapter: 2,
    title: '卡片内快速添加',
    criteria:
      '在含 `tv_todolist_title=E2E Todo` 的卡片内，点击快速添加输入框（editFastAdd）输入 `E2E_Fast` 并确认；该卡片的 RecyclerView（rvTodoItem）内出现标题为 `E2E_Fast` 的 Todo 条目（tv_todoitem_title 文本匹配）；不得只断言全屏文字出现。',
    precondition: '有 1 个夹具 List（E2E Todo）；Todo 根页处于 List group-by + Manual sort；不点 Display / Filter。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '2.2',
    chapter: 2,
    title: '根页 Add 完整创建',
    criteria:
      '点击根页 Add 按钮（txtAdd）→ 弹窗内输入标题 `E2E_Full` → 点击 txtSave → 若弹出 List 选择弹窗则确认选中的是夹具 List（tv_todolist_title=E2E Todo），否则失败不保存 → 创建成功后回到根页，夹具卡片的 RecyclerView 内出现标题为 `E2E_Full` 的条目（tv_todoitem_title 文本匹配）。',
    precondition: '有 1 个夹具 List（E2E Todo）；Todo 根页处于 List group-by + Manual sort；不点 Display / Filter。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '2.3',
    chapter: 2,
    title: '编辑改名',
    criteria:
      '长按夹具卡片内一条 Todo（如 `E2E_Fast`）→ 点击编辑（或点击条目进入编辑弹窗）→ editName 文本清空后输入 `E2E_Renamed` → 点击 txtSave 保存 → 弹窗关闭后，原 `E2E_Fast` 的 tv_todoitem_title 不可见，`E2E_Renamed` 的 tv_todoitem_title 可见且文本匹配。',
    precondition: '有 1 个夹具 List（E2E Todo）且该 List 内已有至少 1 条 Todo（如 2.1 创建的 E2E_Fast）；不点 Display / Filter。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '2.4',
    chapter: 2,
    title: '删除单条 Todo',
    criteria:
      '长按夹具卡片内一条 Todo（如 `E2E_Fast`）→ 点击删除 → 确认删除弹窗点 txtConfirm → 该条目的 tv_todoitem_title 不可见；夹具 List 卡片本身（tv_todolist_title=E2E Todo）仍然可见。',
    precondition: '有 1 个夹具 List（E2E Todo）且该 List 内已有至少 1 条 Todo；不点 Display / Filter。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '2.5',
    chapter: 2,
    title: 'Todo 落库',
    criteria:
      '先通过 2.1（快速添加 `E2E_Persist`）或 2.2（完整创建 `E2E_Persist`）创建一条 Todo → 杀进程（stopApp）→ 重新启动 App → 进入 Todo 根页 → 夹具卡片（tv_todolist_title=E2E Todo）的 RecyclerView 内仍可见标题为 `E2E_Persist` 的条目（tv_todoitem_title 文本匹配）。',
    precondition: '有 1 个夹具 List（E2E Todo）；Todo 根页处于 List group-by + Manual sort；不点 Display / Filter。',
    status: STATUS.PENDING_WRITE,
  },

  // 第 3 章　Display 排序（前提：同一 List 内多条 Todo，标题与截止时间可区分）
  {
    module: 'todo',
    code: '3.1',
    chapter: 3,
    title: 'group by List / Profile',
    criteria:
      '打开 Display 弹窗 → 选择 group by List → 根页每张卡片对应一个 List（tv_todolist_title 不同）→ 再切换 group by Profile → 卡片变为每人一张（tv_member_name 不同）。两组卡片集合完全不同。',
    precondition: '至少 2 个 List 各有 Todo；至少 2 个成员有 Todo。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '3.2',
    chapter: 3,
    title: 'sort by title',
    criteria:
      '打开 Display 弹窗 → 选择 sort by title → 根页同卡片内 Todo 条目按 tv_todoitem_title 字母序排列（above/below 断言相邻条目顺序）。',
    precondition: '同一 List 内至少 3 条 Todo，标题可区分（如 Alpha、Beta、Gamma）。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '3.3',
    chapter: 3,
    title: 'sort by due date',
    criteria:
      '打开 Display 弹窗 → 选择 sort by due date → 根页同卡片内 Todo 条目按 tv_todoitem_duetime 日期序排列（above/below 断言相邻条目顺序）。',
    precondition: '同一 List 内至少 3 条 Todo，截止日期不同（如今天、明天、后天）。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '3.4',
    chapter: 3,
    title: '配置落库',
    criteria:
      '执行 3.2 或 3.3 切换排序后 → stopApp → launchApp → 进入 Todo 根页 → Display 配置保持上次选择（sort by title / due date），条目顺序与杀进程前一致。',
    precondition: '同一 List 内多条 Todo，标题与截止时间可区分。',
    status: STATUS.FALSE_GREEN,
  },

  // 第 4 章　完成态（前提：有已完成的 Todo）
  {
    module: 'todo',
    code: '4.1',
    chapter: 4,
    title: '勾选完成',
    criteria:
      '点击一条未完成 Todo 的勾选框（checkbox）→ 该条目的 tv_todoitem_title 出现删除线样式（paintFlags 包含 STRIKE_THRU_TEXT_FLAG）或视觉变为灰色完成态。',
    precondition: '有 1 个夹具 List 且内有至少 1 条未完成 Todo。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '4.2',
    chapter: 4,
    title: 'Show completed 开关',
    criteria:
      '打开 Display 弹窗 → 关闭 Show completed 开关 → 已完成 Todo 条目不可见 → 再开启 → 已完成条目重新可见（tv_todoitem_title 可见）。',
    precondition: '有 1 个夹具 List 且内有已完成和未完成的 Todo 各至少 1 条。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '4.3',
    chapter: 4,
    title: '反完成',
    criteria:
      '点击一条已完成 Todo 的勾选框 → 该条目的删除线样式消失、恢复为正常未完成态（tv_todoitem_title 样式正常）。',
    precondition: '有 1 个夹具 List 且内有至少 1 条已完成 Todo。',
    status: STATUS.PENDING_WRITE,
  },

  // 第 5 章　Filter（前提：多成员 + 已指派的 Todo）
  {
    module: 'todo',
    code: '5.1',
    chapter: 5,
    title: '按成员筛选',
    criteria:
      '点击 Filter 按钮 → 选择某个成员头像 → 根页只显示该成员被指派的 Todo 条目（iv_todoitem_avatar 可见且归属正确）；未被指派该成员的条目不可见。',
    precondition: '至少 2 个成员；有已指派给不同成员的 Todo。',
    status: STATUS.PENDING_WRITE,
  },
  {
    module: 'todo',
    code: '5.2',
    chapter: 5,
    title: '清除筛选',
    criteria:
      '在 5.1 已按成员筛选后 → 点击清除筛选（或再次点击已选成员取消）→ 根页恢复显示全部 Todo 条目，数量与筛选前一致。',
    precondition: '至少 2 个成员；有已指派给不同成员的 Todo；已执行 5.1 按成员筛选。',
    status: STATUS.PENDING_WRITE,
  },
];
