import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resolveAppRoot, resolveManifestPath } from '../src/config.js';

describe('config appRoot', () => {
  it('returns null when env and config omit appRoot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    assert.equal(resolveAppRoot(dir, {}), null);
  });

  it('prefers REGRESSION_APP_ROOT over config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(
      path.join(dir, 'regression.config.json'),
      JSON.stringify({ appRoot: '/from-file', manifestPath: 'custom.json' }),
    );
    const abs = path.join(dir, 'dut');
    assert.equal(resolveAppRoot(dir, { REGRESSION_APP_ROOT: abs }), abs);
    assert.equal(resolveManifestPath(dir, { REGRESSION_APP_ROOT: abs }), 'custom.json');
  });

  it('resolves relative appRoot against regressionRoot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(
      path.join(dir, 'regression.config.json'),
      JSON.stringify({ appRoot: 'dut' }),
    );
    assert.equal(resolveAppRoot(dir, {}), path.join(dir, 'dut'));
    assert.equal(resolveManifestPath(dir, {}), 'regression.manifest.json');
  });

  it('treats whitespace-only appRoot as absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(
      path.join(dir, 'regression.config.json'),
      JSON.stringify({ appRoot: '   ' }),
    );
    assert.equal(resolveAppRoot(dir, {}), null);
  });

  it('falls back to default when config file is broken', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    fs.writeFileSync(path.join(dir, 'regression.config.json'), '{ not json');
    assert.deepEqual(loadConfig(dir), {});
    assert.equal(resolveManifestPath(dir, {}), 'regression.manifest.json');
  });
});
