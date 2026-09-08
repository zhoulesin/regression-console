import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDiagnosisConversation,
  buildFailureContext,
  parseArtifactDir,
  parseFailedStep,
} from '../src/failureContext.js';

// 取自真实一次失败的 maestro stdout
const REAL_LOG = `Running on EW400003C
 > Flow Todo full create from root add button
  Tap on id: com.cozyla.choresreward:id/todoListLayout... COMPLETED
Assert that "E2E Todo", id: com.cozyla.choresreward:id/txtTodoListName is visible... FAILED

Assertion is false: "E2E Todo", id: com.cozyla.choresreward:id/txtTodoListName is visible

==== Debug output (logs & screenshots) ====

/Users/zhouxin/.maestro/tests/2026-09-08_100324

`;

describe('failure context parsing', () => {
  it('parses the failed step from real stdout', () => {
    assert.equal(
      parseFailedStep(REAL_LOG),
      'Assert that "E2E Todo", id: com.cozyla.choresreward:id/txtTodoListName is visible',
    );
  });

  it('ignores COMPLETED steps and keeps the last FAILED', () => {
    const log = 'a... FAILED\nb... COMPLETED\nc... FAILED\n';
    assert.equal(parseFailedStep(log), 'c');
  });

  it('returns null when nothing failed', () => {
    assert.equal(parseFailedStep('a... COMPLETED\n'), null);
    assert.equal(parseFailedStep(''), null);
  });

  it('parses artifact dir from the banner form', () => {
    assert.equal(
      parseArtifactDir(REAL_LOG),
      '/Users/zhouxin/.maestro/tests/2026-09-08_100324',
    );
  });

  it('parses artifact dir from the inline form', () => {
    assert.equal(
      parseArtifactDir('x\nDebug output path: /tmp/foo/bar\ny'),
      '/tmp/foo/bar',
    );
  });

  it('returns null when no artifact dir present', () => {
    assert.equal(parseArtifactDir('nothing here'), null);
  });
});

describe('buildFailureContext', () => {
  it('includes failed step, log tail, flow source and flattened hierarchy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-fail-'));
    const artifactDir = path.join(dir, 'artifacts');
    const hDir = path.join(artifactDir, 'Some Flow', 'screen-hierarchy');
    fs.mkdirSync(hDir, { recursive: true });
    fs.writeFileSync(
      path.join(hDir, 'step-048-assertCondition-E2E_Todo.json'),
      JSON.stringify({
        attributes: { 'resource-id': 'pkg:id/todoListLayout', class: 'android.widget.RelativeLayout' },
        children: [
          {
            attributes: { 'resource-id': 'pkg:id/txtTodoListName', text: 'List', class: 'android.widget.TextView' },
            children: [],
          },
          {
            attributes: { 'resource-id': 'pkg:id/txtTodoListDesc', text: 'E2E Todo', class: 'android.widget.TextView' },
            children: [],
          },
        ],
      }),
    );

    const flowRoot = path.join(dir, 'flow-root');
    fs.mkdirSync(path.join(flowRoot, 'maestro', 'todo'), { recursive: true });
    fs.writeFileSync(
      path.join(flowRoot, 'maestro', 'todo', 'item-create.yaml'),
      'appId: com.cozyla.choresreward\nname: fixture\n',
    );

    const ctx = buildFailureContext({
      run: {
        exit_code: 1,
        failed_step: 'Assert that "E2E Todo" is visible',
        artifact_dir: artifactDir,
        log_excerpt: REAL_LOG,
      },
      flowPath: 'maestro/todo/item-create.yaml',
      flowRoot,
    });

    assert.match(ctx, /exit_code：1/);
    assert.match(ctx, /失败步骤：Assert that "E2E Todo" is visible/);
    assert.match(ctx, /appId: com\.cozyla\.choresreward/);
    assert.match(ctx, /Assertion is false/);
    // 压缩后的层级要能看出 name 与 desc 的文字错位
    assert.match(ctx, /id=txtTodoListName class=TextView text="List"/);
    assert.match(ctx, /id=txtTodoListDesc class=TextView text="E2E Todo"/);
  });

  it('falls back to parsing log when run fields are empty', () => {
    const ctx = buildFailureContext({
      run: { exit_code: 1, log_excerpt: REAL_LOG },
      flowPath: null,
      flowRoot: null,
    });
    assert.match(ctx, /txtTodoListName is visible/);
    assert.match(ctx, /2026-09-08_100324/);
  });
});

describe('buildDiagnosisConversation', () => {
  it('includes prior AI answers and user hints in order', () => {
    const text = buildDiagnosisConversation(
      [
        { user_hint: '', response: '首次判断是时序问题' },
        {
          user_hint: '弹窗已经打开，保存后没有关闭',
          response: '结合线索，可能是保存请求失败',
        },
      ],
      '接口返回了 500',
    );

    assert.match(text, /第 1 轮 AI：首次判断是时序问题/);
    assert.match(text, /第 2 轮用户：弹窗已经打开/);
    assert.match(text, /第 2 轮 AI：结合线索/);
    assert.match(text, /本轮用户补充：接口返回了 500/);
  });

  it('returns empty text when there is no history or hint', () => {
    assert.equal(buildDiagnosisConversation([], ''), '');
  });
});
