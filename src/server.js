import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from './http.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { importIfEmpty, syncFlowBindings } from './importer.js';
import { newToken } from './auth.js';
import { PORT, HOST, DEFAULT_MODULES } from './constants.js';
import {
  appRoot,
  regressionRoot,
  dbFile,
  manifestPath,
} from './paths.js';
import { resolveManifestPath } from './config.js';
import { createRunner, resolveMaestroBin } from './runner.js';
import { exportSnapshot } from './exporter.js';

fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const store = createStore(openDb(dbFile));
importIfEmpty(store);
syncFlowBindings(store);

// 导入默认模块（todo/routine/chore）
for (const mod of DEFAULT_MODULES) {
  try {
    store.createModule(mod);
  } catch (e) {
    // 409 = 已存在，忽略
    if (!String(e.message).includes('409')) throw e;
  }
}

const token = newToken();
const exportFn = () => exportSnapshot({ store, repoRoot: regressionRoot });
const runner = createRunner({
  store,
  appRoot,
  maestroBin: resolveMaestroBin(),
  exportFn,
  // appId/device 由清单提供，DUT manifest 就绪后从 sync 结果透传；
  // 目前清单未建，先保持空串（不注入 -e，行为与旧版一致）
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
