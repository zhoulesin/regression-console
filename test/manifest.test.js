import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeManifest,
  parseManifestJson,
  readManifestFile,
  AppError,
} from '../src/manifest.js';

const appRoot = '/tmp/dut';

function ok(partial) {
  return normalizeManifest(
    {
      version: 1,
      modules: [{ id: 'todo', title: 'Todo' }],
      features: [{
        module: 'todo', code: '2.1', chapter: 2, chapterTitle: 'X',
        title: 't', criteria: 'c', flow: 'maestro/a.yaml',
      }],
      ...partial,
    },
    { appRoot },
  );
}

describe('normalizeManifest', () => {
  it('accepts a minimal valid document', () => {
    const m = ok({});
    assert.equal(m.features[0].flow, 'maestro/a.yaml');
    assert.equal(m.modules[0].id, 'todo');
    assert.equal(m.appId, '');
    assert.equal(m.device, '');
  });

  it('rejects path escape', () => {
    assert.throws(
      () => ok({ features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: '../secret.yaml' }] }),
      (e) => e instanceof AppError && e.code === 'MANIFEST_INVALID',
    );
  });

  it('rejects duplicate codes', () => {
    const draft = {
      version: 1,
      modules: [{ id: 'todo', title: 'Todo' }],
      features: [
        { module: 'todo', code: '2.1', chapter: 2, title: 'a', criteria: 'c', flow: 'maestro/a.yaml' },
        { module: 'todo', code: '2.1', chapter: 2, title: 'b', criteria: 'c', flow: 'maestro/b.yaml' },
      ],
    };
    assert.throws(() => normalizeManifest(draft, { appRoot }), (e) => e.code === 'MANIFEST_INVALID');
  });

  it('rejects a non-yaml flow', () => {
    assert.throws(
      () => ok({ features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.txt' }] }),
      (e) => e.code === 'MANIFEST_INVALID',
    );
  });

  it('accepts .yml as well as .yaml', () => {
    const m = ok({ features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.yml' }] });
    assert.equal(m.features[0].flow, 'maestro/a.yml');
  });

  it('accepts a manual feature without flow', () => {
    const m = normalizeManifest(
      {
        version: 1,
        modules: [{ id: 'todo', title: 'Todo' }],
        features: [{ module: 'todo', code: '1.6', chapter: 1, title: 'List 数量上限', criteria: 'c', manual: true }],
      },
      { appRoot },
    );
    assert.equal(m.features[0].manual, true);
    assert.equal(m.features[0].flow, '');
  });

  it('requires flow when manual is not set', () => {
    assert.throws(
      () => normalizeManifest(
        {
          version: 1,
          modules: [{ id: 'todo', title: 'Todo' }],
          features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c' }],
        },
        { appRoot },
      ),
      (e) => e.code === 'MANIFEST_INVALID',
    );
  });

  it('rejects wrong version', () => {
    assert.throws(() => ok({ version: 2 }), (e) => e.code === 'MANIFEST_INVALID');
  });

  it('rejects a feature whose module is not declared', () => {
    assert.throws(
      () => ok({ features: [{ module: 'ghost', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.yaml' }] }),
      (e) => e.code === 'MANIFEST_INVALID',
    );
  });

  it('rejects malformed code and chapter', () => {
    assert.throws(
      () => ok({ features: [{ module: 'todo', code: '2-1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.yaml' }] }),
      (e) => e.code === 'MANIFEST_INVALID',
    );
    assert.throws(
      () => ok({ features: [{ module: 'todo', code: '2.1', chapter: -1, title: 't', criteria: 'c', flow: 'maestro/a.yaml' }] }),
      (e) => e.code === 'MANIFEST_INVALID',
    );
  });

  it('reads appId and device, rejecting a malformed appId', () => {
    const m = ok({ appId: 'com.cozyla.choresreward', device: 'emulator-5554' });
    assert.equal(m.appId, 'com.cozyla.choresreward');
    assert.equal(m.device, 'emulator-5554');
    assert.throws(() => ok({ appId: 'choresreward' }), (e) => e.code === 'MANIFEST_INVALID');
  });
});

describe('parseManifestJson', () => {
  it('rejects broken JSON', () => {
    assert.throws(() => parseManifestJson('{ not json'), (e) => e.code === 'MANIFEST_INVALID');
  });

  it('returns the parsed object', () => {
    assert.deepEqual(parseManifestJson('{"a":1}'), { a: 1 });
  });
});

describe('readManifestFile', () => {
  it('throws MANIFEST_MISSING when file is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-'));
    assert.throws(
      () => readManifestFile(dir, 'regression.manifest.json'),
      (e) => e.code === 'MANIFEST_MISSING',
    );
  });

  it('reads and normalizes a manifest on disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-'));
    fs.writeFileSync(
      path.join(dir, 'regression.manifest.json'),
      JSON.stringify({
        version: 1,
        appId: 'com.example.app',
        modules: [{ id: 'todo', title: 'Todo' }],
        features: [{ module: 'todo', code: '2.1', chapter: 2, title: 't', criteria: 'c', flow: 'maestro/a.yaml' }],
      }),
    );
    const m = readManifestFile(dir, 'regression.manifest.json');
    assert.equal(m.appId, 'com.example.app');
    assert.equal(m.features.length, 1);
  });
});

describe('AppError', () => {
  it('prefixes httpStatus into message so statusFromError still works', () => {
    const e = new AppError(422, 'MANIFEST_INVALID', 'bad');
    assert.equal(e.message, '422: bad');
    assert.equal(e.httpStatus, 422);
    assert.equal(e.code, 'MANIFEST_INVALID');
  });
});
