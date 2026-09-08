import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { tokenMiddleware } from './auth.js';
import { DEFAULT_MODULE } from './constants.js';
import { AppError, syncFromManifest } from './sync.js';

/**
 * @param {unknown} err
 * @returns {number}
 */
function statusFromError(err) {
  if (err instanceof AppError) return err.httpStatus;
  const msg = String(err?.message ?? err ?? '');
  for (const code of [401, 400, 404, 409, 422]) {
    if (msg.includes(String(code))) return code;
  }
  return 500;
}

/**
 * @param {unknown} err
 * @param {import('express').Response} res
 */
function sendError(err, res) {
  const status = statusFromError(err);
  const payload = { error: String(err?.message ?? err ?? 'error') };
  // 前端要区分 FEATURE_MANUAL / FLOW_MISSING / RUN_ACTIVE 等具体原因
  if (err instanceof AppError || typeof err?.code === 'string') {
    payload.code = err.code;
  }
  res.status(status).json(payload);
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function moduleOf(req) {
  const q = req.query?.module;
  if (typeof q === 'string' && q) return q;
  const b = req.body?.module;
  if (typeof b === 'string' && b) return b;
  return DEFAULT_MODULE;
}

/**
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   appRoot: string | null,
 *   manifestPath?: string,
 *   token: string,
 *   runner?: ReturnType<import('./runner.js').createRunner>,
 * }} opts
 * @returns {import('express').Application}
 */
export function createApp({ store, appRoot, manifestPath, token, runner }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();
  api.use(tokenMiddleware(token));

  api.get('/modules', (_req, res) => {
    try {
      // 模块目录只来自清单同步，不再有内置 fallback
      const result = store.listModules().map((m) => ({
        id: m.module,
        title: m.title,
        source: 'manifest',
      }));
      res.json({ modules: result, defaultModule: DEFAULT_MODULE });
    } catch (err) {
      sendError(err, res);
    }
  });

  // 清单才是真源：目录类写接口全部冻结成 410
  api.post('/modules', (_req, res) => {
    res.status(410).json({ error: '410: gone', code: 'GONE' });
  });

  api.get('/features', (req, res) => {
    try {
      const module =
        typeof req.query.module === 'string' ? req.query.module : '';
      if (!module) {
        throw new AppError(
          400,
          'FEATURE_MODULE_REQUIRED',
          'module 查询参数必填',
        );
      }
      const features = store.listFeatures(module).map((f) => {
        const latestRun = store.getLatestRun(f.code, f.module) ?? null;
        return {
          ...f,
          runnable: Boolean(f.runnable),
          manual: Boolean(f.manual),
          hidden: undefined,
          pendingSession: store.getPendingSession(f.code, f.module) ?? null,
          latestDiagnosis: store.getLatestDiagnosis(f.code, f.module) ?? null,
          diagnosisHistory:
            latestRun && latestRun.exit_code !== 0
              ? store.listDiagnosesForRun(latestRun.id, 5)
              : [],
          flows: store.listFlows(f.code, f.module),
          attempts: store.listAttempts(f.code, f.module),
        };
      });
      const meta = store.getModuleMeta(module);
      res.json({
        features,
        module,
        moduleNotes: meta.notes,
        chapterTitles: meta.chapters,
      });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.get('/attempts/:id', (req, res) => {
    try {
      const attemptId = Number(req.params.id);
      if (!Number.isFinite(attemptId)) {
        throw new Error('400: attempt id required');
      }
      const attempt = store.getAttemptDetail(attemptId);
      if (!attempt || attempt.feature_module !== moduleOf(req)) {
        throw new Error('404: attempt not found');
      }
      res.json({ attempt });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.post('/features', (_req, res) => {
    res.status(410).json({ error: '410: gone', code: 'GONE' });
  });

  api.patch('/features/:code', (_req, res) => {
    res.status(410).json({ error: '410: gone', code: 'GONE' });
  });

  // 清单同步：DUT -> 控制台的唯一入口
  api.post('/sync', (_req, res) => {
    try {
      // 清单变更会让正在执行的 flow 路径失效，活跃 run 期间拒绝
      if (store.getActiveRun()) {
        throw new AppError(409, 'RUN_ACTIVE', 'a run is active');
      }
      const result = syncFromManifest({ store, appRoot, manifestPath });
      res.json({ ok: true, ...result });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.post('/export', (_req, res) => {
    res.status(410).json({ error: '410: gone', code: 'GONE' });
  });

  if (runner) {
    api.post('/flows/:id/run', (req, res) => {
      try {
        const flowId = Number(req.params.id);
        if (!Number.isFinite(flowId)) {
          throw new Error('400: flow id required');
        }
        let featureCode = null;
        let featureModule = DEFAULT_MODULE;
        for (const f of store.listFeatures()) {
          const hit = store
            .listFlows(f.code, f.module)
            .find((x) => x.id === flowId);
          if (hit) {
            featureCode = hit.feature_code;
            featureModule = hit.feature_module || f.module;
            break;
          }
        }
        if (!featureCode) {
          throw new Error('400: flow not found');
        }
        const run = runner.start(featureCode, featureModule);
        res.json({ run });
      } catch (err) {
        sendError(err, res);
      }
    });

    api.post('/runs/abort', (_req, res) => {
      try {
        runner.abort();
        res.json({ ok: true });
      } catch (err) {
        sendError(err, res);
      }
    });

    api.get('/runs/:id/stream', (req, res) => {
      try {
        const runId = Number(req.params.id);
        if (!Number.isFinite(runId)) {
          throw new Error('400: run id required');
        }
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }

        for (const chunk of runner.getLogs(runId)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        const unsub = runner.subscribe(runId, (chunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });
        req.on('close', () => {
          unsub();
        });
      } catch (err) {
        sendError(err, res);
      }
    });
  }

  app.use('/api', api);

  const distDir = path.resolve(import.meta.dirname, '../web/dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  return app;
}
