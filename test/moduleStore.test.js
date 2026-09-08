import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-'));
  const db = openDb(path.join(dir, 't.db'));
  return createStore(db);
}

describe('module management', () => {
  let store;
  beforeEach(() => {
    store = tmpStore();
  });

  it('creates a new module', () => {
    const mod = store.createModule({ id: 'shopping', title: '购物清单' });
    assert.equal(mod.module, 'shopping');
    assert.equal(mod.title, '购物清单');

    const modules = store.listModules();
    const found = modules.find((m) => m.module === 'shopping');
    assert.ok(found);
  });

  it('rejects duplicate module ID', () => {
    store.createModule({ id: 'custom', title: '自定义' });
    assert.throws(
      () => store.createModule({ id: 'custom', title: '重复' }),
      /409/,
    );
  });

  it('lists all created modules', () => {
    store.createModule({ id: 'mod-a', title: '模块 A' });
    store.createModule({ id: 'mod-b', title: '模块 B' });

    const modules = store.listModules();
    const ids = modules.map((m) => m.module);
    assert.ok(ids.includes('mod-a'));
    assert.ok(ids.includes('mod-b'));
  });
});
