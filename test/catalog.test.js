import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { normalizeCatalogDraft } from '../src/catalog.js';
import { STATUS } from '../src/constants.js';

function freshStore() {
  const store = createStore(openDb(':memory:'));
  store.upsertFeature({
    module: 'todo',
    code: '2.1',
    chapter: 2,
    title: '卡片内快速添加',
    criteria: '新增 Todo 出现在目标 List 卡片内',
    precondition: '已有 List',
    status: STATUS.PASSED,
  });
  return store;
}

describe('normalizeCatalogDraft', () => {
  it('keeps new valid features and groups duplicate/invalid rows', () => {
    const existing = [
      { code: '2.1', title: '卡片内快速添加' },
    ];
    const result = normalizeCatalogDraft(
      {
        rationale: '扫描 Todo 根页',
        features: [
          {
            code: '2.1',
            chapter: 2,
            title: '另一个标题',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '2.2',
            chapter: 2,
            title: ' 卡片内快速添加 ',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '6',
            chapter: 6,
            title: '非法编号',
            criteria: '可见',
            precondition: '',
          },
          {
            code: '2.6',
            chapter: 2,
            title: '新功能',
            criteria: '结果出现在目标卡片',
            precondition: '已有 List',
          },
        ],
      },
      existing,
    );

    assert.deepEqual(result.features.map((row) => row.code), ['2.6']);
    assert.deepEqual(
      result.skipped.map((row) => row.reason),
      ['duplicate_code', 'duplicate_title', 'invalid'],
    );
  });

  it('limits reviewable features to 15', () => {
    const features = Array.from({ length: 17 }, (_, index) => ({
      code: `7.${index + 1}`,
      chapter: 7,
      title: `功能 ${index + 1}`,
      criteria: '结果可见',
      precondition: '',
    }));
    const result = normalizeCatalogDraft(
      { rationale: '批量', features },
      [],
    );
    assert.equal(result.features.length, 15);
    assert.equal(
      result.skipped.filter((row) => row.reason === 'batch_limit').length,
      2,
    );
  });
});

describe('module catalog notes', () => {
  it('keeps recent notes within 8000 characters', () => {
    const store = freshStore();
    for (let index = 0; index < 6; index += 1) {
      store.appendModuleNote('todo', `${index}-${'x'.repeat(1500)}`);
    }
    const notes = store.getModuleMeta('todo').notes;
    assert.ok(notes.length <= 8000);
    assert.doesNotMatch(notes, /【回归备注】0-/);
    assert.match(notes, /【回归备注】5-/);
  });
});
