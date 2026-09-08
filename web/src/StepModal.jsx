import { useEffect } from 'react';

const TITLES = {
  hint: '补充线索',
  generate: '生成详情',
  review: '确认详情',
  run: '执行详情',
  failed: '失败详情',
  diagnose: '诊断详情',
  passed: '通过详情',
};

function parseAnalyze(session) {
  try {
    return JSON.parse(session?.response || '{}');
  } catch {
    return {};
  }
}

function Steps({ files = [] }) {
  if (!files.length) return <p className="flow-hint muted">没有步骤记录</p>;
  return (
    <div className="steps">
      {files.map((file) => (
        <div className="steps-file" key={file.path}>
          <div className="steps-path">{file.path}</div>
          <ol className="steps-list">
            {(file.steps || []).map((step, index) => (
              <li key={`${file.path}-${index}`} data-depth={step.depth}>
                {step.text}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function RunRows({ runs = [] }) {
  if (!runs.length) return <p className="flow-hint muted">没有执行记录</p>;
  return (
    <div className="run-list">
      {runs.map((run, index) => (
        <div className="run-card" key={run.id}>
          <div className="run-card-hd">
            第 {index + 1} 次执行
            <span className={run.exit_code === 0 ? 'run-ok' : 'run-bad'}>
              {run.ended_at
                ? run.exit_code === 0
                  ? '通过'
                  : '失败'
                : '执行中'}
            </span>
          </div>
          <div>耗时：{run.duration_ms == null ? '—' : `${run.duration_ms} ms`}</div>
          {run.failed_step ? <div>失败步骤：{run.failed_step}</div> : null}
          {run.artifact_dir ? <div>产物：{run.artifact_dir}</div> : null}
          {run.log_excerpt ? (
            <details className="task-log">
              <summary>查看日志摘要</summary>
              <pre className="log-pre">{run.log_excerpt}</pre>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ModalBody({ detail, stepId }) {
  const payload = parseAnalyze(detail.analyzeSession);
  const latestRun = detail.runs?.at(-1);

  if (stepId === 'hint') return <p>{detail.hint || '—'}</p>;
  if (stepId === 'generate') {
    return (
      <>
        <div className="meta-block">
          <div className="label">生成摘要</div>
          <div className="val">{payload.rationale || '—'}</div>
        </div>
        <div className="meta-block">
          <div className="label">风险</div>
          <div className="val">
            {payload.risks?.length ? payload.risks.join('\n') : '—'}
          </div>
        </div>
      </>
    );
  }
  if (stepId === 'review') {
    return (
      <>
        <div className="modal-result">
          结果：{detail.analyzeSession?.decision || '—'}
        </div>
        <Steps files={payload.steps} />
      </>
    );
  }
  if (stepId === 'run') return <RunRows runs={detail.runs} />;
  if (stepId === 'failed' || stepId === 'passed') {
    return latestRun ? <RunRows runs={[latestRun]} /> : <p>没有结果记录</p>;
  }
  if (stepId === 'diagnose') {
    return (
      <div className="diagnosis-chat">
        {(detail.diagnoses || []).map((turn) => (
          <div className="diagnosis-turn" key={turn.id}>
            {turn.user_hint ? (
              <div className="diagnosis-msg user">
                <div className="label">我的补充</div>
                <div>{turn.user_hint}</div>
              </div>
            ) : null}
            <div className="diagnosis-msg ai">
              <div className="label">AI 诊断</div>
              <pre>{turn.response}</pre>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

/** 历史步骤只读回看；主操作始终留在页面底部。 */
export function StepModal({ modal, detail, loading, onClose }) {
  useEffect(() => {
    if (!modal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, onClose]);

  if (!modal) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="step-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-modal-title"
      >
        <div className="step-modal-hd">
          <h3 id="step-modal-title">
            第 {modal.sequence} 轮 · {TITLES[modal.stepId] || '步骤详情'}
          </h3>
          <button type="button" onClick={onClose} aria-label="关闭详情">
            ×
          </button>
        </div>
        <div className="step-modal-body">
          {loading ? (
            <p className="flow-hint">正在加载…</p>
          ) : detail ? (
            <ModalBody detail={detail} stepId={modal.stepId} />
          ) : (
            <p className="flow-hint muted">详情加载失败</p>
          )}
        </div>
      </section>
    </div>
  );
}
