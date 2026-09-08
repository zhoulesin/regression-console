import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeStreamUrl,
  api,
  bootstrapToken,
  getCatalogPending,
  getModules,
  getSavedModule,
  createModule,
  postCatalogApply,
  postCatalogPropose,
  postCatalogReject,
  saveModule,
  streamUrl,
  withModule,
} from './api.js';
import { AttemptTimeline } from './AttemptTimeline.jsx';
import { CatalogPanel } from './CatalogPanel.jsx';
import { CurrentDetail } from './CurrentDetail.jsx';
import { StepModal } from './StepModal.jsx';
import { resolveCurrentStep } from './attemptViewModel.js';

const DEFAULT_MODULES = [
  { id: 'todo', title: 'Todo' },
  { id: 'routine', title: 'Routine' },
  { id: 'chore', title: 'Chore' },
];

const CHAPTER_TITLES = {
  todo: {
    0: 'App 级冒烟',
    1: 'todo-list',
    2: '单 List 内的 Todo',
    3: 'Display 排序',
    4: '完成态',
    5: 'Filter',
  },
  routine: {},
  chore: {},
};

const STATUS = {
  PENDING_WRITE: '待写',
  PENDING_RUN: '待执行',
  RUNNING: '运行中',
  PASSED: '通过',
  FAILED: '失败',
  MANUAL: '留手测',
  FALSE_GREEN: '假绿',
};

function pillClass(status) {
  if (status === STATUS.PASSED) return 'p-ok';
  if (status === STATUS.MANUAL) return 'p-hand';
  if (status === STATUS.FAILED || status === STATUS.FALSE_GREEN) return 'p-warn';
  return 'p-wait';
}

/** 顶栏「卡在」：第一个非通过且非留手测 */
function stuckCode(features) {
  const hit = features.find(
    (f) => f.status !== STATUS.PASSED && f.status !== STATUS.MANUAL,
  );
  return hit?.code ?? '—';
}

function parseSessionPayload(session) {
  if (!session?.response) {
    return { rationale: '', risks: [], files: [], steps: [] };
  }
  try {
    const parsed = JSON.parse(session.response);
    return {
      rationale: parsed.rationale || '',
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    };
  } catch {
    return { rationale: '', risks: [], files: [], steps: [] };
  }
}

/** 中文步骤清单：人工只看这个决定批准还是打回 */
function StepList({ files }) {
  if (!files.length) {
    return <p className="flow-hint muted">（这份 Diff 没有可解析的步骤）</p>;
  }
  return (
    <div className="steps">
      {files.map((f) => (
        <div className="steps-file" key={f.path}>
          <div className="steps-path">{f.path}</div>
          <ol className="steps-list">
            {f.steps.map((s, i) => (
              <li key={`${f.path}-${i}`} data-depth={s.depth}>
                {s.text}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function RegressionNoteInput({ value, onChange, label }) {
  return (
    <div className="regression-note">
      <label htmlFor="regression-note">{label}（必填）</label>
      <textarea
        id="regression-note"
        value={value}
        maxLength={2000}
        onChange={(event) => onChange(event.target.value)}
        placeholder="说明当前场景哪里不对、下一轮必须怎样验证……"
      />
      <span>{value.length}/2000 · 将永久追加到功能备注</span>
    </div>
  );
}

/** 同一次失败的最近几轮诊断对话 */
function DiagnosisConversation({ turns }) {
  if (!turns.length) return null;
  return (
    <div className="diagnosis-chat">
      {turns.map((turn) => (
        <div className="diagnosis-turn" key={turn.id}>
          {turn.user_hint ? (
            <div className="diagnosis-msg user">
              <div className="label">我的补充</div>
              <div>{turn.user_hint}</div>
            </div>
          ) : null}
          <div className="diagnosis-msg ai">
            <div className="label">AI 诊断 · {fmtTime(turn.created_at)}</div>
            <pre>{turn.response}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}

function flowKindFlow(flows) {
  return (flows || []).filter((f) => f.kind === 'flow');
}

/**
 * 当前流程主步骤：决定右侧哪一段高亮、露哪个主按钮。
 * @returns {'blocked'|'analyze'|'review'|'run'|'abort'|'rerun'|'idle'}
 */
/** ISO 时间转本地 HH:mm，取不到就原样返回 */
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 两类 AI 任务的阶段名；只用于展示，不参与后端协议 */
const ANALYZE_STAGES = ['准备上下文', 'Claude 生成脚本', '校验路径并生成 Diff'];
const DIAGNOSE_STAGES = ['收集失败产物', 'Claude 判断根因', '整理诊断结论'];

/**
 * 从既有 SSE 文本里推断当前阶段，避免为此新开一套事件协议。
 * 标记由 http.js 的 analyzeHub.push 写入。
 * @param {'analyze'|'diagnose'} kind
 * @param {string} logs
 */
function stageIndexOf(kind, logs) {
  if (!logs) return 0;
  if (kind === 'analyze') {
    if (logs.includes('Claude 输出结束')) return 2;
    return logs.includes('[analyze]') ? 1 : 0;
  }
  if (logs.includes('[diagnose] 完成')) return 2;
  return logs.includes('[diagnose]') ? 1 : 0;
}

/** 毫秒转 mm:ss */
function fmtElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * AI 任务面板：只显示阶段、耗时、中止；Claude 原文收进折叠区。
 * 出错时自动展开原文，方便排障。
 */
function TaskPanel({
  stages,
  stageIndex,
  running,
  elapsedMs,
  logs,
  onAbort,
  failed,
}) {
  return (
    <div className="task">
      <div className="task-hd">
        <span className={`task-state${failed ? ' bad' : ''}`}>
          {running
            ? `处理中 ${fmtElapsed(elapsedMs)}`
            : failed
              ? '已中断'
              : '完成'}
        </span>
        {running && onAbort ? (
          <button className="danger" type="button" onClick={onAbort}>
            中止
          </button>
        ) : null}
      </div>
      <ol className="task-stages">
        {stages.map((label, i) => {
          const state = !running && !failed
            ? 'done'
            : i < stageIndex
              ? 'done'
              : i === stageIndex && running
                ? 'active'
                : 'idle';
          return (
            <li key={label} className={state}>
              {label}
            </li>
          );
        })}
      </ol>
      {logs ? (
        <details className="task-log" open={failed}>
          <summary>查看技术日志</summary>
          <pre className="log-pre">{logs}</pre>
        </details>
      ) : null}
    </div>
  );
}

function resolveStep(feature, pending, flows) {
  if (!feature) return 'idle';
  if (
    feature.status === STATUS.MANUAL ||
    feature.status === STATUS.FALSE_GREEN
  ) {
    return 'blocked';
  }
  if (pending) return 'review';
  if (feature.status === STATUS.RUNNING) return 'abort';
  if (feature.status === STATUS.PENDING_WRITE) return 'analyze';
  if (
    feature.status === STATUS.PENDING_RUN ||
    (feature.status === STATUS.FAILED && flows.length > 0)
  ) {
    return 'run';
  }
  if (feature.status === STATUS.FAILED) return 'analyze';
  if (feature.status === STATUS.PASSED && flows.length > 0) return 'rerun';
  return 'idle';
}

export default function App() {
  const [moduleId, setModuleId] = useState(() => getSavedModule('todo'));
  const [features, setFeatures] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState('');
  const [risks, setRisks] = useState([]);
  const [diffText, setDiffText] = useState('');
  const [filesJson, setFilesJson] = useState('');
  const [stepFiles, setStepFiles] = useState([]);
  const [logs, setLogs] = useState('');
  const [history, setHistory] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeLogs, setAnalyzeLogs] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [diagnosisHint, setDiagnosisHint] = useState('');
  const [saveHintAsNote, setSaveHintAsNote] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [regenerateNote, setRegenerateNote] = useState('');
  // 当前跑的是哪类 AI 任务：analyze / diagnose 共用同一条 SSE，
  // 不区分的话诊断日志会同时渲染进「生成脚本」区，这正是之前看起来乱的原因之一。
  const [taskKind, setTaskKind] = useState(null);
  const [aiSlot, setAiSlot] = useState({ busy: false, kind: null });
  const [taskStartedAt, setTaskStartedAt] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  const [taskFailed, setTaskFailed] = useState(false);
  const [handoff, setHandoff] = useState('');
  const [stepModal, setStepModal] = useState(null);
  const [attemptDetails, setAttemptDetails] = useState({});
  const [modalLoading, setModalLoading] = useState(false);
  const [catalogMode, setCatalogMode] = useState(false);
  const [catalogPending, setCatalogPending] = useState(null);
  const [catalogDraft, setCatalogDraft] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAnalyzing, setCatalogAnalyzing] = useState(false);
  const [catalogLogs, setCatalogLogs] = useState('');
  const [modules, setModules] = useState(DEFAULT_MODULES);
  const [showAddModule, setShowAddModule] = useState(false);
  const [newModuleId, setNewModuleId] = useState('');
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [moduleError, setModuleError] = useState('');
  const esRef = useRef(null);
  const analyzeEsRef = useRef(null);
  const currentDetailRef = useRef(null);
  const reviewRef = useRef(null);
  const diagnoseRef = useRef(null);

  useEffect(() => {
    bootstrapToken();
  }, []);

  useEffect(() => {
    async function loadModules() {
      try {
        const data = await getModules();
        if (data.modules && data.modules.length > 0) {
          setModules(data.modules);
        }
      } catch {
        // fallback to defaults
      }
    }
    loadModules();
  }, []);

  useEffect(() => {
    async function checkCatalogPending() {
      try {
        const data = await getCatalogPending(moduleId);
        if (data.session) {
          setCatalogMode(true);
          setCatalogPending(data.session);
          setCatalogDraft(data.draft);
        }
      } catch {
        // ignore
      }
    }
    checkCatalogPending();
  }, [moduleId]);

  function switchModule(id) {
    saveModule(id);
    setModuleId(id);
    setSelectedCode(null);
    setError('');
  }

  const refresh = useCallback(async () => {
    const data = await api(withModule('/api/features', moduleId));
    const list = data.features || [];
    setFeatures(list);
    setSelectedCode((prev) => {
      if (prev && list.some((f) => f.code === prev)) return prev;
      return list[0]?.code ?? null;
    });
    try {
      const slot = await api('/api/analyze/status');
      setAiSlot({
        busy: Boolean(slot?.busy),
        kind: slot?.kind ?? null,
      });
    } catch {
      setAiSlot({ busy: false, kind: null });
    }
  }, [moduleId]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message || e)));
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const selected = useMemo(
    () => features.find((f) => f.code === selectedCode) || null,
    [features, selectedCode],
  );

  const pending = selected?.pendingSession ?? null;
  const flows = flowKindFlow(selected?.flows);

  // 换功能点就清掉本次的诊断结论，避免看串（落库的那条由 savedDiagnosis 提供）
  useEffect(() => {
    setDiagnosis('');
    setDiagnosisHint('');
    setSaveHintAsNote(false);
    setRejectNote('');
    setRegenerateNote('');
    setHandoff('');
    // 上一条功能点的任务面板与日志不要留在新选中的条目上
    setTaskKind(null);
    setAnalyzeLogs('');
    setTaskFailed(false);
    setStepModal(null);
    setAttemptDetails({});
  }, [selectedCode, moduleId]);

  // 任务进行中每秒刷一次耗时
  const taskRunning = analyzing || diagnosing;
  useEffect(() => {
    if (!taskRunning) return;
    setNowTs(Date.now());
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [taskRunning]);

  const elapsedMs = taskStartedAt ? Math.max(0, nowTs - taskStartedAt) : 0;

  /** 任务结束后把视线交接到下一步 */
  const scrollTo = useCallback((ref) => {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // 只显示本次失败 run 的诊断，不能把上一次运行的结论串进来
  const diagnosisHistory = selected?.diagnosisHistory ?? [];
  const savedDiagnosis = diagnosisHistory.at(-1) ?? null;
  const shownDiagnosis = diagnosis || savedDiagnosis?.response || '';
  // 诊断对应的 run 就是最近一次失败时，才允许「按诊断重生」
  const diagnosisFresh =
    selected?.status === STATUS.FAILED && Boolean(shownDiagnosis);
  const attempts = selected?.attempts ?? [];
  const latestAttempt = attempts.at(-1) ?? null;

  // 选中切换：从 pending session 填 Diff 区
  useEffect(() => {
    if (!selected) {
      setRationale('');
      setRisks([]);
      setDiffText('');
      setFilesJson('');
      setStepFiles([]);
      return;
    }
    if (pending) {
      const payload = parseSessionPayload(pending);
      setRationale(payload.rationale);
      setRisks(payload.risks);
      setDiffText(pending.diff || '');
      setFilesJson(JSON.stringify(payload.files, null, 2));
      setStepFiles(payload.steps);
    } else {
      setRationale('');
      setRisks([]);
      setDiffText('');
      setFilesJson('');
      setStepFiles([]);
    }
  }, [selected?.code, pending?.id]);

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (analyzeEsRef.current) {
        analyzeEsRef.current.close();
        analyzeEsRef.current = null;
      }
    };
  }, []);

  const passed = features.filter((f) => f.status === STATUS.PASSED).length;
  const running = features.filter((f) => f.status === STATUS.RUNNING).length;
  const stuck = stuckCode(features);

  const byChapter = useMemo(() => {
    const map = new Map();
    for (const f of features) {
      const list = map.get(f.chapter) || [];
      list.push(f);
      map.set(f.chapter, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        String(a.code).localeCompare(String(b.code), 'en', { numeric: true }),
      );
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [features]);

  // 当前主步骤只驱动底部操作区；点击历史节点只开弹框，不改变这里。
  const legacyStep = resolveStep(selected, pending, flows);
  const step = selected?.status === STATUS.MANUAL ||
    selected?.status === STATUS.FALSE_GREEN
    ? 'blocked'
    : analyzing
      ? 'generate'
      : diagnosing
        ? 'diagnose'
        : latestAttempt
          ? resolveCurrentStep(latestAttempt)
          : selected?.status === STATUS.FAILED
            ? diagnosisHistory.length
              ? 'diagnose'
              : 'failed'
            : legacyStep === 'analyze'
              ? 'generate'
              : legacyStep === 'review'
                ? 'review'
                : legacyStep === 'abort' ||
                    legacyStep === 'run' ||
                    legacyStep === 'rerun'
                  ? 'run'
                  : legacyStep;
  const blockedReason =
    selected?.status === STATUS.MANUAL
      ? '这条标为留手测，流程停在这里，不自动写/跑。'
      : selected?.status === STATUS.FALSE_GREEN
        ? '这条是假绿，需要人工复核，不开放主按钮。'
        : '';

  const closeStepModal = useCallback(() => setStepModal(null), []);

  async function openAttemptStep(attempt, stepId) {
    setStepModal({
      attemptId: attempt.id,
      sequence: attempt.sequence,
      stepId,
    });
    if (attemptDetails[attempt.id]) return;
    setModalLoading(true);
    try {
      const data = await api(
        withModule(`/api/attempts/${attempt.id}`, moduleId),
      );
      setAttemptDetails((prev) => ({
        ...prev,
        [attempt.id]: data.attempt,
      }));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setModalLoading(false);
    }
  }

  function attachStream(runId) {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setLogs('');
    const es = new EventSource(streamUrl(runId));
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const chunk = JSON.parse(ev.data);
        const line =
          typeof chunk === 'string'
            ? chunk
            : chunk?.line ?? chunk?.text ?? JSON.stringify(chunk);
        setLogs((prev) => prev + line + (line.endsWith('\n') ? '' : '\n'));
      } catch {
        setLogs((prev) => prev + ev.data + '\n');
      }
    };
    es.onerror = () => {
      // 流结束或断连：关闭，随后 refresh 拿最终状态
      es.close();
      if (esRef.current === es) esRef.current = null;
      refresh().catch(() => {});
    };
  }

  // 打开 analyze SSE：先回放缓存，再收增量；POST 返回后关闭
  function attachAnalyzeStream() {
    if (analyzeEsRef.current) {
      analyzeEsRef.current.close();
      analyzeEsRef.current = null;
    }
    setAnalyzeLogs('');
    const es = new EventSource(analyzeStreamUrl());
    analyzeEsRef.current = es;
    es.onmessage = (ev) => {
      try {
        const chunk = JSON.parse(ev.data);
        setAnalyzeLogs((prev) => prev + String(chunk));
      } catch {
        setAnalyzeLogs((prev) => prev + ev.data);
      }
    };
    es.onerror = () => {
      es.close();
      if (analyzeEsRef.current === es) analyzeEsRef.current = null;
    };
  }

  function detachAnalyzeStream() {
    if (analyzeEsRef.current) {
      analyzeEsRef.current.close();
      analyzeEsRef.current = null;
    }
  }

  async function onAnalyze(note = '') {
    if (!selected || busy) return;
    if (aiSlot.busy) {
      setError(`AI 正在运行（${aiSlot.kind || 'unknown'}）`);
      return;
    }
    const regressionNote = typeof note === 'string' ? note.trim() : '';
    setBusy(true);
    setAnalyzing(true);
    setTaskKind('analyze');
    setTaskStartedAt(Date.now());
    setNowTs(Date.now());
    setTaskFailed(false);
    setHandoff('');
    setError('');
    attachAnalyzeStream();
    // analyze 路由会先落一条空轮次，再等待 Claude；稍后刷新即可显示「生成中」。
    window.setTimeout(() => refresh().catch(() => {}), 100);
    try {
      const data = await api(
        withModule(
          `/api/features/${encodeURIComponent(selected.code)}/analyze`,
          moduleId,
        ),
        {
          method: 'POST',
          body: JSON.stringify({
            module: moduleId,
            ...(regressionNote ? { note: regressionNote } : {}),
          }),
        },
      );
      setRationale(data.rationale || '');
      setRisks(Array.isArray(data.risks) ? data.risks : []);
      setDiffText(data.session?.diff || '');
      setFilesJson(JSON.stringify(data.files || [], null, 2));
      setStepFiles(Array.isArray(data.steps) ? data.steps : []);
      if (regressionNote) setRegenerateNote('');
      setAttemptDetails({});
      await refresh();
      setHandoff('脚本已生成，下一步：确认测试步骤');
      scrollTo(currentDetailRef);
    } catch (e) {
      setTaskFailed(true);
      setError(String(e.message || e));
    } finally {
      setBusy(false);
      setAnalyzing(false);
      detachAnalyzeStream();
    }
  }

  async function onAbortAnalyze() {
    try {
      await api('/api/analyze/abort', { method: 'POST', body: '{}' });
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function onDiagnose(
    hint = diagnosisHint.trim(),
    saveAsFeatureNote = saveHintAsNote,
  ) {
    if (!selected || busy) return;
    if (aiSlot.busy) {
      setError(`AI 正在运行（${aiSlot.kind || 'unknown'}）`);
      return;
    }
    setBusy(true);
    setDiagnosing(true);
    setTaskKind('diagnose');
    setTaskStartedAt(Date.now());
    setNowTs(Date.now());
    setTaskFailed(false);
    setHandoff('');
    setDiagnosis('');
    setError('');
    attachAnalyzeStream();
    try {
      const data = await api(
        withModule(
          `/api/features/${encodeURIComponent(selected.code)}/diagnose`,
          moduleId,
        ),
        {
          method: 'POST',
          body: JSON.stringify({
            module: moduleId,
            hint,
            saveAsFeatureNote,
          }),
        },
      );
      setDiagnosis(data.text || '（无输出）');
      setDiagnosisHint('');
      setSaveHintAsNote(false);
      setAttemptDetails({});
      await refresh();
      setHandoff('诊断完成，确认是脚本问题就按诊断生成 Diff');
      scrollTo(currentDetailRef);
    } catch (e) {
      setTaskFailed(true);
      setError(String(e.message || e));
    } finally {
      setBusy(false);
      setDiagnosing(false);
      detachAnalyzeStream();
    }
  }

  async function onApply() {
    if (!selected || !pending || busy) return;
    setBusy(true);
    setError('');
    try {
      let editedFiles;
      const trimmed = filesJson.trim();
      if (trimmed) {
        editedFiles = JSON.parse(trimmed);
        if (!Array.isArray(editedFiles)) {
          throw new Error('editedFiles 必须是 JSON 数组');
        }
      }
      await api(
        withModule(
          `/api/features/${encodeURIComponent(selected.code)}/apply`,
          moduleId,
        ),
        {
          method: 'POST',
          body: JSON.stringify({
            module: moduleId,
            sessionId: pending.id,
            ...(editedFiles ? { editedFiles } : {}),
          }),
        },
      );
      setAttemptDetails({});
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    const note = rejectNote.trim();
    if (!selected || !pending || busy || !note) return;
    setBusy(true);
    setError('');
    try {
      await api(
        withModule(
          `/api/features/${encodeURIComponent(selected.code)}/reject`,
          moduleId,
        ),
        {
          method: 'POST',
          body: JSON.stringify({
            module: moduleId,
            sessionId: pending.id,
            note,
          }),
        },
      );
      setRationale('');
      setRisks([]);
      setDiffText('');
      setFilesJson('');
      setRejectNote('');
      setAttemptDetails({});
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    if (!selected || !flows[0] || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/flows/${flows[0].id}/run`, {
        method: 'POST',
        body: '{}',
      });
      const run = data.run;
      setAttemptDetails({});
      if (run?.id != null) attachStream(run.id);
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onAbort() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/runs/abort', { method: 'POST', body: '{}' });
      setAttemptDetails({});
      await refresh();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCatalogPropose(hint) {
    setCatalogBusy(true);
    setCatalogError('');
    setCatalogAnalyzing(true);
    setCatalogLogs('');
    try {
      const data = await postCatalogPropose(moduleId, hint);
      setCatalogPending(data.session);
      setCatalogDraft(data.draft);
      setCatalogLogs('');
    } catch (e) {
      setCatalogError(String(e.message || e));
    } finally {
      setCatalogBusy(false);
      setCatalogAnalyzing(false);
    }
  }

  async function handleCatalogApply(sessionId) {
    setCatalogBusy(true);
    setCatalogError('');
    try {
      await postCatalogApply(moduleId, sessionId);
      setCatalogMode(false);
      setCatalogPending(null);
      setCatalogDraft(null);
      await refresh();
    } catch (e) {
      setCatalogError(String(e.message || e));
    } finally {
      setCatalogBusy(false);
    }
  }

  async function handleCatalogReject(sessionId, note) {
    setCatalogBusy(true);
    setCatalogError('');
    try {
      await postCatalogReject(moduleId, sessionId, note);
      setCatalogPending(null);
      setCatalogDraft(null);
    } catch (e) {
      setCatalogError(String(e.message || e));
    } finally {
      setCatalogBusy(false);
    }
  }

  function handleCatalogBack() {
    setCatalogMode(false);
    setCatalogError('');
  }

  async function handleCreateModule() {
    const id = newModuleId.trim().toLowerCase();
    const title = newModuleTitle.trim();

    setModuleError('');

    if (!id || !/^[a-z0-9-]{2,20}$/.test(id)) {
      setModuleError('ID 只能是小写字母/数字/连字符，长度 2-20');
      return;
    }
    if (!title) {
      setModuleError('标题必填');
      return;
    }

    try {
      await createModule(id, title);
      const data = await getModules();
      setModules(data.modules || DEFAULT_MODULES);
      setShowAddModule(false);
      setNewModuleId('');
      setNewModuleTitle('');
      switchModule(id);
    } catch (e) {
      setModuleError(String(e.message || e));
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>真机回归控制台</h1>
        <div className="cards">
          <div className="card">
            <div className="k">已通过</div>
            <div className="v">
              {passed}
              <small> / {features.length}</small>
            </div>
          </div>
          <div className="card">
            <div className="k">运行中</div>
            <div className="v">{running}</div>
          </div>
          <div className="card now">
            <div className="k">当前卡在</div>
            <div className="v">{stuck}</div>
          </div>
        </div>
      </div>

      <div className="module-tabs">
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === moduleId ? 'active' : ''}
            onClick={() => switchModule(m.id)}
          >
            {m.title}
          </button>
        ))}
        <button
          type="button"
          className="module-add"
          onClick={() => setShowAddModule(true)}
        >
          +
        </button>
      </div>

      <div className="board">
        <aside className="col-left">
          <div className="catalog-entry">
            <button
              type="button"
              className={catalogMode ? 'active' : ''}
              onClick={() => {
                setCatalogMode(!catalogMode);
                setCatalogError('');
              }}
            >
              + 补功能点
            </button>
          </div>
          {byChapter.map(([chapter, rows]) => (
            <div className="chapter" key={chapter}>
              <div className="chapter-hd">
                {chapter}.{' '}
                {(CHAPTER_TITLES[moduleId] || {})[chapter] ??
                  `第 ${chapter} 章`}
              </div>
              {rows.map((f) => (
                <div
                  key={f.code}
                  className={`feat-row${f.code === selectedCode ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedCode(f.code);
                    setError('');
                  }}
                >
                  <span className="feat-code">{f.code}</span>
                  <span className="feat-title">{f.title}</span>
                  <span className={`pill ${pillClass(f.status)}`}>{f.status}</span>
                </div>
              ))}
            </div>
          ))}
          {features.length === 0 && (
            <div className="empty">
              {moduleId === 'todo'
                ? '暂无功能点。请先启动 API 服务并导入。'
                : `${MODULES.find((m) => m.id === moduleId)?.title || moduleId} 模块还没有功能点。在 src/seed/${moduleId}.js 里加 seed 即可。`}
            </div>
          )}
        </aside>

        <section className="col-right">
          {catalogMode ? (
            <CatalogPanel
              moduleId={moduleId}
              pending={catalogPending}
              draft={catalogDraft}
              busy={catalogBusy}
              error={catalogError}
              analyzing={catalogAnalyzing}
              analyzeLogs={catalogLogs}
              onPropose={handleCatalogPropose}
              onApply={handleCatalogApply}
              onReject={handleCatalogReject}
              onBack={handleCatalogBack}
            />
          ) : !selected ? (
            <div className="empty">选择左侧功能点</div>
          ) : (
            <>
              <div className="detail-hd">
                <span className="code">{selected.code}</span>
                <h2>{selected.title}</h2>{' '}
                <span className={`pill ${pillClass(selected.status)}`}>
                  {selected.status}
                </span>
                {error && <div className="err">{error}</div>}
              </div>

              <div className="flow-body">
                <section className="explanation-card">
                  <div className="flow-hd">
                    <span className="flow-title">说明</span>
                  </div>
                  <div className="flow-content">
                    <div className="meta-block">
                      <div className="label">判定依据</div>
                      <div className="val">{selected.criteria || '—'}</div>
                    </div>
                    <div className="meta-block">
                      <div className="label">数据前提</div>
                      <div className="val">{selected.precondition || '—'}</div>
                    </div>
                    {selected.notes ? (
                      <div className="meta-block">
                        <div className="label">备注</div>
                        <div className="val">{selected.notes}</div>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="timeline-card">
                  <div className="timeline-card-hd">
                    <h3>测试轮次</h3>
                    <span>点击步骤查看详情</span>
                  </div>
                  <AttemptTimeline
                    attempts={attempts}
                    currentAttemptId={latestAttempt?.id ?? null}
                    currentStepId={step}
                    onStepClick={openAttemptStep}
                  />
                </section>

                <CurrentDetail stepId={step} innerRef={currentDetailRef}>
                  {step === 'blocked' ? (
                    <div className="flow-note">{blockedReason}</div>
                  ) : null}

                  {step === 'generate' ? (
                    <>
                      <p className="flow-hint">
                        Claude 只生成脚本 Diff，确认中文步骤后才会写入。
                      </p>
                      <div className="flow-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={onAnalyze}
                        >
                          {analyzing ? '生成中…' : '生成脚本 Diff'}
                        </button>
                      </div>
                      {taskKind === 'analyze' &&
                      (analyzing || analyzeLogs) ? (
                        <TaskPanel
                          stages={ANALYZE_STAGES}
                          stageIndex={stageIndexOf('analyze', analyzeLogs)}
                          running={analyzing}
                          elapsedMs={elapsedMs}
                          logs={analyzeLogs}
                          onAbort={onAbortAnalyze}
                          failed={taskFailed}
                        />
                      ) : null}
                    </>
                  ) : null}

                  {step === 'review' ? (
                    pending ? (
                      <>
                        <p className="flow-hint">
                          只需确认下面的中文测试步骤是否正确。
                        </p>
                        <StepList files={stepFiles} />
                        <div className="meta-block">
                          <div className="label">风险</div>
                          <div className="val">
                            {risks.length
                              ? risks.map((risk) => `· ${risk}`).join('\n')
                              : '—'}
                          </div>
                        </div>
                        <details className="task-log">
                          <summary>查看技术内容</summary>
                          <div className="meta-block">
                            <div className="label">生成依据</div>
                            <div className="val">{rationale || '—'}</div>
                          </div>
                          <pre className="diff-pre">{diffText || '（无 Diff）'}</pre>
                          <textarea
                            className="files-edit"
                            value={filesJson}
                            onChange={(event) =>
                              setFilesJson(event.target.value)
                            }
                            disabled={busy}
                          />
                        </details>
                        <RegressionNoteInput
                          label="打回原因"
                          value={rejectNote}
                          onChange={setRejectNote}
                        />
                        <div className="flow-actions">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={onApply}
                          >
                            批准写入
                          </button>
                          <button
                            className="danger"
                            disabled={busy || !rejectNote.trim()}
                            onClick={onReject}
                          >
                            打回
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="flow-hint">本轮测试步骤已打回。</p>
                        <RegressionNoteInput
                          label="重生成备注"
                          value={regenerateNote}
                          onChange={setRegenerateNote}
                        />
                        <button
                          className="primary"
                          disabled={busy || !regenerateNote.trim()}
                          onClick={() => onAnalyze(regenerateNote)}
                        >
                          重新生成
                        </button>
                      </>
                    )
                  ) : null}

                  {step === 'run' ? (
                    <>
                      <div className="meta-block">
                        <div className="label">绑定 flow</div>
                        <div className="val">
                          {flows.length
                            ? flows.map((flow) => flow.path).join('\n')
                            : '（无）'}
                        </div>
                      </div>
                      <div className="flow-actions">
                        {selected.status === STATUS.RUNNING ? (
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={onAbort}
                          >
                            中止
                          </button>
                        ) : (
                          <button
                            className="primary"
                            disabled={busy || !flows[0]}
                            onClick={onRun}
                          >
                            {latestAttempt?.run_count ? '再跑一次' : '执行'}
                          </button>
                        )}
                      </div>
                      {logs ? (
                        <details
                          className="task-log"
                          open={selected.status === STATUS.RUNNING}
                        >
                          <summary>运行日志</summary>
                          <pre className="log-pre">{logs}</pre>
                        </details>
                      ) : null}
                    </>
                  ) : null}

                  {step === 'failed' ? (
                    <>
                      <div className="result-banner failed">
                        最近一次执行失败
                        {latestAttempt?.latest_run?.failed_step ? (
                          <small>
                            {latestAttempt.latest_run.failed_step}
                          </small>
                        ) : null}
                      </div>
                      <div className="flow-actions">
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => onDiagnose('', false)}
                        >
                          {diagnosing ? '诊断中…' : '诊断失败原因'}
                        </button>
                        <button disabled={busy} onClick={onRun}>
                          再跑一次
                        </button>
                      </div>
                    </>
                  ) : null}

                  {step === 'diagnose' ? (
                    <>
                      <div className="flow-actions">
                        <button
                          className={diagnosisHistory.length ? '' : 'primary'}
                          disabled={busy}
                          onClick={() => onDiagnose('', false)}
                        >
                          {diagnosing
                            ? '诊断中…'
                            : diagnosisHistory.length
                              ? '重新诊断'
                              : '诊断失败原因'}
                        </button>
                        <button disabled={busy} onClick={onRun}>
                          再跑一次
                        </button>
                      </div>
                      {taskKind === 'diagnose' &&
                      (diagnosing || analyzeLogs) ? (
                        <TaskPanel
                          stages={DIAGNOSE_STAGES}
                          stageIndex={stageIndexOf('diagnose', analyzeLogs)}
                          running={diagnosing}
                          elapsedMs={elapsedMs}
                          logs={analyzeLogs}
                          onAbort={onAbortAnalyze}
                          failed={taskFailed}
                        />
                      ) : null}
                      <DiagnosisConversation turns={diagnosisHistory} />
                      {diagnosisFresh ? (
                        <>
                          <div className="diagnosis-hint">
                            <label htmlFor="diagnosis-hint-current">
                              补充现场线索
                            </label>
                            <textarea
                              id="diagnosis-hint-current"
                              value={diagnosisHint}
                              maxLength={2000}
                              disabled={busy}
                              onChange={(event) =>
                                setDiagnosisHint(event.target.value)
                              }
                              placeholder="例如：弹窗已经打开；点击保存后页面没有关闭……"
                            />
                            <div className="diagnosis-hint-foot">
                              <label className="check-label">
                                <input
                                  type="checkbox"
                                  checked={saveHintAsNote}
                                  disabled={busy || !diagnosisHint.trim()}
                                  onChange={(event) =>
                                    setSaveHintAsNote(event.target.checked)
                                  }
                                />
                                保存为功能备注
                              </label>
                              <span>{diagnosisHint.length}/2000</span>
                            </div>
                          </div>
                          <RegressionNoteInput
                            label="重生成备注"
                            value={regenerateNote}
                            onChange={setRegenerateNote}
                          />
                          <div className="flow-actions">
                            <button
                              disabled={busy || !diagnosisHint.trim()}
                              onClick={() => onDiagnose()}
                            >
                              带线索重新诊断
                            </button>
                            <button
                              className="primary"
                              disabled={busy || !regenerateNote.trim()}
                              onClick={() => onAnalyze(regenerateNote)}
                            >
                              按诊断生成下一轮
                            </button>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {step === 'passed' ? (
                    <>
                      <div className="result-banner passed">本轮执行通过</div>
                      <RegressionNoteInput
                        label="重生成备注"
                        value={regenerateNote}
                        onChange={setRegenerateNote}
                      />
                      <div className="flow-actions">
                        <button disabled={busy} onClick={onRun}>
                          原脚本再跑一次
                        </button>
                        <button
                          className="primary"
                          disabled={busy || !regenerateNote.trim()}
                          onClick={() => onAnalyze(regenerateNote)}
                        >
                          重新生成，开启下一轮
                        </button>
                      </div>
                    </>
                  ) : null}

                  {handoff ? (
                    <div className="flow-note handoff">{handoff}</div>
                  ) : null}
                </CurrentDetail>

                <StepModal
                  modal={stepModal}
                  detail={
                    stepModal
                      ? attemptDetails[stepModal.attemptId] ?? null
                      : null
                  }
                  loading={modalLoading}
                  onClose={closeStepModal}
                />

                <div className="legacy-flow" hidden aria-hidden="true">
                {/* ① 说明 */}
                <section className="flow-step">
                  <div className="flow-hd">
                    <span className="flow-num">1</span>
                    <span className="flow-title">说明</span>
                  </div>
                  <div className="flow-content">
                    <div className="meta-block">
                      <div className="label">判定依据</div>
                      <div className="val">{selected.criteria || '—'}</div>
                    </div>
                    <div className="meta-block">
                      <div className="label">数据前提</div>
                      <div className="val">{selected.precondition || '—'}</div>
                    </div>
                    {selected.notes ? (
                      <div className="meta-block">
                        <div className="label">备注</div>
                        <div className="val">{selected.notes}</div>
                      </div>
                    ) : null}
                    {step === 'blocked' && (
                      <div className="flow-note">{blockedReason}</div>
                    )}
                  </div>
                </section>

                {/* ② AI 分析 */}
                <section
                  className={
                    step === 'analyze' ? 'flow-step current' : 'flow-step'
                  }
                >
                  <div className="flow-hd">
                    <span className="flow-num">2</span>
                    <span className="flow-title">AI 分析</span>
                    {pending ? <span className="flow-tag">已有 Diff</span> : null}
                  </div>
                  <div className="flow-content">
                    {step === 'analyze' ? (
                      <>
                        <p className="flow-hint">
                          Claude 只产出 Diff，不会直接写盘。批准后才会落到{' '}
                          <code>maestro/**</code>。
                        </p>
                        <div className="flow-actions">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={onAnalyze}
                          >
                            {analyzing ? '生成中…' : '生成脚本 Diff'}
                          </button>
                        </div>
                      </>
                    ) : step === 'blocked' ? (
                      <p className="flow-hint muted">此状态不开放生成。</p>
                    ) : step === 'review' ? (
                      <p className="flow-hint muted">
                        先处理下方 Diff（批准或打回）。
                      </p>
                    ) : (
                      <div className="flow-actions secondary">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={onAnalyze}
                        >
                          {analyzing ? '生成中…' : '重新生成 Diff'}
                        </button>
                      </div>
                    )}
                    {taskKind === 'analyze' && (analyzing || analyzeLogs) && (
                      <TaskPanel
                        stages={ANALYZE_STAGES}
                        stageIndex={stageIndexOf('analyze', analyzeLogs)}
                        running={analyzing}
                        elapsedMs={elapsedMs}
                        logs={analyzeLogs}
                        onAbort={onAbortAnalyze}
                        failed={taskFailed}
                      />
                    )}
                    {taskKind === 'analyze' && handoff && !analyzing && (
                      <div className="flow-note handoff">
                        {handoff}
                        <button
                          type="button"
                          onClick={() => scrollTo(reviewRef)}
                        >
                          去确认
                        </button>
                      </div>
                    )}
                  </div>
                </section>

                {/* ③ Diff 审阅 */}
                <section
                  ref={reviewRef}
                  className={
                    step === 'review' ? 'flow-step current' : 'flow-step'
                  }
                >
                  <div className="flow-hd">
                    <span className="flow-num">3</span>
                    <span className="flow-title">确认测试步骤</span>
                    {pending ? (
                      <span className="flow-tag">pending #{pending.id}</span>
                    ) : null}
                  </div>
                  <div className="flow-content">
                    {pending || step === 'review' ? (
                      <>
                        <p className="flow-hint">
                          下面是脚本实际会执行的步骤（由 YAML 翻译而来，不是 AI 自述）。
                          步骤对就批准，不对就打回重生成。
                        </p>
                        <StepList files={stepFiles} />
                        <div className="meta-block">
                          <div className="label">风险</div>
                          <div className="val">
                            {risks.length
                              ? risks.map((r) => `· ${r}`).join('\n')
                              : '—'}
                          </div>
                        </div>
                        <details className="task-log">
                          <summary>查看 YAML 与依据</summary>
                          <div className="meta-block" style={{ marginTop: 10 }}>
                            <div className="label">依据（rationale）</div>
                            <div className="val">{rationale || '—'}</div>
                          </div>
                          <pre className="diff-pre">
                            {diffText || '（无 Diff）'}
                          </pre>
                        </details>
                        <details className="task-log">
                          <summary>手工修改 files JSON</summary>
                          <textarea
                            className="files-edit"
                            value={filesJson}
                            onChange={(e) => setFilesJson(e.target.value)}
                            placeholder='[{"path":"maestro/...yaml","content":"..."}]'
                            disabled={!pending || busy}
                          />
                        </details>
                        {step === 'review' && (
                          <div className="flow-actions">
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={onApply}
                            >
                              批准写入
                            </button>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={onReject}
                            >
                              打回
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="flow-hint muted">
                        生成完成后，测试步骤会出现在这里。
                      </p>
                    )}
                  </div>
                </section>

                {/* ④ 执行 */}
                <section
                  className={
                    step === 'run' || step === 'abort' || step === 'rerun'
                      ? 'flow-step current'
                      : 'flow-step'
                  }
                >
                  <div className="flow-hd">
                    <span className="flow-num">4</span>
                    <span className="flow-title">执行</span>
                  </div>
                  <div className="flow-content">
                    <div className="meta-block">
                      <div className="label">绑定 flow</div>
                      <div className="val">
                        {flows.length
                          ? flows.map((f) => f.path).join('\n')
                          : '（无）'}
                      </div>
                    </div>
                    {(step === 'run' || step === 'rerun') && (
                      <div className="flow-actions">
                        <button
                          className="primary"
                          disabled={busy || !flows[0]}
                          onClick={onRun}
                        >
                          {step === 'rerun' ? '再跑一次' : '执行'}
                        </button>
                      </div>
                    )}
                    {step === 'abort' && (
                      <div className="flow-actions">
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={onAbort}
                        >
                          中止
                        </button>
                      </div>
                    )}
                    {step === 'blocked' && (
                      <p className="flow-hint muted">此状态不开放执行。</p>
                    )}
                    {!flows.length &&
                      step !== 'blocked' &&
                      step !== 'analyze' &&
                      step !== 'review' && (
                        <p className="flow-hint muted">
                          还没有绑定 flow；批准写入后会出现路径。
                        </p>
                      )}
                    {logs ? (
                      <details
                        className="task-log"
                        open={step === 'abort'}
                      >
                        <summary>运行日志</summary>
                        <pre className="log-pre">{logs}</pre>
                      </details>
                    ) : null}
                  </div>
                </section>

                {/* ⑤ 失败诊断：只读产物、只出文字，不写盘 */}
                <section
                  ref={diagnoseRef}
                  className={
                    selected.status === STATUS.FAILED
                      ? 'flow-step current'
                      : 'flow-step'
                  }
                >
                  <div className="flow-hd">
                    <span className="flow-num">5</span>
                    <span className="flow-title">失败诊断</span>
                    {selected.status === STATUS.FAILED && (
                      <span className="flow-tag">有失败可诊断</span>
                    )}
                  </div>
                  <div className="flow-content">
                    {selected.status === STATUS.FAILED ? (
                      <>
                        <p className="flow-hint">
                          读最近一次失败的 maestro 输出与失败瞬间 UI 层级，
                          只给文字结论；不改脚本、不动状态。
                        </p>
                        <div className="flow-actions">
                          <button
                            className={diagnosisHistory.length ? '' : 'primary'}
                            disabled={busy}
                            onClick={() => onDiagnose('', false)}
                          >
                            {diagnosing
                              ? '诊断中…'
                              : diagnosisHistory.length
                                ? '重新诊断（不补充线索）'
                                : '诊断失败原因'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="flow-hint muted">
                        仅在最近一次执行失败后可用。
                      </p>
                    )}
                    {taskKind === 'diagnose' && (diagnosing || analyzeLogs) && (
                      <TaskPanel
                        stages={DIAGNOSE_STAGES}
                        stageIndex={stageIndexOf('diagnose', analyzeLogs)}
                        running={diagnosing}
                        elapsedMs={elapsedMs}
                        logs={analyzeLogs}
                        onAbort={onAbortAnalyze}
                        failed={taskFailed}
                      />
                    )}
                    <DiagnosisConversation turns={diagnosisHistory} />
                    {diagnosisFresh && (
                      <>
                        <div className="diagnosis-hint">
                          <label htmlFor="diagnosis-hint">补充现场线索</label>
                          <textarea
                            id="diagnosis-hint"
                            value={diagnosisHint}
                            maxLength={2000}
                            disabled={busy}
                            onChange={(e) => setDiagnosisHint(e.target.value)}
                            placeholder="例如：弹窗已经打开；点击保存后页面没有关闭；接口返回 500……"
                          />
                          <div className="diagnosis-hint-foot">
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={saveHintAsNote}
                                disabled={busy || !diagnosisHint.trim()}
                                onChange={(e) =>
                                  setSaveHintAsNote(e.target.checked)
                                }
                              />
                              保存为功能备注，影响后续运行
                            </label>
                            <span>{diagnosisHint.length}/2000</span>
                          </div>
                          <button
                            type="button"
                            className="primary"
                            disabled={busy || !diagnosisHint.trim()}
                            onClick={() => onDiagnose()}
                          >
                            带线索重新诊断
                          </button>
                        </div>
                        <p className="flow-hint">
                          确认是脚本问题后，可带着这份结论重新生成脚本——
                          Claude 会收到「上一轮为什么失败」，不会再写出同一个错的选择器。
                          仍然只出 Diff，需你批准才写盘。
                        </p>
                        <div className="flow-actions">
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={onAnalyze}
                          >
                            {analyzing ? '生成中…' : '按诊断生成脚本 Diff'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* ⑥ 本会话历史 */}
                <section className="flow-step">
                  <div className="flow-hd">
                    <span className="flow-num">6</span>
                    <span className="flow-title">本会话执行记录</span>
                  </div>
                  <div className="flow-content">
                    {history.filter((h) => h.code === selected.code).length ===
                    0 ? (
                      <p className="flow-hint muted">—</p>
                    ) : (
                      <table className="hist">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>run</th>
                            <th>path</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history
                            .filter((h) => h.code === selected.code)
                            .map((h) => (
                              <tr key={`${h.runId}-${h.at}`}>
                                <td>{h.at}</td>
                                <td>{h.runId}</td>
                                <td>{h.path}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {showAddModule && (
        <div className="modal-backdrop" onClick={() => setShowAddModule(false)}>
          <div className="step-modal" onClick={(e) => e.stopPropagation()}>
            <div className="step-modal-hd">
              <h3>添加新模块</h3>
              <button onClick={() => setShowAddModule(false)}>×</button>
            </div>
            <div className="step-modal-body">
              {moduleError && <div className="err">{moduleError}</div>}
              <div className="module-form">
                <label>
                  模块 ID
                  <input
                    type="text"
                    value={newModuleId}
                    onChange={(e) => setNewModuleId(e.target.value)}
                    placeholder="例如：shopping"
                    pattern="[a-z0-9-]{2,20}"
                  />
                  <small>小写字母/数字/连字符，长度 2-20</small>
                </label>
                <label>
                  模块标题
                  <input
                    type="text"
                    value={newModuleTitle}
                    onChange={(e) => setNewModuleTitle(e.target.value)}
                    placeholder="例如：购物清单"
                    maxLength={50}
                  />
                </label>
                <div className="flow-actions">
                  <button className="primary" onClick={handleCreateModule}>
                    创建
                  </button>
                  <button onClick={() => setShowAddModule(false)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
