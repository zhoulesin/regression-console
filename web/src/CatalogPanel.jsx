import { useState } from 'react';

const REASON_LABELS = {
  duplicate_code: '已有同编号',
  duplicate_title: '已有同标题',
  batch_limit: '超过单次 15 条',
  apply_conflict: '确认入库时编号已被占用',
  invalid: '字段不合法',
};

function groupByReason(skipped) {
  const groups = {};
  for (const item of skipped) {
    const reason = item.reason || 'invalid';
    if (!groups[reason]) groups[reason] = [];
    groups[reason].push(item);
  }
  return Object.entries(groups);
}

export function CatalogPanel({
  moduleId,
  pending,
  draft,
  busy,
  error,
  onPropose,
  onApply,
  onReject,
  onBack,
  analyzing,
  analyzeLogs,
}) {
  const [hint, setHint] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  function handlePropose() {
    if (!hint.trim() || busy) return;
    onPropose(hint.trim());
  }

  function handleApply() {
    if (!pending || busy) return;
    onApply(pending.id);
  }

  function handleReject() {
    if (!pending || busy || !rejectNote.trim()) return;
    onReject(pending.id, rejectNote.trim());
  }

  return (
    <div className="catalog-panel">
      <div className="catalog-hd">
        <button type="button" className="back-btn" onClick={onBack}>
          ← 返回功能点
        </button>
        <h2>补功能点</h2>
      </div>

      {error && <div className="err">{error}</div>}

      {!draft && (
        <div className="catalog-hint-section">
          <label htmlFor="catalog-hint">范围提示（必填）</label>
          <textarea
            id="catalog-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="描述需要补充的功能点范围，例如：Todo 的快速添加和完整创建流程"
            disabled={busy || analyzing}
            maxLength={2000}
          />
          <div className="hint-footer">
            <span>{hint.length}/2000</span>
            <button
              type="button"
              className="primary"
              onClick={handlePropose}
              disabled={busy || analyzing || !hint.trim()}
            >
              {analyzing ? '生成中...' : '开始生成'}
            </button>
          </div>
        </div>
      )}

      {analyzing && (
        <div className="catalog-generating">
          <div className="generating-header">
            <span className="generating-icon">⏳</span>
            <span>AI 正在生成功能点...</span>
          </div>
          {analyzeLogs && (
            <pre className="generating-logs">{analyzeLogs}</pre>
          )}
        </div>
      )}

      {draft && !analyzing && (
        <div className="catalog-review">
          <div className="catalog-rationale">
            <h3>分析依据</h3>
            <p>{draft.rationale}</p>
          </div>

          <div className="catalog-features">
            <h3>新增功能点 ({draft.features.length})</h3>
            {draft.features.length === 0 ? (
              <p className="muted">本次无新增功能点</p>
            ) : (
              <div className="feature-cards">
                {draft.features.map((f) => (
                  <div key={f.code} className="catalog-feature-card">
                    <div className="card-header">
                      <span className="code">{f.code}</span>
                      <span className="chapter">第 {f.chapter} 章</span>
                    </div>
                    <div className="title">{f.title}</div>
                    <div className="criteria">
                      <span className="label">判定依据：</span>
                      {f.criteria}
                    </div>
                    {f.precondition && (
                      <div className="precondition">
                        <span className="label">数据前提：</span>
                        {f.precondition}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {draft.skipped && draft.skipped.length > 0 && (
            <div className="catalog-skipped">
              <h3>已跳过 ({draft.skipped.length})</h3>
              <p className="muted">以下已有条目被跳过，不会改库里的旧条</p>
              {groupByReason(draft.skipped).map(([reason, items]) => (
                <details key={reason} className="skipped-group">
                  <summary>
                    {REASON_LABELS[reason] || reason} ({items.length})
                  </summary>
                  <div className="skipped-items">
                    {items.map((item) => (
                      <div
                        key={`${item.code}-${item.title}`}
                        className="skipped-item"
                      >
                        <span className="code">{item.code}</span>
                        <span className="title">{item.title}</span>
                        {item.detail && (
                          <span className="detail">({item.detail})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}

          <div className="catalog-actions">
            <button
              type="button"
              className="primary"
              onClick={handleApply}
              disabled={busy || !draft.features.length}
            >
              确认入库 ({draft.features.length} 条)
            </button>
            <div className="reject-section">
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="打回原因（必填）"
                disabled={busy}
                maxLength={2000}
              />
              <button
                type="button"
                className="danger"
                onClick={handleReject}
                disabled={busy || !rejectNote.trim()}
              >
                打回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
