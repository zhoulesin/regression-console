import { buildAttemptSteps } from './attemptViewModel.js';

/** 一行代表一轮；历史轮紧凑展示，当前轮和当前节点高亮。 */
export function AttemptTimeline({
  attempts,
  currentAttemptId,
  currentStepId,
  onStepClick,
}) {
  if (!attempts.length) {
    return <p className="attempt-empty">还没有轮次</p>;
  }

  return (
    <div className="attempt-timeline">
      {attempts.map((attempt) => {
        const current = attempt.id === currentAttemptId;
        const steps = buildAttemptSteps(attempt);
        return (
          <div
            className={`attempt-row${current ? ' current' : ''}`}
            key={attempt.id}
          >
            <span className="attempt-branch" aria-hidden="true">
              └─
            </span>
            <span className="attempt-title">第 {attempt.sequence} 轮：</span>
            <div className="attempt-steps">
              {steps.map((step, index) => (
                <span className="attempt-step-wrap" key={step.id}>
                  {index > 0 ? (
                    <span className="attempt-arrow" aria-hidden="true">
                      →
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`attempt-step ${step.state}${
                      current && step.id === currentStepId ? ' current' : ''
                    }`}
                    onClick={() => onStepClick(attempt, step.id)}
                    title={step.summary || `查看${step.label}详情`}
                  >
                    {step.label}
                    {step.summary ? (
                      <small className="attempt-summary">{step.summary}</small>
                    ) : null}
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
