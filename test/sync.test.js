import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { STATUS } from '../src/constants.js';
import { syncFromManifest, AppError } from '../src/sync.js';

const fixtureRoot = path.resolve(import.meta.dirname, 'fixtures/app');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-sync-'));
  return createStore(openDb(path.join(dir, 't.db')));
}

describe('syncFromManifest', () => {
  let store;
  beforeEach(() => {
    store = tmpStore();
  });

  it('requires appRoot', () => {
    assert.throws(
      () => syncFromManifest({ store, appRoot: null }),
      (e) => e instanceof AppError && e.code === 'NO_APP_ROOT',
    );
  });

  it('keeps snapshot when manifest is invalid', () => {
    store.upsertFeature({
      module: 'todo',
      code: '9.9',
      chapter: 9,
      title: 'old',
      criteria: 'c',
      status: STATUS.PASSED,
    });
    assert.throws(() =>
      syncFromManifest({ store, appRoot: fixtureRoot, manifestPath: 'nope.json' }),
    );
    assert.equal(store.getFeature('9.9', 'todo').title, 'old');
    assert.equal(store.getFeature('9.9', 'todo').hidden, 0);
  });

  it('upserts, marks missing yaml not runnable, hides stale rows', () => {
    store.upsertFeature({
      module: 'todo',
      code: '9.9',
      chapter: 9,
      title: 'stale',
      criteria: 'c',
      status: STATUS.PASSED,
      notes: 'keep-me',
    });
    syncFromManifest({ store, appRoot: fixtureRoot });
    assert.equal(store.getFeature('2.1', 'todo').runnable, 1);
    assert.equal(store.getFeature('2.2', 'todo').runnable, 0);
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PENDING_RUN);
    assert.equal(store.getFeature('9.9', 'todo').hidden, 1);
    assert.equal(store.getFeature('9.9', 'todo').status, STATUS.PASSED);
    assert.equal(store.getFeature('9.9', 'todo').notes, 'keep-me');
    assert.deepEqual(store.listFeatures('todo').map((r) => r.code), [
      '1.6',
      '2.1',
      '2.2',
    ]);
  });

  it('keeps manual features visible and not runnable', () => {
    syncFromManifest({ store, appRoot: fixtureRoot });
    const row = store.getFeature('1.6', 'todo');
    assert.equal(row.hidden, 0);
    assert.equal(row.manual, 1);
    assert.equal(row.runnable, 0);
  });

  it('does not overwrite status on second sync', () => {
    syncFromManifest({ store, appRoot: fixtureRoot });
    store.setStatus('2.1', STATUS.PASSED, 'todo');
    syncFromManifest({ store, appRoot: fixtureRoot });
    assert.equal(store.getFeature('2.1', 'todo').status, STATUS.PASSED);
  });

  it('returns counts and passes through appId/device', () => {
    const r = syncFromManifest({ store, appRoot: fixtureRoot });
    assert.equal(r.appId, 'com.example.fixture');
    assert.equal(r.device, 'fixture-device');
    assert.equal(r.modules, 1);
    assert.equal(r.features, 3);
  });

  it('upserts modules and records chapter titles', () => {
    syncFromManifest({ store, appRoot: fixtureRoot });
    const modules = store.listModules();
    assert.deepEqual(
      modules.map((m) => m.module),
      ['todo'],
    );
    assert.equal(modules[0].title, 'Todo');
    const meta = store.getModuleMeta('todo');
    assert.equal(meta.chapters['2'], '单 List 内的 Todo');
  });

  it('binds flow paths from manifest and stays idempotent', () => {
    syncFromManifest({ store, appRoot: fixtureRoot });
    syncFromManifest({ store, appRoot: fixtureRoot });
    const flows = store.listFlows('2.1', 'todo');
    assert.equal(flows.length, 1);
    assert.equal(flows[0].path, 'maestro/ok.yaml');
    // manual 项没有 flow，不应写入绑定
    assert.deepEqual(store.listFlows('1.6', 'todo'), []);
  });

  it('hides modules not in manifest', () => {
    store.upsertModule({ id: 'gone', title: 'Gone' });
    syncFromManifest({ store, appRoot: fixtureRoot });
    assert.deepEqual(
      store.listModules().map((m) => m.module),
      ['todo'],
    );
  });
});
