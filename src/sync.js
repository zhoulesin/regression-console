import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.js';
import { readManifestFile } from './manifest.js';

export { AppError };

/**
 * 从被测仓的 manifest 重建本地功能点快照。
 *
 * 单向：只读 DUT、只写本仓。清单负责「有哪些功能点」，
 * status / notes / 历史 run 属于控制台，同步不碰。
 *
 * 校验阶段在事务之外完成——读盘或归一化失败时一个字节都不写，
 * 上次成功的快照原样保留（fail-closed）。
 *
 * @param {object} opts
 * @param {object} opts.store
 * @param {string} opts.appRoot 被测项目根，必填
 * @param {string} [opts.manifestPath] 相对 appRoot 的路径
 * @returns {{ appId: string, device: string, modules: number, features: number }}
 */
export function syncFromManifest({
  store,
  appRoot,
  manifestPath = 'regression.manifest.json',
}) {
  if (!appRoot) {
    throw new AppError(400, 'NO_APP_ROOT', 'appRoot required');
  }

  // 先读先校验：这一步抛错就完全不进事务
  const manifest = readManifestFile(appRoot, manifestPath);

  const moduleIds = manifest.modules.map((m) => m.id);
  const chaptersByModule = new Map();
  for (const f of manifest.features) {
    if (!f.chapterTitle) continue;
    if (!chaptersByModule.has(f.module)) chaptersByModule.set(f.module, {});
    chaptersByModule.get(f.module)[String(f.chapter)] = f.chapterTitle;
  }

  store.runSyncSnapshot(() => {
    for (const m of manifest.modules) {
      store.upsertModule({
        id: m.id,
        title: m.title,
        chapters: chaptersByModule.get(m.id) ?? {},
        hidden: 0,
      });
    }
    store.hideModulesNotIn(moduleIds);

    for (const f of manifest.features) {
      // manual 项（只能手测）不检查 yaml；其余按文件是否真实存在决定 runnable
      const runnable = f.manual
        ? 0
        : fs.existsSync(path.join(appRoot, f.flow))
          ? 1
          : 0;
      store.upsertFeature({
        module: f.module,
        code: f.code,
        chapter: f.chapter,
        title: f.title,
        criteria: f.criteria,
        precondition: f.precondition,
        manual: f.manual ? 1 : 0,
        runnable,
        hidden: 0,
      });
      // 脚本路径也归清单管：seed 与 importer 迁走后，flow 表只剩这里能写。
      // 幂等（ON CONFLICT 更新 path），重复 sync 不会堆行。
      if (f.flow) {
        store.upsertFlow({
          feature_module: f.module,
          feature_code: f.code,
          path: f.flow,
          kind: 'flow',
        });
      }
    }
    store.hideFeaturesNotIn(
      manifest.features.map((f) => ({ module: f.module, code: f.code })),
    );
  });

  return {
    appId: manifest.appId ?? '',
    device: manifest.device ?? '',
    modules: manifest.modules.length,
    features: manifest.features.length,
  };
}
