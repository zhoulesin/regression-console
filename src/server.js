import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from './http.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { newToken } from './auth.js';
import { PORT, HOST } from './constants.js';
import {
  appRoot,
  regressionRoot,
  dbFile,
  manifestPath,
} from './paths.js';
import { createRunner, resolveMaestroBin } from './runner.js';
import { exportSnapshot } from './exporter.js';
import { syncFromManifest } from './sync.js';

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const store = createStore(openDb(dbFile));

// 功能点清单的真源在被测仓：启动时同步一次，失败保留上次快照（fail-closed）
if (appRoot) {
  try {
    const r = syncFromManifest({ store, appRoot, manifestPath });
    console.log(
      `manifest 同步完成：${r.modules} 个模块 / ${r.features} 条功能点`,
    );
  } catch (e) {
    console.error(`manifest 同步失败（保留上次快照）：${String(e.message || e)}`);
  }
} else {
  console.error('未配置 appRoot，跳过 manifest 同步。请在 regression.config.json 配置。');
}

const token = newToken();
const exportFn = () => exportSnapshot({ store, repoRoot: regressionRoot });
const runner = createRunner({
  store,
  appRoot,
  maestroBin: resolveMaestroBin(),
  exportFn,
  // appId/device 由清单提供，DUT manifest 就绪后从 sync 结果透传；
  // 目前保持空串（不注入 -e，行为与旧版一致）
  appId: '',
  device: '',
});
const app = createApp({
  store,
  appRoot,
  manifestPath,
  token,
  runner,
});
const server = http.createServer(app);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('port 4780 in use');
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/?token=${token}`;
  console.log(url);
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
