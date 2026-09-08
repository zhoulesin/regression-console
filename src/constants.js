export const PORT = 4780;
export const HOST = '127.0.0.1';

export const STATUS = {
  PENDING_WRITE: '待写',
  PENDING_RUN: '待执行',
  RUNNING: '运行中',
  PASSED: '通过',
  FAILED: '失败',
  MANUAL: '留手测',
  FALSE_GREEN: '假绿',
};

/** 业务模块：看板顶栏切换；章节号只在模块内有效 */
export const MODULES = [
  { id: 'todo', title: 'Todo' },
  { id: 'routine', title: 'Routine' },
  { id: 'chore', title: 'Chore' },
];

export const DEFAULT_MODULE = 'todo';

/** ai_session 中模块级功能点草稿的哨兵，不是真实 feature code。 */
export const CATALOG_FEATURE_CODE = '__catalog__';

/** @type {Record<string, Record<number, string>>} */
export const CHAPTER_TITLES = {
  todo: {
    0: 'App 级冒烟',
    1: 'todo-list',
    2: '单 List 内的 Todo',
    3: 'Display 排序',
    4: '完成态',
    5: 'Filter',
  },
  routine: {},
  chore: {},
};

/** @deprecated 兼容旧导出；请用 CHAPTER_TITLES.todo */
export const CHAPTER_TITLES_FLAT = CHAPTER_TITLES.todo;
