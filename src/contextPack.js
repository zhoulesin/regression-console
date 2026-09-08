import fs from 'node:fs';
import path from 'node:path';

/** @type {Record<string, Record<number, string[]>>} */
export const CONTEXT_FILES_BY_MODULE = {
  todo: {
    0: ['maestro/cold-launch.yaml'],
    1: ['maestro/todo/list-crud.yaml', 'maestro/todo/subflows/cleanup-fixture.yaml'],
    2: [
      'maestro/todo/item-fast-add.yaml',
      'maestro/todo/subflows/create-fixture-list.yaml',
      'app/src/main/res/layout/item_todolist.xml',
    ],
    3: ['maestro/todo/display-modes.yaml'],
    4: ['maestro/todo/display-modes.yaml'],
    5: [],
  },
  routine: {},
  chore: {},
};

/** @deprecated 用 CONTEXT_FILES_BY_MODULE.todo */
export const CONTEXT_FILES_BY_CHAPTER = CONTEXT_FILES_BY_MODULE.todo;

export const IRON_RULES = `铁律（必须遵守）：
1. 禁止用 rightOf/below/leftOf 定位操作目标；它们只比较屏幕坐标，不含行内或层级约束。操作目标须绑定到行容器（childOf/containsChild）。
2. above/below 仅用于顺序断言（判断谁在谁上面/下面），不得用于 tap 定位。
3. 写入前 fail-closed 断言对象正确：编辑类操作在输入前先 assertVisible 目标正确，不符就失败、不写数据。
4. 一个 flow 只做一件事；不要把多个独立场景塞进同一 flow。
5. 不要用 runFlow 的 env 传参：子流程 header 里的默认值会胜出，会导致重复创建等问题。
6. 第 1/2 章不要点 Display/Filter。
7. 夹具命名：List 用 E2E Todo*（如 E2E Todo、E2E Todo A/B、E2E Todo Edited）；Todo 用 E2E_ 前缀。
8. 通过 = 判定依据在指定容器里可观察。禁止只 tap 确认就算过；禁止只 assertVisible 一段全屏文字（任意一处出现都算绿）。结果必须 childOf/containsChild 绑回判定依据指定的那一行/那张卡。杀进程、编辑、删除是别的功能点，本 flow 不做。
9. 脚本必须短：不要 stopApp/kill（除非本功能点就是杀进程）；cleanup-fixture 只放开头，结尾不要再 cleanup，也不要 assertNotVisible 全屏 E2E 正则；create-fixture-list 不要再 runFlow open-todo；结果等待 timeout ≤5000，冷启动或横滑 ≤8000。
10. timeout 只能写在 extendedWaitUntil / scrollUntilVisible 上：写进选择器（visible / notVisible 内部）或 tapOn 会报 Unknown Property: timeout。可能不存在的控件不要用 optional: true（找不到仍会空等默认约 12s），改用 runFlow + when.visible 包一层，条件不命中立刻跳过。`;

const MAX_LINES = 200;

/**
 * @param {string} appRoot
 * @param {{ module?: string, chapter?: number }} feature
 * @param {string} [flowRoot]
 * @returns {string}
 */
export function buildContext(appRoot, feature, flowRoot = appRoot) {
  const moduleId = feature.module || 'todo';
  const chapter = feature.chapter ?? 0;
  const paths = CONTEXT_FILES_BY_MODULE[moduleId]?.[chapter] ?? [];
  const sections = [];

  for (const rel of paths) {
    // Maestro 属于 regression-console；Android 源码仍从 App 根读取。
    const root = rel.startsWith('maestro/') ? flowRoot : appRoot;
    const abs = path.join(root, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue;

    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n');
    const truncated = lines.slice(0, MAX_LINES).join('\n');
    const suffix = lines.length > MAX_LINES ? '\n... (truncated)' : '';
    sections.push(`--- ${rel} ---\n${truncated}${suffix}`);
  }

  if (sections.length === 0) return '参考文件：无';
  return ['参考文件：', ...sections].join('\n\n');
}

/** chores 的默认源码目录；其他项目在 regression.config.json 里用 sourceDirs 覆盖。 */
export const CATALOG_SOURCE_DIRS = {
  todo: ['app/src/main/java/com/cozyla/choresreward/ui/todo'],
  routine: ['app/src/main/java/com/cozyla/choresreward/ui/routine'],
  chore: [
    'app/src/main/java/com/cozyla/choresreward/ui/chorelist',
    'app/src/main/java/com/cozyla/choresreward/ui/createchore',
    'app/src/main/java/com/cozyla/choresreward/ui/modifychore',
  ],
};

/**
 * catalog 没有单一 chapter：把已登记参考文件取并集，并给 Claude 一份窄目录文件清单，
 * 让它用 Read 精确补洞，不允许自己全仓搜索。
 *
 * @param {Record<string, string[]>} [sourceDirs] 覆盖默认源码目录（换项目时必填）
 */
export function buildCatalogContext(
  appRoot,
  moduleId,
  flowRoot = appRoot,
  sourceDirs = CATALOG_SOURCE_DIRS,
) {
  const registered = [
    ...new Set(
      Object.values(CONTEXT_FILES_BY_MODULE[moduleId] ?? {}).flat(),
    ),
  ];
  const sections = [];
  for (const rel of registered) {
    const root = rel.startsWith('maestro/') ? flowRoot : appRoot;
    const abs = path.join(root, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    sections.push(`--- ${rel} ---\n${lines.slice(0, MAX_LINES).join('\n')}`);
  }

  const candidates = [];
  for (const relDir of sourceDirs[moduleId] ?? []) {
    const absDir = path.join(appRoot, ...relDir.split('/'));
    if (!fs.existsSync(absDir)) continue;
    const stack = [absDir];
    while (stack.length && candidates.length < 120) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(abs);
        else if (/\.(kt|xml)$/.test(entry.name)) {
          candidates.push(path.relative(appRoot, abs));
        }
      }
    }
  }
  const layoutDir = path.join(appRoot, 'app/src/main/res/layout');
  if (fs.existsSync(layoutDir)) {
    const needle = moduleId === 'chore' ? 'chore' : moduleId;
    for (const name of fs.readdirSync(layoutDir)) {
      if (name.endsWith('.xml') && name.toLowerCase().includes(needle)) {
        candidates.push(`app/src/main/res/layout/${name}`);
      }
    }
  }

  return [
    sections.length ? ['预装参考内容：', ...sections].join('\n\n') : '',
    `允许按需 Read 的候选文件（只从这里挑，不要全仓搜索）：\n${[
      ...new Set(candidates),
    ]
      .slice(0, 150)
      .join('\n') || '无；只能基于预装参考内容，存疑点写进 rationale'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 诊断结论太长会淹掉参考文件，截断 */
const MAX_DIAGNOSIS_CHARS = 4000;

/**
 * 上一轮为什么失败 —— 回流给生成脚本的 prompt，避免重复写出同一个错选择器。
 *
 * 这是闭环的关键：没有这一段，诊断完再生成等于从零重来。
 *
 * @param {{
 *   run?: { failed_step?: string|null, log_excerpt?: string|null } | null,
 *   diagnosis?: { response?: string|null } | null,
 * }} opts
 * @returns {string} 无历史时返回空串
 */
export function buildRetrySection({ run, diagnosis }) {
  const failedStep = run?.failed_step || null;
  const text = diagnosis?.response || null;
  if (!failedStep && !text) return '';

  const parts = ['上一轮尝试失败了，这次必须避开同样的错：'];
  if (failedStep) {
    parts.push(`失败步骤：${failedStep}`);
  }
  if (text) {
    parts.push(`已有诊断结论：\n${text.slice(0, MAX_DIAGNOSIS_CHARS)}`);
  }
  parts.push(
    '要求：针对上面的根因给出修正后的完整文件；不要重复上一轮已被证明错误的选择器或断言。',
  );
  return parts.join('\n\n');
}
