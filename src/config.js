import fs from 'node:fs';
import path from 'node:path';

/**
 * 被测 Android 项目的位置不再由目录层级推导，改为外部配置。
 *
 * 控制台可以放在任何地方（chores 仓库内 / 独立仓库 / 别的磁盘），
 * 只要把 appRoot 指过去即可。
 *
 * 优先级：环境变量 REGRESSION_APP_ROOT > regression.config.json > 默认（仓库内 tools/ 布局）
 *
 * @param {string} regressionRoot 控制台根（配置文件放在这里）
 */
export function loadConfig(regressionRoot) {
  const file = path.join(regressionRoot, 'regression.config.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // 配置文件坏了不该让整个控制台起不来，退回默认
    return {};
  }
}

/**
 * @param {string} regressionRoot
 * @returns {string} 绝对路径
 */
export function resolveAppRoot(regressionRoot) {
  const config = loadConfig(regressionRoot);
  // 默认：控制台位于 <项目>/tools/ 下，从控制台根上两级回到项目根。
  // （旧实现从 src/ 出发用 '../../..'，层级一样，换成控制台根后是 '../..'）
  const raw = process.env.REGRESSION_APP_ROOT || config.appRoot || '../..';
  return path.isAbsolute(raw) ? raw : path.resolve(regressionRoot, raw);
}
