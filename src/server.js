import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createApp } from './http.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { importIfEmpty, syncFlowBindings } from './importer.js';
import { newToken } from './auth.js';
import { PORT, HOST } from './constants.js';
import { appRoot, regressionRoot, dataDir } from './paths.js';
import { loadConfig } from './config.js';
import {
  analyzeWithClaude,
  catalogWithClaude,
  diagnoseWithClaude,
} from './claudeProvider.js';
import { createAnalyzeHub } from './analyzeHub.js';
import { createRunner, resolveMaestroBin } from './runner.js';
import { exportSnapshot } from './exporter.js';

fs.mkdirSync(dataDir, { recursive: true });
const config = loadConfig(regressionRoot);

const store = createStore(openDb(dataDir + '/console.db'));
importIfEmpty(store);
syncFlowBindings(store);
const token = newToken();
const exportFn = () => exportSnapshot({ store, repoRoot: regressionRoot });
const runner = createRunner({
  store,
  repoRoot: regressionRoot,
  maestroBin: resolveMaestroBin(),
  exportFn,
});
const analyzeHub = createAnalyzeHub();
const app = createApp({
  store,
  repoRoot: appRoot,
  flowRoot: regressionRoot,
  token,
  runner,
  analyzeHub,
  analyzeFn: ({ feature, priorRun, priorDiagnosis }) =>
    analyzeWithClaude({
      appRoot,
      flowRoot: regressionRoot,
      feature,
      priorRun,
      priorDiagnosis,
      onData: (chunk) => analyzeHub.push(chunk),
      registerChild: (child) => analyzeHub.setChild(child),
    }),
  catalogFn: ({ module, hint, moduleNotes, existingFeatures }) =>
    catalogWithClaude({
      appRoot,
      flowRoot: regressionRoot,
      module,
      hint,
      moduleNotes,
      existingFeatures,
      sourceDirs: config.sourceDirs,
      onData: (chunk) => analyzeHub.push(chunk),
      registerChild: (child) => analyzeHub.setChild(child),
    }),
  diagnoseFn: ({ feature, run, flowPath, history, hint }) =>
    diagnoseWithClaude({
      flowRoot: regressionRoot,
      feature,
      run,
      flowPath,
      history,
      hint,
      onData: (chunk) => analyzeHub.push(chunk),
      registerChild: (child) => analyzeHub.setChild(child),
    }),
  exportFn,
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
