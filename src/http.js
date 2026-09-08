import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { tokenMiddleware } from './auth.js';
import {
  CATALOG_FEATURE_CODE,
  CHAPTER_TITLES,
  DEFAULT_MODULE,
  DEFAULT_MODULES,
  MODULES,
  STATUS,
} from './constants.js';
import { normalizeCatalogDraft } from './catalog.js';
import { assertMaestroYamlPath, diffFiles, applyFiles } from './fileGate.js';
import { exportSnapshot } from './exporter.js';
import { describeFiles } from './flowSteps.js';

/**
 * @param {unknown} err
 * @returns {number}
 */
function statusFromError(err) {
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
  res.status(status).json({ error: String(err?.message ?? err ?? 'error') });
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
 *   repoRoot: string,
 *   flowRoot?: string,
 *   token: string,
 *   runner?: ReturnType<import('./runner.js').createRunner>,
 *   exportFn?: () => void,
 * }} opts
 * @returns {import('express').Application}
 */
export function createApp({
  store,
  repoRoot,
  flowRoot,
  token,
  runner,
  exportFn,
}) {
  // 测试与旧调用默认沿用 repoRoot；生产环境显式把 flowRoot 指向控制台根。
  const flowBase = flowRoot ?? repoRoot;
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const doExport =
    exportFn ??
    (() => {
      exportSnapshot({ store, repoRoot });
    });

  const api = express.Router();
  api.use(tokenMiddleware(token));

  api.get('/modules', (_req, res) => {
    try {
      let modules = store.listModules();
      // 如果数据库中没有模块，返回硬编码的默认模块
      if (modules.length === 0) {
        modules = DEFAULT_MODULES.map((m) => ({
          module: m.id,
          title: m.title,
        }));
      }
      const result = modules.map((m) => ({
        id: m.module,
        title: m.title,
        source: DEFAULT_MODULES.some((d) => d.id === m.module) ? 'builtin' : 'custom',
      }));
      res.json({ modules: result, defaultModule: DEFAULT_MODULE });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.post('/modules', (req, res) => {
    try {
      const { id, title } = req.body ?? {};

      if (!id || typeof id !== 'string') {
        throw new Error('400: 模块 ID 必填');
      }
      if (!/^[a-z0-9-]{2,20}$/.test(id)) {
        throw new Error('400: 模块 ID 只能是小写字母/数字/连字符，长度 2-20');
      }
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        throw new Error('400: 模块标题必填');
      }
      if (title.length > 50) {
        throw new Error('400: 模块标题最多 50 字');
      }

      const mod = store.createModule({ id, title: title.trim() });
      res.json({ module: mod });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.get('/features', (req, res) => {
    try {
      const module =
        typeof req.query.module === 'string' ? req.query.module : '';
      const features = store.listFeatures(module || undefined).map((f) => {
        const latestRun = store.getLatestRun(f.code, f.module) ?? null;
        return {
          ...f,
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
      const meta = store.getModuleMeta(module || DEFAULT_MODULE);
      res.json({
        features,
        module: module || null,
        moduleNotes: meta.notes,
        chapterTitles: {
          ...(CHAPTER_TITLES[module || DEFAULT_MODULE] ?? {}),
          ...meta.chapters,
        },
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

  api.post('/features', (req, res) => {
    try {
      const module = moduleOf(req);
      const { code, chapter, title, criteria, precondition, status } =
        req.body ?? {};
      if (
        typeof code !== 'string' ||
        typeof chapter !== 'number' ||
        typeof title !== 'string' ||
        typeof criteria !== 'string'
      ) {
        throw new Error('400: code/chapter/title/criteria required');
      }
      store.upsertFeature({
        module,
        code,
        chapter,
        title,
        criteria,
        precondition: typeof precondition === 'string' ? precondition : '',
        status: typeof status === 'string' ? status : STATUS.PENDING_WRITE,
      });
      res.json({ feature: store.getFeature(code, module) });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.patch('/features/:code', (req, res) => {
    try {
      const module = moduleOf(req);
      const existing = store.getFeature(req.params.code, module);
      if (!existing) {
        throw new Error('400: feature not found');
      }
      const body = req.body ?? {};
      const next = {
        module: existing.module,
        code: existing.code,
        chapter: existing.chapter,
        title: typeof body.title === 'string' ? body.title : existing.title,
        criteria:
          typeof body.criteria === 'string' ? body.criteria : existing.criteria,
        precondition:
          typeof body.precondition === 'string'
            ? body.precondition
            : existing.precondition,
        notes: typeof body.notes === 'string' ? body.notes : existing.notes,
        status: typeof body.status === 'string' ? body.status : existing.status,
      };
      store.upsertFeature(next);
      res.json({
        feature: store.getFeature(existing.code, existing.module),
      });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.post('/export', (_req, res) => {
    try {
      doExport();
      res.json({ ok: true });
    } catch (err) {
      sendError(err, res);
    }
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
