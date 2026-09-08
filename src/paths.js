import path from 'node:path';
import { resolveAppRoot } from './config.js';

/** 回归控制台根：Maestro 脚本、导出的功能点清单都作为控制台产物存放。 */
export const regressionRoot = path.resolve(import.meta.dirname, '..');
export const dataDir = path.resolve(import.meta.dirname, '../data');

/**
 * Android 项目根：读取源码上下文。
 *
 * 不再依赖 ../../.. 的目录层级——由 regression.config.json 的 appRoot
 * 或环境变量 REGRESSION_APP_ROOT 指定，控制台可以放在仓库外。
 */
export const appRoot = resolveAppRoot(regressionRoot);
