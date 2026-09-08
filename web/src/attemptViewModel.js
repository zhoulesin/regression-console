const LABELS = {
  hint: '补充线索',
  generate: '生成',
  review: '确认',
  run: '执行',
  failed: '失败',
  diagnose: '诊断',
  passed: '通过',
};

function node(id, state, summary = '') {
  return { id, label: LABELS[id], state, summary };
}

/** 由持久化轮次摘要生成紧凑时间线，只展示已经发生或当前应处理的节点。 */
export function buildAttemptSteps(attempt) {
  if (!attempt) return [];
  const steps = [];
  if (attempt.hint) steps.push(node('hint', 'done'));

  const decision = attempt.analyze_decision;
  steps.push(node('generate', decision ? 'done' : 'active'));
  if (!decision) return steps;

  const reviewState =
    decision === 'pending'
      ? 'active'
      : decision === 'rejected'
        ? 'failed'
        : 'done';
  steps.push(node('review', reviewState));
  if (decision !== 'approved') return steps;

  const latestRun = attempt.latest_run;
  const runCount = Number(attempt.run_count) || 0;
  let runSummary = '';
  if (runCount > 1) {
    runSummary = `共 ${runCount} 次，最近${
      latestRun?.exit_code === 0 ? '通过' : '失败'
    }`;
  }
  steps.push(
    node(
      'run',
      !latestRun || !latestRun.ended_at ? 'active' : 'done',
      runSummary,
    ),
  );
  if (!latestRun?.ended_at) return steps;

  const failedCount =
    Number(attempt.failed_run_count) ||
    (latestRun.exit_code === 0 ? 0 : 1);
  if (failedCount > 0) steps.push(node('failed', 'failed'));
  if (Number(attempt.diagnosis_count) > 0) {
    steps.push(
      node(
        'diagnose',
        latestRun.exit_code === 0 ? 'done' : 'active',
        attempt.diagnosis_count > 1
          ? `共 ${attempt.diagnosis_count} 次`
          : '',
      ),
    );
  }
  if (latestRun.exit_code === 0) steps.push(node('passed', 'done'));
  return steps;
}

/** 底部详情始终绑定最新轮次的当前节点，不受历史弹框影响。 */
export function resolveCurrentStep(attempt) {
  if (!attempt) return 'generate';
  if (!attempt.analyze_decision) return 'generate';
  if (attempt.analyze_decision !== 'approved') return 'review';
  const latestRun = attempt.latest_run;
  if (!latestRun || !latestRun.ended_at) return 'run';
  if (latestRun.exit_code === 0) return 'passed';
  return Number(attempt.diagnosis_count) > 0 ? 'diagnose' : 'failed';
}
