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

export const DEFAULT_MODULE = 'todo';

/** ai_session 中模块级功能点草稿的哨兵，不是真实 feature code。 */
export const CATALOG_FEATURE_CODE = '__catalog__';
