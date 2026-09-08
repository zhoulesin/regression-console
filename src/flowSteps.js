import { parseAllDocuments } from 'yaml';

/**
 * 把生成的 Maestro YAML 翻译成中文步骤，给人工批准用。
 *
 * 为什么是机器翻译而不是让 Claude 自述：审阅的意义在于「批准的就是脚本真会干的事」。
 * AI 自述可能与脚本不符（例如说「卡片内可见」而脚本写的是全屏断言），
 * 那种假绿不会报错，只能在批准前看出来。
 */

/** 控件 id → 中文名。认不出的 id 原样显示，不猜。 */
const ID_NAMES = {
  rvTodo: 'To-do 列表',
  czl_nav_bar: '底部导航',
  txtGetStarted: '欢迎页开始按钮',
  tl_2: '周视图 Tab',
  ll_todo_groupby_sort: 'Lists 弹窗入口',
  ll_add_todolist: '新建清单',
  et_todolist_name: '清单名称输入框',
  tv_todolist_title: '清单标题',
  iv_todolist_sort_more: '清单更多按钮',
  ll_todolist_more_edit: '编辑',
  ll_todolist_more_delete: '删除',
  tv_delete: '确认删除',
  iv_todolist_create_color: '颜色',
  iv_todolist_create_icon: '图标',
  tv_save: '保存',
  txtSave: '保存',
  ll_fast_add_placeholder: '快速添加入口',
  et_content: '输入框',
  iv_confirm: '确认',
  iv_todo_root_add: '根页新增按钮',
  editName: '名称输入框',
  todoListLayout: '清单选择区',
  txtTodoListName: '清单名称',
  txtTodoListDesc: '清单说明',
  tv_todo_info_title: '待办标题',
  tv_todo_count: '待办数量',
};

/** 子流程文件 → 中文名。不递归展开，避免一屏变几十步。 */
const SUBFLOW_NAMES = {
  'open-todo.yaml': '打开 To-do 页',
  'require-list-grouping.yaml': '确认当前按清单分组',
  'create-fixture-list.yaml': '创建夹具清单「E2E Todo」',
  'cleanup-fixture.yaml': '清理测试数据',
  'set-list-manual.yaml': '设为清单 + 手动排序',
};

/** @param {string} raw 形如 com.cozyla.choresreward:id/rvTodo */
function shortId(raw) {
  const tail = String(raw).split('/').pop() ?? '';
  return ID_NAMES[tail] ?? tail;
}

/** @param {string} file */
function subflowName(file) {
  const base = String(file).split('/').pop() ?? '';
  return SUBFLOW_NAMES[base] ?? `子流程 ${base}`;
}

/**
 * 在 childOf/containsChild/containsDescendants 里找出「锚点文字」，
 * 用来表达「在哪一行/哪张卡里」。
 * @param {any} node
 * @returns {string | null}
 */
function findAnchorText(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.text === 'string' && node.text) return node.text;
  for (const key of ['containsChild', 'childOf', 'containsDescendants']) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const hit = findAnchorText(item);
        if (hit) return hit;
      }
    } else if (child) {
      const hit = findAnchorText(child);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 选择器 → 中文描述。容器约束会体现成「…内的」，
 * 这样一旦断言退化成全屏匹配，描述里就少了范围，人能一眼看出。
 * @param {any} sel
 */
function describeSelector(sel) {
  if (sel == null) return '目标';
  if (typeof sel === 'string') return `「${sel}」`;

  const parts = [];
  const name = sel.id ? shortId(sel.id) : '';
  if (name && sel.text) {
    parts.push(`${name}「${sel.text}」`);
  } else if (sel.text) {
    parts.push(`「${sel.text}」`);
  } else if (name) {
    parts.push(name);
  } else {
    parts.push('目标');
  }

  if (sel.index != null) {
    parts.push(`（第 ${Number(sel.index) + 1} 个）`);
  }

  const anchor = findAnchorText(sel.childOf ?? sel.containsChild);
  if (anchor) {
    return `「${anchor}」内的 ${parts.join('')}`;
  }
  return parts.join('');
}

/** @param {any} cmd @returns {[string, any]} 命令名与参数 */
function splitCommand(cmd) {
  if (typeof cmd === 'string') return [cmd, null];
  const key = Object.keys(cmd)[0];
  return [key, cmd[key]];
}

/**
 * 单条命令 → 中文；返回 null 表示不值得展示给人看。
 * @param {string} name
 * @param {any} arg
 */
function describeCommand(name, arg) {
  switch (name) {
    case 'runFlow': {
      if (typeof arg === 'string') return `执行：${subflowName(arg)}`;
      if (arg?.file) return `执行：${subflowName(arg.file)}`;
      if (arg?.when) {
        const cond = arg.when.visible ?? arg.when.notVisible;
        const verb = arg.when.visible ? '可见' : '不可见';
        return `若 ${describeSelector(cond)} ${verb}，则：`;
      }
      return '执行子流程';
    }
    case 'tapOn':
      return `点击 ${describeSelector(arg)}`;
    case 'longPressOn':
      return `长按 ${describeSelector(arg)}`;
    case 'inputText':
      return `输入「${arg}」`;
    case 'eraseText':
      return '清空输入框';
    case 'assertVisible':
      return `确认看到 ${describeSelector(arg)}`;
    case 'assertNotVisible':
      return `确认看不到 ${describeSelector(arg)}`;
    case 'extendedWaitUntil': {
      const sec = arg?.timeout ? Math.round(arg.timeout / 1000) : null;
      const tail = sec ? `（最多 ${sec} 秒）` : '';
      if (arg?.notVisible) {
        return `等待 ${describeSelector(arg.notVisible)} 消失${tail}`;
      }
      return `等待 ${describeSelector(arg?.visible)} 出现${tail}`;
    }
    case 'scrollUntilVisible':
      return `滚动直到看到 ${describeSelector(arg?.element)}`;
    case 'launchApp':
      return arg?.clearState ? '清数据后启动 App' : '启动 App';
    case 'stopApp':
      return '杀掉 App 进程';
    case 'killApp':
      return '杀掉 App 进程';
    case 'back':
      return '按返回键';
    case 'pressKey':
      return `按 ${arg} 键`;
    case 'setOrientation':
      return arg === 'PORTRAIT' ? '切成竖屏' : `切换方向：${arg}`;
    case 'swipe':
      return '滑动';
    case 'repeat':
      return `最多重复 ${arg?.times ?? '?'} 次：`;
    case 'waitForAnimationToEnd':
      return null;
    default:
      return `${name}`;
  }
}

const MAX_STEPS = 60;

/**
 * @param {any[]} commands
 * @param {number} depth
 * @param {{ text: string, depth: number }[]} out
 */
function walk(commands, depth, out) {
  for (const cmd of commands ?? []) {
    if (out.length >= MAX_STEPS) return;
    if (cmd == null) continue;

    const [name, arg] = splitCommand(cmd);
    const text = describeCommand(name, arg);
    if (text) out.push({ text, depth });

    // 嵌套结构（repeat / 条件 runFlow）缩进一层继续展开
    const nested = arg?.commands;
    if (Array.isArray(nested)) {
      walk(nested, depth + 1, out);
    }
  }
}

/**
 * 把一个 flow 的 YAML 文本翻译成中文步骤。
 *
 * @param {string} yamlText
 * @returns {{ name: string, steps: { text: string, depth: number }[] }}
 */
export function describeFlow(yamlText) {
  let docs;
  try {
    docs = parseAllDocuments(String(yamlText)).map((d) => d.toJS());
  } catch {
    return { name: '', steps: [] };
  }

  const header = docs.find((d) => d && !Array.isArray(d)) ?? {};
  const commands = docs.find((d) => Array.isArray(d)) ?? [];

  const steps = [];
  walk(commands, 0, steps);
  return { name: header.name ? String(header.name) : '', steps };
}

/**
 * 批量翻译 analyze 产出的文件，给审阅面板用。
 * @param {{ path: string, content: string }[]} files
 */
export function describeFiles(files) {
  return (files ?? []).map((f) => ({
    path: f.path,
    ...describeFlow(f.content),
  }));
}
