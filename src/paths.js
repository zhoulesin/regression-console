import path from 'node:path';
import { resolveAppRoot, resolveDbPath } from './config.js';

/** 回归控制台根：Maestro 脚本、导出的功能点清单都作为控制台产物存放。 */
export const regressionRoot = path.resolve(import.meta.dirname, '..');
export const dataDir = path.resolve(import.meta.dirname, '../data');

/**
 * Android 项目根：读取源码上下文。**未配置时为 `null`** —— 不再回退目录层级，
 * 由 regression.config.json 的 appRoot 或环境变量 REGRESSION_APP_ROOT 指定。
 */
export const appRoot = resolveAppRoot(regressionRoot);

/**
 * SQLite 文件位置。默认 `data/console.db`，可由 regression.config.json 的
 * dbPath 或环境变量 REGRESSION_DB_PATH 改到别处（将来按项目分库用）。
 */
export const dbFile = resolveDbPath(regressionRoot);
