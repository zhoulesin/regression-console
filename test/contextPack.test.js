import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContext, IRON_RULES } from '../src/contextPack.js';

describe('context pack roots', () => {
  it('reads Maestro from flow root and Android source from app root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-context-'));
    const appRoot = path.join(dir, 'app-root');
    const flowRoot = path.join(dir, 'regression-root');
    const flowPath = path.join(
      flowRoot,
      'maestro/todo/subflows/create-fixture-list.yaml',
    );
    const examplePath = path.join(
      flowRoot,
      'maestro/todo/item-fast-add.yaml',
    );
    const layoutPath = path.join(
      appRoot,
      'app/src/main/res/layout/item_todolist.xml',
    );
    fs.mkdirSync(path.dirname(flowPath), { recursive: true });
    fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
    fs.writeFileSync(flowPath, 'flow-from-regression-root\n');
    fs.writeFileSync(examplePath, 'fast-add-example\n');
    fs.writeFileSync(layoutPath, 'layout-from-app-root\n');

    const context = buildContext(
      appRoot,
      { module: 'todo', chapter: 2 },
      flowRoot,
    );

    assert.match(context, /fast-add-example/);
    assert.match(context, /flow-from-regression-root/);
    assert.match(context, /layout-from-app-root/);
  });
});

describe('IRON_RULES', () => {
  it('requires result assertions bound to the target container', () => {
    assert.match(IRON_RULES, /禁止只 tap 确认/);
    assert.match(IRON_RULES, /禁止只 assertVisible 一段全屏文字/);
    assert.match(IRON_RULES, /childOf\/containsChild/);
    assert.match(IRON_RULES, /cleanup-fixture 只放开头/);
    assert.match(IRON_RULES, /timeout ≤5000/);
    // timeout 写进选择器会被 Maestro 拒绝，规则必须显式禁止
    assert.match(IRON_RULES, /timeout 只能写在 extendedWaitUntil/);
    assert.doesNotMatch(IRON_RULES, /timeout ≤1000/);
  });
});
