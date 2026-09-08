import { SEED_FEATURES, FLOW_BINDINGS } from './seed/index.js';

export { SEED_FEATURES, FLOW_BINDINGS } from './seed/index.js';

/**
 * 仅当 feature 表为空时导入 seed 数据与 flow 绑定。
 * @param {ReturnType<import('./store.js').createStore>} store
 * @returns {{ imported: number }}
 */
export function importIfEmpty(store) {
  if (store.listFeatures().length > 0) {
    return { imported: 0 };
  }

  for (const row of SEED_FEATURES) {
    store.upsertFeature(row);
  }

  for (const binding of FLOW_BINDINGS) {
    store.insertFlow(binding);
  }

  return { imported: SEED_FEATURES.length };
}

/**
 * 用 seed 绑定覆盖同号 flow。空库导入之后、以及已有库启动时都要跑：
 * 否则 0.2 上后写入的 retain-login 会一直盖住 kill-relaunch。
 * 不在 seed 里的功能点（AI apply 写的）不动。
 */
export function syncFlowBindings(store) {
  for (const binding of FLOW_BINDINGS) {
    store.upsertFlow(binding);
  }
}
