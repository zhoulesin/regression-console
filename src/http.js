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
 * 占用全局 AI 槽。失败抛 409。返回值必须在 finally 里调用（abort 已 release 时再调也安全）。
 * @param {ReturnType<import('./analyzeHub.js').createAnalyzeHub> | undefined} hub
 * @param {string} kind
 * @returns {() => void}
 */
function occupyAiHub(hub, kind) {
  if (!hub) return () => {};
  const ticket = hub.tryBegin(kind);
  if (!ticket) {
    const slot = hub.status();
    throw new Error(`409: AI 正在运行（${slot.kind || 'unknown'}）`);
  }
  return () => hub.release(ticket);
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

function regressionNoteOf(req) {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length > 2000) {
    throw new Error('400: 回归备注最多 2000 字');
  }
  return note;
}

/**
 * @param {{ path: string, content: string }[]} files
 * @param {string} repoRoot
 */
function assertAnalyzeFiles(files, repoRoot) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('422: files must be a non-empty array');
  }
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.content !== 'string'
    ) {
      throw new Error('422: each file must have path and content');
    }
    try {
      assertMaestroYamlPath(repoRoot, file.path);
    } catch {
      throw new Error('422: invalid file path');
    }
  }
}

/**
 * @param {{
 *   store: ReturnType<import('./store.js').createStore>,
 *   repoRoot: string,
 *   flowRoot?: string,
 *   token: string,
 *   analyzeFn: (opts: { repoRoot: string, feature: object }) => Promise<{
 *     rationale: string,
 *     risks: string[],
 *     files: { path: string, content: string }[],
 *     raw: string,
 *     prompt: string,
 *   }>,
 *   diagnoseFn?: (opts: { feature: object, run: object, flowPath: string|null, history: object[], hint: string }) => Promise<{ text: string, prompt?: string }>,
 *   catalogFn?: (opts: { repoRoot: string, flowRoot: string, module: string, hint: string, moduleNotes: string, existingFeatures: object[] }) => Promise<{ rationale: string, features: object[], skipped?: object[], prompt?: string }>,
 *   runner?: ReturnType<import('./runner.js').createRunner>,
 *   exportFn?: () => void,
 *   analyzeHub?: ReturnType<import('./analyzeHub.js').createAnalyzeHub>,
 * }} opts
 * @returns {import('express').Application}
 */
export function createApp({
  store,
  repoRoot,
  flowRoot,
  token,
  analyzeFn,
  diagnoseFn,
  catalogFn,
  runner,
  exportFn,
  analyzeHub,
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

  if (catalogFn) {
    api.get('/catalog/pending', (req, res) => {
      try {
        const module = moduleOf(req);
        const session = store.getPendingCatalog(module) ?? null;
        res.json({
          session,
          draft: session ? JSON.parse(session.response) : null,
        });
      } catch (err) {
        sendError(err, res);
      }
    });

    api.post('/catalog/propose', async (req, res) => {
      let releaseHub = () => {};
      try {
        const module = moduleOf(req);
        const hint =
          typeof req.body?.hint === 'string' ? req.body.hint.trim() : '';
        if (!hint) throw new Error('400: 生成功能点的范围提示必填');
        if (hint.length > 2000) {
          throw new Error('400: 范围提示最多 2000 字');
        }
        if (store.getPendingCatalog(module)) {
          throw new Error('409: 请先确认或打回当前功能点草稿');
        }

        releaseHub = occupyAiHub(analyzeHub, 'catalog');
        analyzeHub?.push(`[catalog] ${module}：${hint}\n`);
        const existingFeatures = store.listFeatures(module);
        const meta = store.getModuleMeta(module);
        const rawDraft = await catalogFn({
          repoRoot,
          flowRoot: flowBase,
          module,
          hint,
          moduleNotes: meta.notes,
          existingFeatures,
        });
        const draft = normalizeCatalogDraft(rawDraft, existingFeatures);
        analyzeHub?.push(
          `\n[catalog] 完成：${draft.features.length} 条待确认，${draft.skipped.length} 条跳过\n`,
        );
        const session = store.createAiSession({
          feature_module: module,
          feature_code: CATALOG_FEATURE_CODE,
          provider: 'claude',
          kind: 'catalog',
          prompt: rawDraft.prompt ?? '',
          response: JSON.stringify(draft),
          diff: '',
          decision: 'pending',
          user_hint: hint,
        });
        res.json({ session, draft });
      } catch (err) {
        sendError(err, res);
      } finally {
        releaseHub();
      }
    });

    api.post('/catalog/apply', (req, res) => {
      try {
        const sessionId = Number(req.body?.sessionId);
        if (!Number.isFinite(sessionId)) {
          throw new Error('400: sessionId required');
        }
        res.json(store.applyCatalog(sessionId, moduleOf(req)));
      } catch (err) {
        sendError(err, res);
      }
    });

    api.post('/catalog/reject', (req, res) => {
      try {
        const module = moduleOf(req);
        const sessionId = Number(req.body?.sessionId);
        if (!Number.isFinite(sessionId)) {
          throw new Error('400: sessionId required');
        }
        const pending = store.getPendingCatalog(module);
        if (!pending || pending.id !== sessionId) {
          throw new Error('409: pending catalog session required');
        }
        const note =
          typeof req.body?.note === 'string' ? req.body.note.trim() : '';
        store.appendModuleNote(module, note);
        store.decideSession(sessionId, 'rejected');
        res.json({ ok: true });
      } catch (err) {
        sendError(err, res);
      }
    });
  }

  api.post('/features/:code/analyze', async (req, res) => {
    let releaseHub = () => {};
    try {
      const module = moduleOf(req);
      const code = req.params.code;
      let feature = store.getFeature(code, module);
      if (!feature) {
        throw new Error('400: feature not found');
      }
      const note = regressionNoteOf(req);
      if (note) {
        store.appendRegressionNote(code, module, note);
        feature = store.getFeature(code, module);
      }

      releaseHub = occupyAiHub(analyzeHub, 'analyze');
      analyzeHub?.push(`[analyze] ${feature.module}/${code} ${feature.title}\n`);
      // 若上一轮失败过且已诊断，把结论回流进 prompt，避免重复同一个错
      const priorRun = store.getLatestRun(code, feature.module);
      const priorDiagnosis = store.getLatestDiagnosis(code, feature.module);
      const carriesDiagnosis = Boolean(
        priorDiagnosis &&
          priorRun &&
          priorRun.exit_code !== 0 &&
          priorDiagnosis.run_id === priorRun.id,
      );
      if (carriesDiagnosis) {
        analyzeHub?.push('[analyze] 已带入上一次失败诊断结论\n');
      }
      const currentAttempt = store.getCurrentAttempt(code, feature.module);
      const attempt =
        currentAttempt && !currentAttempt.analyze_session_id
          ? currentAttempt
          : store.createAttempt(
              code,
              feature.module,
              carriesDiagnosis ? priorDiagnosis.user_hint : '',
            );

      const result = await analyzeFn({
        repoRoot,
        feature,
        priorRun: priorRun && priorRun.exit_code !== 0 ? priorRun : null,
        priorDiagnosis: carriesDiagnosis ? priorDiagnosis : null,
      });
      analyzeHub?.push('\n[analyze] Claude 输出结束，进入 FileGate 校验\n');
      assertAnalyzeFiles(result.files, flowBase);

      const normalized = result.files.map((f) => ({
        path: assertMaestroYamlPath(flowBase, f.path),
        content: f.content,
      }));
      const diff = diffFiles(flowBase, normalized);
      // 中文步骤由 YAML 机器翻译得出，人工只审步骤、不读代码
      const steps = describeFiles(normalized);
      const response = JSON.stringify({
        rationale: result.rationale,
        risks: result.risks,
        files: normalized,
        steps,
      });

      const session = store.createAiSession({
        feature_module: feature.module,
        feature_code: code,
        provider: 'claude',
        prompt: result.prompt ?? '',
        response,
        diff,
        attempt_id: attempt.id,
      });
      const reviewingAttempt = store.setAttemptAnalyzeSession(
        attempt.id,
        session.id,
      );

      res.json({
        session,
        attempt: reviewingAttempt,
        rationale: result.rationale,
        risks: result.risks,
        files: normalized,
        steps,
        carriesDiagnosis,
      });
    } catch (err) {
      sendError(err, res);
    } finally {
      releaseHub();
    }
  });

  // 失败诊断：只读产物 + 只出文字，不产 Diff、不写盘、不动状态机
  if (diagnoseFn) {
    api.post('/features/:code/diagnose', async (req, res) => {
      let releaseHub = () => {};
      try {
        const hint =
          typeof req.body?.hint === 'string' ? req.body.hint.trim() : '';
        if (hint.length > 2000) {
          throw new Error('400: 补充线索最多 2000 字');
        }
        const saveAsFeatureNote = req.body?.saveAsFeatureNote === true;
        const module = moduleOf(req);
        const code = req.params.code;
        const feature = store.getFeature(code, module);
        if (!feature) {
          throw new Error('400: feature not found');
        }
        const run = store.getLatestRun(code, feature.module);
        if (!run) {
          throw new Error('400: 该功能点还没有 run 记录');
        }
        if (run.exit_code === 0) {
          throw new Error('409: 最近一次 run 是成功的，无需诊断');
        }

        const flows = store.listFlows(code, feature.module);
        const flow = flows.find((f) => f.kind === 'flow');
        const history = store.listDiagnosesForRun(run.id, 5);

        releaseHub = occupyAiHub(analyzeHub, 'diagnose');
        analyzeHub?.push(
          `[diagnose] ${feature.module}/${code} run#${run.id} 失败步骤：${run.failed_step ?? '未解析'}\n`,
        );
        const result = await diagnoseFn({
          feature,
          run,
          flowPath: flow?.path ?? null,
          history,
          hint,
        });
        analyzeHub?.push('\n[diagnose] 完成\n');

        // decision=recorded：诊断只是记录，不进人工批准队列、不阻塞执行
        const session = store.createAiSession({
          feature_module: feature.module,
          feature_code: code,
          provider: 'claude',
          kind: 'diagnose',
          prompt: result.prompt ?? '',
          response: result.text,
          diff: '',
          decision: 'recorded',
          run_id: run.id,
          attempt_id: run.attempt_id,
          user_hint: hint,
        });
        if (saveAsFeatureNote && hint) {
          store.appendFeatureNote(code, feature.module, hint);
        }

        res.json({ runId: run.id, text: result.text, session });
      } catch (err) {
        sendError(err, res);
      } finally {
        releaseHub();
      }
    });
  }

  api.post('/features/:code/apply', (req, res) => {
    try {
      const module = moduleOf(req);
      const code = req.params.code;
      const feature = store.getFeature(code, module);
      if (!feature) {
        throw new Error('400: feature not found');
      }

      const sessionId = Number(req.body?.sessionId);
      if (!Number.isFinite(sessionId)) {
        throw new Error('400: sessionId required');
      }

      const pending = store.getPendingSession(code, feature.module);
      if (!pending || pending.id !== sessionId) {
        throw new Error('409: pending session must match code and sessionId');
      }

      let files;
      if (Array.isArray(req.body?.editedFiles)) {
        files = req.body.editedFiles;
      } else {
        const parsed = JSON.parse(pending.response);
        files = parsed.files;
      }
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('400: files required');
      }

      const { applied } = applyFiles(flowBase, files);
      store.decideSession(sessionId, 'approved');
      if (pending.attempt_id) {
        store.setAttemptStatus(pending.attempt_id, 'open');
      }
      for (const p of applied) {
        store.upsertFlow({
          feature_module: feature.module,
          feature_code: code,
          path: p,
          kind: 'flow',
        });
      }
      store.setStatus(code, STATUS.PENDING_RUN, feature.module);
      doExport();

      res.json({
        applied,
        feature: store.getFeature(code, feature.module),
      });
    } catch (err) {
      sendError(err, res);
    }
  });

  api.post('/features/:code/reject', (req, res) => {
    try {
      const module = moduleOf(req);
      const code = req.params.code;
      const sessionId = Number(req.body?.sessionId);
      if (!Number.isFinite(sessionId)) {
        throw new Error('400: sessionId required');
      }

      const pending = store.getPendingSession(code, module);
      if (!pending || pending.id !== sessionId) {
        throw new Error('409: pending session must match code and sessionId');
      }

      const note = regressionNoteOf(req);
      if (note) {
        store.appendRegressionNote(code, module, note);
      }
      store.decideSession(sessionId, 'rejected');
      if (pending.attempt_id) {
        store.setAttemptStatus(pending.attempt_id, 'rejected', true);
      }
      res.json({ sessionId, decision: 'rejected' });
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

  if (analyzeHub) {
    // 当前一轮 Claude 分析的实时输出（全局单槽；先回放缓存再订阅增量）
    api.get('/analyze/stream', (req, res) => {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      for (const chunk of analyzeHub.getLogs()) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      const unsub = analyzeHub.subscribe((chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
      req.on('close', () => {
        unsub();
      });
    });

    api.get('/analyze/status', (_req, res) => {
      res.json(analyzeHub.status());
    });

    api.post('/analyze/abort', (_req, res) => {
      try {
        const killed = analyzeHub.abort();
        res.json({ ok: true, killed });
      } catch (err) {
        sendError(err, res);
      }
    });
  }

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
