import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttemptSteps,
  resolveCurrentStep,
} from '../web/src/attemptViewModel.js';

function attempt(overrides = {}) {
  return {
    id: 1,
    sequence: 1,
    status: 'open',
    hint: '',
    analyze_session_id: null,
    analyze_decision: null,
    run_count: 0,
    latest_run: null,
    diagnosis_count: 0,
    ...overrides,
  };
}

describe('attempt timeline view model', () => {
  it('shows only generation while the first analyze is running', () => {
    const row = attempt();
    assert.deepEqual(
      buildAttemptSteps(row).map((step) => [step.id, step.state]),
      [['generate', 'active']],
    );
    assert.equal(resolveCurrentStep(row), 'generate');
  });

  it('moves from pending review to approved execution', () => {
    const reviewing = attempt({
      analyze_session_id: 8,
      analyze_decision: 'pending',
      status: 'reviewing',
    });
    assert.equal(resolveCurrentStep(reviewing), 'review');

    const approved = attempt({
      analyze_session_id: 8,
      analyze_decision: 'approved',
    });
    assert.deepEqual(
      buildAttemptSteps(approved).map((step) => step.id),
      ['generate', 'review', 'run'],
    );
    assert.equal(resolveCurrentStep(approved), 'run');
  });

  it('collapses reruns into one execution node', () => {
    const row = attempt({
      analyze_session_id: 8,
      analyze_decision: 'approved',
      status: 'failed',
      run_count: 2,
      latest_run: { id: 12, ended_at: '2026-09-08', exit_code: 1 },
    });
    const run = buildAttemptSteps(row).find((step) => step.id === 'run');
    assert.equal(run.summary, '共 2 次，最近失败');
    assert.equal(resolveCurrentStep(row), 'failed');
  });

  it('makes diagnosis current after a failed run has diagnosis turns', () => {
    const row = attempt({
      analyze_session_id: 8,
      analyze_decision: 'approved',
      status: 'failed',
      run_count: 1,
      latest_run: { id: 12, ended_at: '2026-09-08', exit_code: 1 },
      diagnosis_count: 2,
    });
    assert.deepEqual(
      buildAttemptSteps(row).map((step) => step.id),
      ['generate', 'review', 'run', 'failed', 'diagnose'],
    );
    assert.equal(resolveCurrentStep(row), 'diagnose');
  });

  it('shows hint first and passed as the terminal current step', () => {
    const row = attempt({
      sequence: 2,
      hint: '保存后弹窗没有关闭',
      analyze_session_id: 9,
      analyze_decision: 'approved',
      status: 'passed',
      run_count: 1,
      latest_run: { id: 13, ended_at: '2026-09-08', exit_code: 0 },
    });
    assert.deepEqual(
      buildAttemptSteps(row).map((step) => step.id),
      ['hint', 'generate', 'review', 'run', 'passed'],
    );
    assert.equal(resolveCurrentStep(row), 'passed');
  });

  it('keeps rejected review as the terminal current step', () => {
    const row = attempt({
      analyze_session_id: 9,
      analyze_decision: 'rejected',
      status: 'rejected',
    });
    assert.equal(resolveCurrentStep(row), 'review');
    assert.equal(
      buildAttemptSteps(row).find((step) => step.id === 'review').state,
      'failed',
    );
  });
});
