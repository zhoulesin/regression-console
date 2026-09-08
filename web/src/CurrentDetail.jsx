const TITLES = {
  blocked: '当前：需要人工处理',
  generate: '当前：生成脚本',
  review: '当前：确认测试步骤',
  run: '当前：执行',
  failed: '当前：执行失败',
  diagnose: '当前：失败诊断',
  passed: '当前：执行通过',
};

/** 页面底部唯一主操作区；时间线和历史弹框都不承载操作。 */
export function CurrentDetail({ stepId, innerRef, children }) {
  return (
    <section className="current-detail" ref={innerRef}>
      <div className="current-detail-hd">
        <span className="current-dot" aria-hidden="true" />
        <h3>{TITLES[stepId] || '当前进度'}</h3>
      </div>
      <div className="current-detail-body">{children}</div>
    </section>
  );
}
