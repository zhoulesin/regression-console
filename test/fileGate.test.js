import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertMaestroYamlPath, applyFiles } from '../src/fileGate.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'));
fs.mkdirSync(path.join(root, 'maestro', 'todo'), { recursive: true });

describe('fileGate', () => {
  it('accepts maestro yaml', () => {
    assert.equal(
      assertMaestroYamlPath(root, 'maestro/todo/item-fast-add.yaml'),
      'maestro/todo/item-fast-add.yaml'
    );
  });
  it('rejects traversal', () => {
    assert.throws(() => assertMaestroYamlPath(root, 'maestro/../app/x.yaml'), /400/);
  });
  it('rejects absolute', () => {
    assert.throws(() => assertMaestroYamlPath(root, '/tmp/x.yaml'), /400/);
  });
  it('rejects kt and md', () => {
    assert.throws(() => assertMaestroYamlPath(root, 'maestro/x.kt'), /400/);
    assert.throws(() => assertMaestroYamlPath(root, 'TESTING_DEVICE_REGRESSION.md'), /400/);
  });
  it('apply writes bak then file', () => {
    const p = path.join(root, 'maestro', 'todo', 'a.yaml');
    fs.writeFileSync(p, 'old\n');
    applyFiles(root, [{ path: 'maestro/todo/a.yaml', content: 'new\n' }]);
    assert.equal(fs.readFileSync(p, 'utf8'), 'new\n');
    assert.equal(fs.readFileSync(p + '.bak', 'utf8'), 'old\n');
  });
});
