import {
  CATALOG_FEATURE_CODE,
  DEFAULT_MODULE,
  STATUS,
} from './constants.js';

/**
 * @param {import('better-sqlite3').Database} db
 */
export function createStore(db) {
  const listAllStmt = db.prepare(
    'SELECT * FROM feature WHERE hidden = 0 ORDER BY module, chapter, code',
  );
  const listByModuleStmt = db.prepare(
    'SELECT * FROM feature WHERE module = ? AND hidden = 0 ORDER BY chapter, code',
  );
  const listFeaturesHiddenStmt = db.prepare(
    'SELECT * FROM feature WHERE module = ? ORDER BY chapter, code',
  );
  const getFeatureStmt = db.prepare(
    'SELECT * FROM feature WHERE module = ? AND code = ?',
  );
  // status 属于控制台的执行结果，sync 不允许覆盖；notes 同理，仅在显式传入时更新
  const upsertFeatureStmt = db.prepare(`
    INSERT INTO feature (module, code, chapter, title, criteria, precondition, status, notes, updated_at, hidden, runnable, manual)
    VALUES (@module, @code, @chapter, @title, @criteria, @precondition, @status, @notes, @updated_at, @hidden, @runnable, @manual)
    ON CONFLICT(module, code) DO UPDATE SET
      chapter = excluded.chapter,
      title = excluded.title,
      criteria = excluded.criteria,
      precondition = excluded.precondition,
      hidden = excluded.hidden,
      runnable = excluded.runnable,
      manual = excluded.manual,
      updated_at = excluded.updated_at
  `);
  const upsertFeatureNotesStmt = db.prepare(`
    INSERT INTO feature (module, code, chapter, title, criteria, precondition, status, notes, updated_at, hidden, runnable, manual)
    VALUES (@module, @code, @chapter, @title, @criteria, @precondition, @status, @notes, @updated_at, @hidden, @runnable, @manual)
    ON CONFLICT(module, code) DO UPDATE SET
      chapter = excluded.chapter,
      title = excluded.title,
      criteria = excluded.criteria,
      precondition = excluded.precondition,
      notes = excluded.notes,
      hidden = excluded.hidden,
      runnable = excluded.runnable,
      manual = excluded.manual,
      updated_at = excluded.updated_at
  `);
  const setStatusStmt = db.prepare(
    'UPDATE feature SET status = ?, updated_at = ? WHERE module = ? AND code = ?',
  );
  const setFeatureNotesStmt = db.prepare(
    'UPDATE feature SET notes = ?, updated_at = ? WHERE module = ? AND code = ?',
  );
  const setFeatureHiddenStmt = db.prepare(
    'UPDATE feature SET hidden = ?, updated_at = ? WHERE module = ? AND code = ?',
  );
  const listFlowsStmt = db.prepare(
    'SELECT * FROM flow WHERE feature_module = ? AND feature_code = ? ORDER BY id',
  );
  const upsertFlowStmt = db.prepare(`
    INSERT INTO flow (feature_module, feature_code, path, kind, updated_at)
    VALUES (@feature_module, @feature_code, @path, @kind, @updated_at)
    ON CONFLICT(feature_module, feature_code, kind) DO UPDATE SET
      path = excluded.path,
      updated_at = excluded.updated_at
  `);
  const getActiveRunStmt = db.prepare(
    'SELECT * FROM run WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1',
  );
  const insertRunStmt = db.prepare(`
    INSERT INTO run (flow_id, attempt_id, started_at)
    VALUES (@flow_id, @attempt_id, @started_at)
  `);
  const getRunStmt = db.prepare('SELECT * FROM run WHERE id = ?');
  const latestRunStmt = db.prepare(`
    SELECT run.* FROM run
    JOIN flow ON flow.id = run.flow_id
    WHERE flow.feature_module = ? AND flow.feature_code = ?
    ORDER BY run.id DESC LIMIT 1
  `);
  const finishRunStmt = db.prepare(`
    UPDATE run SET
      ended_at = @ended_at,
      duration_ms = @duration_ms,
      exit_code = @exit_code,
      failed_step = @failed_step,
      artifact_dir = @artifact_dir,
      log_excerpt = @log_excerpt
    WHERE id = @id
  `);
  // 只有 kind='analyze' 的待批准会话才阻塞执行；诊断记录不参与门禁
  const getPendingSessionStmt = db.prepare(`
    SELECT * FROM ai_session
    WHERE feature_module = ? AND feature_code = ?
      AND decision = 'pending' AND kind = 'analyze'
    ORDER BY id DESC LIMIT 1
  `);
  const latestDiagnosisStmt = db.prepare(`
    SELECT * FROM ai_session
    WHERE feature_module = ? AND feature_code = ? AND kind = 'diagnose'
    ORDER BY id DESC LIMIT 1
  `);
  const diagnosesForRunStmt = db.prepare(`
    SELECT * FROM (
      SELECT * FROM ai_session
      WHERE run_id = ? AND kind = 'diagnose'
      ORDER BY id DESC LIMIT ?
    )
    ORDER BY id ASC
  `);
  const createAiSessionStmt = db.prepare(`
    INSERT INTO ai_session (feature_module, feature_code, provider, kind, prompt, response, diff, decision, run_id, attempt_id, user_hint, created_at)
    VALUES (@feature_module, @feature_code, @provider, @kind, @prompt, @response, @diff, @decision, @run_id, @attempt_id, @user_hint, @created_at)
  `);
  const decideSessionStmt = db.prepare(
    'UPDATE ai_session SET decision = ? WHERE id = ?',
  );
  const getSessionStmt = db.prepare('SELECT * FROM ai_session WHERE id = ?');
  const getPendingCatalogStmt = db.prepare(`
    SELECT * FROM ai_session
    WHERE feature_module = ? AND feature_code = ?
      AND kind = 'catalog' AND decision = 'pending'
    ORDER BY id DESC LIMIT 1
  `);
  const getModuleMetaStmt = db.prepare(
    'SELECT * FROM module_meta WHERE module = ?',
  );
  const listModulesStmt = db.prepare(
    'SELECT module, title, notes, chapters_json, hidden, updated_at FROM module_meta WHERE hidden = 0 ORDER BY module',
  );
  // 模块目录来自 manifest：只更新目录字段，不动 notes（备注属于控制台）
  const upsertModuleStmt = db.prepare(`
    INSERT INTO module_meta (module, title, chapters_json, hidden, updated_at)
    VALUES (@module, @title, @chapters_json, @hidden, @updated_at)
    ON CONFLICT(module) DO UPDATE SET
      title = excluded.title,
      chapters_json = excluded.chapters_json,
      hidden = excluded.hidden,
      updated_at = excluded.updated_at
  `);
  const insertModuleStmt = db.prepare(`
    INSERT INTO module_meta (module, title, notes, chapters_json, updated_at)
    VALUES (@module, @title, '', '{}', @updated_at)
  `);
  const upsertModuleMetaStmt = db.prepare(`
    INSERT INTO module_meta (module, notes, chapters_json, updated_at)
    VALUES (@module, @notes, @chapters_json, @updated_at)
    ON CONFLICT(module) DO UPDATE SET
      notes = excluded.notes,
      chapters_json = excluded.chapters_json,
      updated_at = excluded.updated_at
  `);
  const insertCatalogFeatureStmt = db.prepare(`
    INSERT OR IGNORE INTO feature (
      module, code, chapter, title, criteria, precondition, status, notes, updated_at
    ) VALUES (
      @module, @code, @chapter, @title, @criteria, @precondition, @status, '', @updated_at
    )
  `);
  const getAttemptStmt = db.prepare(
    'SELECT * FROM workflow_attempt WHERE id = ?',
  );
  const getCurrentAttemptStmt = db.prepare(`
    SELECT * FROM workflow_attempt
    WHERE feature_module = ? AND feature_code = ?
    ORDER BY sequence DESC LIMIT 1
  `);
  const listAttemptsStmt = db.prepare(`
    SELECT * FROM (
      SELECT * FROM workflow_attempt
      WHERE feature_module = ? AND feature_code = ?
      ORDER BY sequence DESC LIMIT ?
    )
    ORDER BY sequence ASC
  `);
  const nextAttemptSequenceStmt = db.prepare(`
    SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
    FROM workflow_attempt
    WHERE feature_module = ? AND feature_code = ?
  `);
  const insertAttemptStmt = db.prepare(`
    INSERT INTO workflow_attempt (
      feature_module, feature_code, sequence, status, hint, created_at
    )
    VALUES (
      @feature_module, @feature_code, @sequence, 'open', @hint, @created_at
    )
  `);
  const setAttemptAnalyzeSessionStmt = db.prepare(`
    UPDATE workflow_attempt
    SET analyze_session_id = ?, status = 'reviewing'
    WHERE id = ?
  `);
  const setAttemptStatusStmt = db.prepare(`
    UPDATE workflow_attempt SET status = ?, ended_at = ? WHERE id = ?
  `);
  const runsForAttemptStmt = db.prepare(`
    SELECT * FROM run WHERE attempt_id = ? ORDER BY id
  `);
  const diagnosesForAttemptStmt = db.prepare(`
    SELECT * FROM ai_session
    WHERE attempt_id = ? AND kind = 'diagnose'
    ORDER BY id
  `);
  const attemptAnalyzeSummaryStmt = db.prepare(`
    SELECT decision, created_at
    FROM ai_session WHERE id = ?
  `);
  const attemptRunCountStmt = db.prepare(`
    SELECT
      COUNT(*) AS run_count,
      SUM(CASE WHEN ended_at IS NOT NULL AND exit_code != 0 THEN 1 ELSE 0 END) AS failed_run_count
    FROM run WHERE attempt_id = ?
  `);
  const attemptLatestRunSummaryStmt = db.prepare(`
    SELECT id, started_at, ended_at, duration_ms, exit_code, failed_step, artifact_dir
    FROM run WHERE attempt_id = ?
    ORDER BY id DESC LIMIT 1
  `);
  const attemptDiagnosisCountStmt = db.prepare(`
    SELECT COUNT(*) AS diagnosis_count
    FROM ai_session WHERE attempt_id = ? AND kind = 'diagnose'
  `);

  const createAttemptTx = db.transaction((featureModule, featureCode, hint) => {
    const next = nextAttemptSequenceStmt.get(featureModule, featureCode);
    const created_at = new Date().toISOString();
    const result = insertAttemptStmt.run({
      feature_module: featureModule,
      feature_code: featureCode,
      sequence: next.next_sequence,
      hint,
      created_at,
    });
    return getAttemptStmt.get(Number(result.lastInsertRowid));
  });

  function mod(module) {
    return module || DEFAULT_MODULE;
  }

  function moduleMeta(module) {
    return (
      getModuleMetaStmt.get(mod(module)) ?? {
        module: mod(module),
        notes: '',
        chapters_json: '{}',
        updated_at: '',
      }
    );
  }

  function trimModuleNotes(notes) {
    let value = notes;
    while (value.length > 8000) {
      const next = value.indexOf('\n【回归备注】');
      if (next < 0) return value.slice(-8000);
      value = value.slice(next + 1);
    }
    return value;
  }

  const applyCatalogTx = db.transaction((sessionId, module) => {
    const session = getSessionStmt.get(sessionId);
    if (
      !session ||
      session.feature_module !== module ||
      session.feature_code !== CATALOG_FEATURE_CODE ||
      session.kind !== 'catalog' ||
      session.decision !== 'pending'
    ) {
      throw new Error('409: pending catalog session required');
    }

    const draft = JSON.parse(session.response);
    const inserted = [];
    const skipped = [...(Array.isArray(draft.skipped) ? draft.skipped : [])];
    const titleKeys = new Set(
      listByModuleStmt
        .all(module)
        .map((row) => row.title.trim().replace(/\s+/g, '').toLocaleLowerCase()),
    );
    const meta = moduleMeta(module);
    const chapters = JSON.parse(meta.chapters_json || '{}');

    for (const row of draft.features ?? []) {
      const titleKey = row.title
        .trim()
        .replace(/\s+/g, '')
        .toLocaleLowerCase();
      if (getFeatureStmt.get(module, row.code) || titleKeys.has(titleKey)) {
        skipped.push({
          code: row.code,
          title: row.title,
          reason: 'apply_conflict',
          detail: '确认入库时编号或标题已存在',
        });
        continue;
      }
      const updated_at = new Date().toISOString();
      const result = insertCatalogFeatureStmt.run({
        ...row,
        module,
        status: STATUS.PENDING_WRITE,
        updated_at,
      });
      if (result.changes !== 1) {
        skipped.push({
          code: row.code,
          title: row.title,
          reason: 'apply_conflict',
          detail: '确认入库时编号已存在',
        });
        continue;
      }
      titleKeys.add(titleKey);
      if (row.chapter_title && !chapters[row.chapter]) {
        chapters[row.chapter] = row.chapter_title;
      }
      inserted.push(getFeatureStmt.get(module, row.code));
    }

    upsertModuleMetaStmt.run({
      ...meta,
      module,
      chapters_json: JSON.stringify(chapters),
      updated_at: new Date().toISOString(),
    });
    decideSessionStmt.run('approved', sessionId);
    return { inserted, skipped };
  });

  return {
    /** @param {string=} module 省略则返回全部模块（均不含 hidden） */
    listFeatures(module) {
      if (module) return listByModuleStmt.all(module);
      return listAllStmt.all();
    },

    /** 含 hidden 行，仅供测试与同步内部核对 */
    listFeaturesHidden(module) {
      return listFeaturesHiddenStmt.all(mod(module));
    },

    getFeature(code, module) {
      return getFeatureStmt.get(module, code);
    },

    upsertFeature(row) {
      const updated_at = new Date().toISOString();
      const params = {
        module: mod(row.module),
        code: row.code,
        chapter: row.chapter,
        title: row.title,
        criteria: row.criteria,
        precondition: row.precondition ?? '',
        status: row.status ?? STATUS.PENDING_RUN,
        notes: row.notes ?? '',
        hidden: row.hidden ?? 0,
        runnable: row.runnable ?? 1,
        manual: row.manual ?? 0,
        updated_at,
      };
      // 未显式传 notes 就不动备注：备注是人工积累的执行记录，不属于清单
      const stmt = row.notes === undefined ? upsertFeatureStmt : upsertFeatureNotesStmt;
      stmt.run(params);
    },

    setFeatureHidden(module, code, hidden) {
      setFeatureHiddenStmt.run(
        hidden ? 1 : 0,
        new Date().toISOString(),
        mod(module),
        code,
      );
    },

    /** 清单里没有的功能点全部软删除，保留 status / notes / 历史 run */
    hideFeaturesNotIn(keep) {
      const keys = (keep ?? []).map((k) => `${k.module}|${k.code}`);
      if (keys.length === 0) {
        db.prepare('UPDATE feature SET hidden = 1').run();
        return;
      }
      const placeholders = keys.map(() => '?').join(',');
      db.prepare(
        `UPDATE feature SET hidden = 1 WHERE (module || '|' || code) NOT IN (${placeholders})`,
      ).run(...keys);
    },

    setStatus(code, status, module = DEFAULT_MODULE) {
      setStatusStmt.run(status, new Date().toISOString(), mod(module), code);
    },

    appendFeatureNote(code, module, hint) {
      const feature = getFeatureStmt.get(mod(module), code);
      if (!feature) {
        throw new Error(`feature ${mod(module)}/${code} 不存在`);
      }
      const line = `【诊断线索】${String(hint).trim()}`;
      const notes = feature.notes ? `${feature.notes}\n${line}` : line;
      setFeatureNotesStmt.run(
        notes,
        new Date().toISOString(),
        mod(module),
        code,
      );
    },

    /** 打回或重生成时的长期纠偏信息，后续每轮 Claude 都会收到。 */
    appendRegressionNote(code, module, note) {
      const feature = getFeatureStmt.get(mod(module), code);
      if (!feature) {
        throw new Error(`feature ${mod(module)}/${code} 不存在`);
      }
      const line = `【回归备注】${String(note).trim()}`;
      const notes = feature.notes ? `${feature.notes}\n${line}` : line;
      setFeatureNotesStmt.run(
        notes,
        new Date().toISOString(),
        mod(module),
        code,
      );
    },

    assertCanRun(code, module = DEFAULT_MODULE) {
      const m = mod(module);
      const pending = getPendingSessionStmt.get(m, code);
      if (pending) {
        throw new Error('存在 pending 的 AI session，需先 approve/reject');
      }

      const feature = getFeatureStmt.get(m, code);
      if (!feature) {
        throw new Error(`feature ${m}/${code} 不存在`);
      }

      const runnable = new Set([
        STATUS.PASSED,
        STATUS.FAILED,
        STATUS.PENDING_RUN,
      ]);
      if (!runnable.has(feature.status)) {
        throw new Error(
          `status 必须是待执行、失败或通过，当前为 ${feature.status}`,
        );
      }

      const flows = listFlowsStmt.all(m, code);
      const hasFlow = flows.some((f) => f.kind === 'flow');
      if (!hasFlow) {
        throw new Error('必须有 kind=flow 的行');
      }
    },

    upsertFlow({ feature_module, feature_code, path, kind, module }) {
      const updated_at = new Date().toISOString();
      const fm = mod(feature_module ?? module);
      const result = upsertFlowStmt.run({
        feature_module: fm,
        feature_code,
        path,
        kind,
        updated_at,
      });
      return {
        id: Number(result.lastInsertRowid),
        feature_module: fm,
        feature_code,
        path,
        kind,
        updated_at,
      };
    },

    /** @deprecated 用 upsertFlow；保留以免 apply / 测试漏改 */
    insertFlow(row) {
      return this.upsertFlow(row);
    },

    listFlows(feature_code, module = DEFAULT_MODULE) {
      return listFlowsStmt.all(mod(module), feature_code);
    },

    startRun(code, module = DEFAULT_MODULE, attemptId = null) {
      const m = mod(module);
      const active = getActiveRunStmt.get();
      if (active) {
        throw new Error('409: 已有运行中的 run');
      }

      this.assertCanRun(code, m);

      const flows = listFlowsStmt.all(m, code);
      const flow = flows.find((f) => f.kind === 'flow');
      if (!flow) {
        throw new Error('必须有 kind=flow 的行');
      }

      setStatusStmt.run(STATUS.RUNNING, new Date().toISOString(), m, code);

      const started_at = new Date().toISOString();
      const result = insertRunStmt.run({
        flow_id: flow.id,
        attempt_id: attemptId,
        started_at,
      });
      if (attemptId) {
        setAttemptStatusStmt.run('running', null, attemptId);
      }
      const id = Number(result.lastInsertRowid);
      return getRunStmt.get(id);
    },

    getActiveRun() {
      return getActiveRunStmt.get();
    },

    /** 某功能点最近一次已结束的 run（供失败诊断取日志/产物） */
    getLatestRun(code, module = DEFAULT_MODULE) {
      return latestRunStmt.get(mod(module), code);
    },

    finishRun(runId, { exit_code, failed_step, artifact_dir, log_excerpt }) {
      const run = getRunStmt.get(runId);
      if (!run) {
        throw new Error(`run ${runId} 不存在`);
      }

      const ended_at = new Date().toISOString();
      const duration_ms =
        new Date(ended_at).getTime() - new Date(run.started_at).getTime();

      finishRunStmt.run({
        id: runId,
        ended_at,
        duration_ms,
        exit_code,
        failed_step: failed_step ?? null,
        artifact_dir: artifact_dir ?? null,
        log_excerpt: log_excerpt ?? null,
      });

      const flow = db
        .prepare(
          'SELECT feature_module, feature_code FROM flow WHERE id = ?',
        )
        .get(run.flow_id);
      const newStatus = exit_code === 0 ? STATUS.PASSED : STATUS.FAILED;
      setStatusStmt.run(
        newStatus,
        ended_at,
        flow.feature_module,
        flow.feature_code,
      );
      if (run.attempt_id) {
        setAttemptStatusStmt.run(
          exit_code === 0 ? 'passed' : 'failed',
          exit_code === 0 ? ended_at : null,
          run.attempt_id,
        );
      }
    },

    /**
     * @param {{ kind?: 'analyze'|'diagnose', decision?: string, run_id?: number|null, attempt_id?: number|null, user_hint?: string }} row
     *   kind='diagnose' 传 decision='recorded'，不会阻塞执行
     */
    createAiSession({
      feature_code,
      feature_module,
      module,
      provider,
      kind,
      prompt,
      response,
      diff,
      decision,
      run_id,
      attempt_id,
      user_hint,
    }) {
      const created_at = new Date().toISOString();
      const fm = mod(feature_module ?? module);
      const result = createAiSessionStmt.run({
        feature_module: fm,
        feature_code,
        provider,
        kind: kind ?? 'analyze',
        prompt,
        response,
        diff: diff ?? '',
        decision: decision ?? 'pending',
        run_id: run_id ?? null,
        attempt_id: attempt_id ?? null,
        user_hint: user_hint ?? '',
        created_at,
      });
      const id = Number(result.lastInsertRowid);
      return db.prepare('SELECT * FROM ai_session WHERE id = ?').get(id);
    },

    getPendingSession(code, module = DEFAULT_MODULE) {
      return getPendingSessionStmt.get(mod(module), code);
    },

    getPendingCatalog(module = DEFAULT_MODULE) {
      return getPendingCatalogStmt.get(mod(module), CATALOG_FEATURE_CODE);
    },

    getModuleMeta(module = DEFAULT_MODULE) {
      const meta = moduleMeta(module);
      return {
        ...meta,
        chapters: JSON.parse(meta.chapters_json || '{}'),
      };
    },

    listModules() {
      return listModulesStmt.all();
    },

    upsertModule({ id, title, chapters, hidden }) {
      upsertModuleStmt.run({
        module: id,
        title: title ?? '',
        chapters_json: JSON.stringify(chapters ?? {}),
        hidden: hidden ?? 0,
        updated_at: new Date().toISOString(),
      });
    },

    /** 清单里没有的模块全部软删除，保留 notes */
    hideModulesNotIn(ids) {
      const keep = ids ?? [];
      if (keep.length === 0) {
        db.prepare('UPDATE module_meta SET hidden = 1').run();
        return;
      }
      const placeholders = keep.map(() => '?').join(',');
      db.prepare(
        `UPDATE module_meta SET hidden = 1 WHERE module NOT IN (${placeholders})`,
      ).run(...keep);
    },

    createModule({ id, title }) {
      const existing = getModuleMetaStmt.get(id);
      if (existing) {
        throw new Error('409: 模块 ID 已存在');
      }
      const updated_at = new Date().toISOString();
      insertModuleStmt.run({ module: id, title, updated_at });
      return getModuleMetaStmt.get(id);
    },

    appendModuleNote(module = DEFAULT_MODULE, note) {
      const value = String(note ?? '').trim();
      if (!value) throw new Error('400: 打回备注必填');
      if (value.length > 2000) throw new Error('400: 打回备注最多 2000 字');
      const meta = moduleMeta(module);
      const line = `【回归备注】${value}`;
      const notes = trimModuleNotes(meta.notes ? `${meta.notes}\n${line}` : line);
      upsertModuleMetaStmt.run({
        ...meta,
        module: mod(module),
        notes,
        updated_at: new Date().toISOString(),
      });
      return this.getModuleMeta(module);
    },

    applyCatalog(sessionId, module = DEFAULT_MODULE) {
      return applyCatalogTx(Number(sessionId), mod(module));
    },

    /**
     * 把一批写入包进单个事务。
     *
     * 快照同步要么整份生效要么整份不生效——中途失败留下半份清单，
     * 会让「上次成功快照」这个保底前提失效。
     */
    runSyncSnapshot(fn) {
      return db.transaction(fn)();
    },

    /** 最近一次失败诊断，供看板展示与「按诊断重生」回流 prompt */
    getLatestDiagnosis(code, module = DEFAULT_MODULE) {
      return latestDiagnosisStmt.get(mod(module), code);
    },

    /** 同一次失败最近 N 轮诊断，按时间正序返回 */
    listDiagnosesForRun(runId, limit = 5) {
      return diagnosesForRunStmt.all(runId, Math.max(1, Number(limit) || 5));
    },

    decideSession(id, decision) {
      decideSessionStmt.run(decision, id);
    },

    /** 新建一次「生成脚本 → 确认 → 执行结果」轮次。 */
    createAttempt(code, module = DEFAULT_MODULE, hint = '') {
      return createAttemptTx(mod(module), code, String(hint ?? '').trim());
    },

    getCurrentAttempt(code, module = DEFAULT_MODULE) {
      return getCurrentAttemptStmt.get(mod(module), code);
    },

    listAttempts(code, module = DEFAULT_MODULE, limit = 20) {
      const rows = listAttemptsStmt.all(
        mod(module),
        code,
        Math.max(1, Math.min(100, Number(limit) || 20)),
      );
      return rows.map((attempt) => {
        const analyze = attempt.analyze_session_id
          ? attemptAnalyzeSummaryStmt.get(attempt.analyze_session_id)
          : null;
        const runCounts = attemptRunCountStmt.get(attempt.id);
        return {
          ...attempt,
          analyze_decision: analyze?.decision ?? null,
          analyze_created_at: analyze?.created_at ?? null,
          run_count: Number(runCounts.run_count) || 0,
          failed_run_count: Number(runCounts.failed_run_count) || 0,
          latest_run: attemptLatestRunSummaryStmt.get(attempt.id) ?? null,
          diagnosis_count:
            Number(
              attemptDiagnosisCountStmt.get(attempt.id).diagnosis_count,
            ) || 0,
        };
      });
    },

    setAttemptAnalyzeSession(attemptId, sessionId) {
      setAttemptAnalyzeSessionStmt.run(sessionId, attemptId);
      return getAttemptStmt.get(attemptId);
    },

    setAttemptStatus(attemptId, status, ended = false) {
      setAttemptStatusStmt.run(
        status,
        ended ? new Date().toISOString() : null,
        attemptId,
      );
      return getAttemptStmt.get(attemptId);
    },

    getAttemptDetail(attemptId) {
      const attempt = getAttemptStmt.get(attemptId);
      if (!attempt) return undefined;
      return {
        ...attempt,
        analyzeSession: attempt.analyze_session_id
          ? db
              .prepare('SELECT * FROM ai_session WHERE id = ?')
              .get(attempt.analyze_session_id)
          : null,
        runs: runsForAttemptStmt.all(attemptId),
        diagnoses: diagnosesForAttemptStmt.all(attemptId),
      };
    },
  };
}
