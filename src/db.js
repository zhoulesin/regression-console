import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feature (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL DEFAULT 'todo',
  code TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  title TEXT NOT NULL,
  criteria TEXT NOT NULL,
  precondition TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(module, code)
);
CREATE TABLE IF NOT EXISTS flow (
  id INTEGER PRIMARY KEY,
  feature_module TEXT NOT NULL DEFAULT 'todo',
  feature_code TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY,
  flow_id INTEGER NOT NULL,
  attempt_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  failed_step TEXT,
  artifact_dir TEXT,
  log_excerpt TEXT
);
CREATE TABLE IF NOT EXISTS ai_session (
  id INTEGER PRIMARY KEY,
  feature_module TEXT NOT NULL DEFAULT 'todo',
  feature_code TEXT NOT NULL,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'analyze',
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  diff TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL,
  run_id INTEGER,
  attempt_id INTEGER,
  user_hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_attempt (
  id INTEGER PRIMARY KEY,
  feature_module TEXT NOT NULL DEFAULT 'todo',
  feature_code TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  analyze_session_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(feature_module, feature_code, sequence)
);
CREATE TABLE IF NOT EXISTS module_meta (
  module TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  chapters_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`;

/** 每个功能点每种 kind 只留最新一条 flow，再加唯一索引。 */
function dedupeFlowBindings(db) {
  const flowCols = db.prepare(`PRAGMA table_info(flow)`).all().map((c) => c.name);
  if (flowCols.length === 0) return;
  db.exec(`
    DELETE FROM flow
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM flow
      GROUP BY feature_module, feature_code, kind
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_feature_kind
    ON flow(feature_module, feature_code, kind);
  `);
}

/** 首次引入轮次表时，把旧会话与 run 尽量归并成可回看的历史轮次。 */
function backfillWorkflowAttempts(db) {
  const count = db
    .prepare('SELECT COUNT(*) AS count FROM workflow_attempt')
    .get().count;
  if (count > 0) return;

  const featureKeys = db
    .prepare(`
      SELECT feature_module, feature_code FROM ai_session
      UNION
      SELECT flow.feature_module, flow.feature_code
      FROM run JOIN flow ON flow.id = run.flow_id
    `)
    .all();
  if (!featureKeys.length) return;

  const analysesStmt = db.prepare(`
    SELECT * FROM ai_session
    WHERE feature_module = ? AND feature_code = ? AND kind = 'analyze'
    ORDER BY created_at, id
  `);
  const runsStmt = db.prepare(`
    SELECT run.* FROM run
    JOIN flow ON flow.id = run.flow_id
    WHERE flow.feature_module = ? AND flow.feature_code = ?
    ORDER BY run.started_at, run.id
  `);
  const insertAttemptStmt = db.prepare(`
    INSERT INTO workflow_attempt (
      feature_module, feature_code, sequence, analyze_session_id,
      status, hint, created_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?)
  `);
  const linkAnalyzeStmt = db.prepare(
    'UPDATE ai_session SET attempt_id = ? WHERE id = ?',
  );
  const linkRunStmt = db.prepare(
    'UPDATE run SET attempt_id = ? WHERE id = ?',
  );
  const updateAttemptStmt = db.prepare(`
    UPDATE workflow_attempt SET status = ?, ended_at = ? WHERE id = ?
  `);

  db.transaction(() => {
    for (const key of featureKeys) {
      const analyses = analysesStmt.all(
        key.feature_module,
        key.feature_code,
      );
      const runs = runsStmt.all(key.feature_module, key.feature_code);
      const attempts = [];

      if (analyses.length) {
        analyses.forEach((session, index) => {
          const status =
            session.decision === 'pending'
              ? 'reviewing'
              : session.decision === 'rejected'
                ? 'rejected'
                : 'open';
          const endedAt =
            session.decision === 'rejected' ? session.created_at : null;
          const result = insertAttemptStmt.run(
            key.feature_module,
            key.feature_code,
            index + 1,
            session.id,
            status,
            session.created_at,
            endedAt,
          );
          const attempt = {
            id: Number(result.lastInsertRowid),
            started_at: session.created_at,
            status,
          };
          attempts.push(attempt);
          linkAnalyzeStmt.run(attempt.id, session.id);
        });
      } else if (runs.length) {
        const result = insertAttemptStmt.run(
          key.feature_module,
          key.feature_code,
          1,
          null,
          'open',
          runs[0].started_at,
          null,
        );
        attempts.push({
          id: Number(result.lastInsertRowid),
          started_at: runs[0].started_at,
          status: 'open',
        });
      }

      for (const run of runs) {
        const attempt =
          [...attempts]
            .reverse()
            .find((row) => row.started_at <= run.started_at) ?? attempts[0];
        if (!attempt) continue;
        linkRunStmt.run(attempt.id, run.id);
      }

      for (const attempt of attempts) {
        const linkedRuns = db
          .prepare(
            'SELECT * FROM run WHERE attempt_id = ? ORDER BY id DESC',
          )
          .all(attempt.id);
        const latest = linkedRuns[0];
        if (!latest?.ended_at) continue;
        const status = latest.exit_code === 0 ? 'passed' : 'failed';
        updateAttemptStmt.run(
          status,
          status === 'passed' ? latest.ended_at : null,
          attempt.id,
        );
      }
    }

    // 诊断已经有 run_id，直接继承该 run 的轮次最可靠。
    db.exec(`
      UPDATE ai_session
      SET attempt_id = (
        SELECT run.attempt_id FROM run WHERE run.id = ai_session.run_id
      )
      WHERE kind = 'diagnose' AND run_id IS NOT NULL AND attempt_id IS NULL
    `);
  })();
}

/**
 * 旧库（无 module / 仅 UNIQUE(code)）迁到 (module, code)。
 * @param {import('better-sqlite3').Database} db
 */
function migrate(db) {
  const featureCols = db.prepare(`PRAGMA table_info(feature)`).all().map((c) => c.name);
  if (featureCols.length === 0) return;

  if (!featureCols.includes('module')) {
    db.exec(`
      CREATE TABLE feature_v2 (
        id INTEGER PRIMARY KEY,
        module TEXT NOT NULL DEFAULT 'todo',
        code TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        title TEXT NOT NULL,
        criteria TEXT NOT NULL,
        precondition TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE(module, code)
      );
      INSERT INTO feature_v2 (id, module, code, chapter, title, criteria, precondition, status, notes, updated_at)
      SELECT id, 'todo', code, chapter, title, criteria, precondition, status, notes, updated_at FROM feature;
      DROP TABLE feature;
      ALTER TABLE feature_v2 RENAME TO feature;
    `);
  }

  const flowCols = db.prepare(`PRAGMA table_info(flow)`).all().map((c) => c.name);
  if (flowCols.length && !flowCols.includes('feature_module')) {
    db.exec(`
      CREATE TABLE flow_v2 (
        id INTEGER PRIMARY KEY,
        feature_module TEXT NOT NULL DEFAULT 'todo',
        feature_code TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO flow_v2 (id, feature_module, feature_code, path, kind, updated_at)
      SELECT id, 'todo', feature_code, path, kind, updated_at FROM flow;
      DROP TABLE flow;
      ALTER TABLE flow_v2 RENAME TO flow;
    `);
  }

  const sessionCols = db.prepare(`PRAGMA table_info(ai_session)`).all().map((c) => c.name);
  if (sessionCols.length && !sessionCols.includes('feature_module')) {
    db.exec(`
      CREATE TABLE ai_session_v2 (
        id INTEGER PRIMARY KEY,
        feature_module TEXT NOT NULL DEFAULT 'todo',
        feature_code TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        diff TEXT NOT NULL DEFAULT '',
        decision TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO ai_session_v2 (id, feature_module, feature_code, provider, prompt, response, diff, decision, created_at)
      SELECT id, 'todo', feature_code, provider, prompt, response, diff, decision, created_at FROM ai_session;
      DROP TABLE ai_session;
      ALTER TABLE ai_session_v2 RENAME TO ai_session;
    `);
  }

  // kind 区分「生成脚本」与「失败诊断」两类会话：
  // 前者才需要人工批准并阻塞执行，后者只是记录。
  const sessionCols2 = db.prepare(`PRAGMA table_info(ai_session)`).all().map((c) => c.name);
  if (sessionCols2.length && !sessionCols2.includes('kind')) {
    db.exec(
      `ALTER TABLE ai_session ADD COLUMN kind TEXT NOT NULL DEFAULT 'analyze'`,
    );
  }
  // 诊断关联到具体哪一次 run，便于回溯
  if (sessionCols2.length && !sessionCols2.includes('run_id')) {
    db.exec(`ALTER TABLE ai_session ADD COLUMN run_id INTEGER`);
  }
  // 用户补充的诊断线索只属于当前 run；空串表示首次自动诊断
  if (sessionCols2.length && !sessionCols2.includes('user_hint')) {
    db.exec(
      `ALTER TABLE ai_session ADD COLUMN user_hint TEXT NOT NULL DEFAULT ''`,
    );
  }
  if (sessionCols2.length && !sessionCols2.includes('attempt_id')) {
    db.exec(`ALTER TABLE ai_session ADD COLUMN attempt_id INTEGER`);
  }

  const runCols = db.prepare(`PRAGMA table_info(run)`).all().map((c) => c.name);
  if (runCols.length && !runCols.includes('attempt_id')) {
    db.exec(`ALTER TABLE run ADD COLUMN attempt_id INTEGER`);
  }

  // module_meta 添加 title 字段用于动态模块管理
  const metaCols = db.prepare(`PRAGMA table_info(module_meta)`).all().map((c) => c.name);
  if (metaCols.length && !metaCols.includes('title')) {
    db.exec(`ALTER TABLE module_meta ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
  }

  backfillWorkflowAttempts(db);
  dedupeFlowBindings(db);
}

/** @param {string} dbPath */
export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
