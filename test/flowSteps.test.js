import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeFiles, describeFlow } from '../src/flowSteps.js';

const FAST_ADD = `appId: com.cozyla.choresreward
name: Todo fast add in fixture list
---
- runFlow: subflows/cleanup-fixture.yaml
- runFlow: subflows/create-fixture-list.yaml
- tapOn:
    id: "com.cozyla.choresreward:id/ll_fast_add_placeholder"
    childOf:
      containsChild:
        id: "com.cozyla.choresreward:id/ll_fast_add_placeholder"
      childOf:
        containsDescendants:
          - id: "com.cozyla.choresreward:id/tv_todolist_title"
            text: "E2E Todo"
- inputText: "E2E_Fast"
- tapOn:
    id: "com.cozyla.choresreward:id/iv_confirm"
- extendedWaitUntil:
    visible:
      id: "com.cozyla.choresreward:id/tv_todo_info_title"
      text: "E2E_Fast"
      childOf:
        containsDescendants:
          - id: "com.cozyla.choresreward:id/tv_todolist_title"
            text: "E2E Todo"
    timeout: 15000
`;

describe('describeFlow', () => {
  it('reads the flow name from the header document', () => {
    assert.equal(describeFlow(FAST_ADD).name, 'Todo fast add in fixture list');
  });

  it('names known subflows in Chinese', () => {
    const { steps } = describeFlow(FAST_ADD);
    assert.equal(steps[0].text, '执行：清理测试数据');
    assert.equal(steps[1].text, '执行：创建夹具清单「E2E Todo」');
  });

  it('shows the container so scope loss is visible to a reviewer', () => {
    const { steps } = describeFlow(FAST_ADD);
    const wait = steps.at(-1).text;
    assert.match(wait, /「E2E Todo」内的/);
    assert.match(wait, /E2E_Fast/);
    assert.match(wait, /最多 15 秒/);
  });

  it('renders a screen-wide assertion WITHOUT a container prefix', () => {
    // 这是关键：全屏断言读起来就少了「…内的」，人工一眼能看出假绿
    const { steps } = describeFlow(
      `appId: x\n---\n- extendedWaitUntil:\n    visible: "E2E_Full"\n    timeout: 15000\n`,
    );
    assert.equal(steps[0].text, '等待 「E2E_Full」 出现（最多 15 秒）');
    assert.doesNotMatch(steps[0].text, /内的/);
  });

  it('indents nested repeat and conditional commands', () => {
    const { steps } = describeFlow(
      `appId: x
---
- repeat:
    times: 5
    commands:
      - runFlow:
          when:
            visible:
              id: "pkg:id/iv_todolist_sort_more"
          commands:
            - tapOn:
                id: "pkg:id/tv_delete"
`,
    );
    assert.equal(steps[0].depth, 0);
    assert.match(steps[0].text, /最多重复 5 次/);
    assert.equal(steps[1].depth, 1);
    assert.match(steps[1].text, /可见，则/);
    assert.equal(steps[2].depth, 2);
    assert.equal(steps[2].text, '点击 确认删除');
  });

  it('falls back to the raw id when no Chinese name is known', () => {
    const { steps } = describeFlow(
      `appId: x\n---\n- tapOn:\n    id: "pkg:id/some_unmapped_view"\n`,
    );
    assert.equal(steps[0].text, '点击 some_unmapped_view');
  });

  it('returns empty steps for unparsable yaml instead of throwing', () => {
    const out = describeFlow('appId: [unclosed\n');
    assert.deepEqual(out.steps, []);
  });
});

describe('describeFiles', () => {
  it('keeps the path alongside each file steps', () => {
    const out = describeFiles([
      { path: 'maestro/todo/item-fast-add.yaml', content: FAST_ADD },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].path, 'maestro/todo/item-fast-add.yaml');
    assert.ok(out[0].steps.length > 0);
  });

  it('tolerates missing input', () => {
    assert.deepEqual(describeFiles(undefined), []);
  });
});
