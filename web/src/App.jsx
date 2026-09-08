import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  bootstrapToken,
  getModules,
  getSavedModule,
  createModule,
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


function flowKindFlow(flows) {
  return (flows || []).filter((f) => f.kind === 'flow');
}

/**
 * 当前流程主步骤：决定右侧哪一段高亮、露哪个主按钮。
 * @returns {'blocked'|'analyze'|'review'|'run'|'abort'|'rerun'|'idle'}
 */

function resolveStep(feature, flows) {
  if (!feature) return 'idle';
  if (
    feature.status === STATUS.MANUAL ||
    feature.status === STATUS.FALSE_GREEN
  ) {
    return 'blocked';
  }
  if (feature.status === STATUS.RUNNING) return 'abort';
  if (
    feature.status === STATUS.PENDING_RUN ||
    (feature.status === STATUS.FAILED && flows.length > 0)
  ) {
    return 'run';
  }
  if (feature.status === STATUS.FAILED) return 'failed';
  if (feature.status === STATUS.PASSED && flows.length > 0) return 'rerun';
  return 'idle';
}

export default function App() {
  const [moduleId, setModuleId] = useState(() => getSavedModule('todo'));
  const [features, setFeatures] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState('');
  const [stepModal, setStepModal] = useState(null);
  const [attemptDetails, setAttemptDetails] = useState({});
  const [modalLoading, setModalLoading] = useState(false);
  const [catalogMode, setCatalogMode] = useState(false);
  const [modules, setModules] = useState(DEFAULT_MODULES);
  const [showAddModule, setShowAddModule] = useState(false);
  const [newModuleId, setNewModuleId] = useState('');
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [moduleError, setModuleError] = useState('');
  const esRef = useRef(null);
  const currentDetailRef = useRef(null);

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

  const flows = flowKindFlow(selected?.flows);

  // 换功能点就清掉状态
  useEffect(() => {
    setStepModal(null);
    setAttemptDetails({});
  }, [selectedCode, moduleId]);

  const attempts = selected?.attempts ?? [];
  const latestAttempt = attempts.at(-1) ?? null;

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
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
  const legacyStep = resolveStep(selected, flows);
  const step = selected?.status === STATUS.MANUAL ||
    selected?.status === STATUS.FALSE_GREEN
    ? 'blocked'
    : latestAttempt
      ? resolveCurrentStep(latestAttempt)
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

  function handleCatalogBack() {
    setCatalogMode(false);
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
            <div className="k">通过</div>
            <div className="v">
              {passed}
              <small>/{features.length}</small>
            </div>
          </div>
          <div className="card">
            <div className="k">运行中</div>
            <div className="v">{running}</div>
          </div>
          <div className="card now">
            <div className="k">卡在</div>
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
                : `${DEFAULT_MODULES.find((m) => m.id === moduleId)?.title || moduleId} 模块还没有功能点。在 src/seed/${moduleId}.js 里加 seed 即可。`}
            </div>
          )}
        </aside>

        <section className="col-right">
          {catalogMode ? (
            <CatalogPanel
              moduleId={moduleId}
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
                        <button disabled={busy} onClick={onRun}>
                          再跑一次
                        </button>
                      </div>
                    </>
                  ) : null}

                  {step === 'passed' ? (
                    <>
                      <div className="result-banner passed">本轮执行通过</div>
                      <div className="flow-actions">
                        <button disabled={busy} onClick={onRun}>
                          原脚本再跑一次
                        </button>
                      </div>
                    </>
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
