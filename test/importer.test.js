import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { importIfEmpty, SEED_FEATURES, syncFlowBindings } from '../src/importer.js';
import { STATUS } from '../src/constants.js';

describe('importer', () => {
  it('has 24 features', () => {
    assert.equal(SEED_FEATURES.length, 24);
  });
  it('imports once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-'));
    const store = createStore(openDb(path.join(dir, 't.db')));
    const a = importIfEmpty(store);
    const b = importIfEmpty(store);
    assert.equal(a.imported, 24);
    assert.equal(b.imported, 0);
    assert.equal(store.getFeature('1.5', 'todo').status, STATUS.PASSED);
    assert.equal(store.getFeature('1.6', 'todo').status, STATUS.MANUAL);
    assert.equal(store.getFeature('3.4', 'todo').status, STATUS.FALSE_GREEN);
    const flows = store.listFlows('1.5');
    assert.equal(flows[0].path, 'maestro/todo/list-drag-sort.yaml');
  });

  it('syncFlowBindings restores 0.2 to kill-relaunch without duplicating', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-'));
    const store = createStore(openDb(path.join(dir, 't.db')));
    importIfEmpty(store);
    store.upsertFlow({
      feature_module: 'todo',
      feature_code: '0.2',
      path: 'maestro/cold-launch-retain-login.yaml',
      kind: 'flow',
    });
    syncFlowBindings(store);
    const flows = store.listFlows('0.2');
    assert.equal(flows.length, 1);
    assert.equal(flows[0].path, 'maestro/kill-relaunch.yaml');
  });
});
