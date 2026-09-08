import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDbPath } from '../src/config.js';

function withRoot(configText, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-paths-'));
  try {
    if (configText !== null) {
      fs.writeFileSync(path.join(root, 'regression.config.json'), configText);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('resolveDbPath', () => {
  it('无配置时落在 data/console.db', () => {
    withRoot(null, (root) => {
      assert.equal(resolveDbPath(root), path.join(root, 'data', 'console.db'));
    });
  });

  it('配置文件损坏时回退默认，不让控制台起不来', () => {
    withRoot('{ not json', (root) => {
      assert.equal(resolveDbPath(root), path.join(root, 'data', 'console.db'));
    });
  });

  it('相对 dbPath 按控制台根解析', () => {
    withRoot(JSON.stringify({ dbPath: 'data/chores/console.db' }), (root) => {
      assert.equal(resolveDbPath(root), path.join(root, 'data', 'chores', 'console.db'));
    });
  });

  it('绝对 dbPath 原样使用', () => {
    const abs = path.join(os.tmpdir(), 'rc-elsewhere.db');
    withRoot(JSON.stringify({ dbPath: abs }), (root) => {
      assert.equal(resolveDbPath(root), abs);
    });
  });

  it('环境变量优先于配置文件', () => {
    const saved = process.env.REGRESSION_DB_PATH;
    process.env.REGRESSION_DB_PATH = path.join(os.tmpdir(), 'rc-env.db');
    try {
      withRoot(JSON.stringify({ dbPath: 'data/from-config.db' }), (root) => {
        assert.equal(resolveDbPath(root), path.join(os.tmpdir(), 'rc-env.db'));
      });
    } finally {
      if (saved === undefined) delete process.env.REGRESSION_DB_PATH;
      else process.env.REGRESSION_DB_PATH = saved;
    }
  });
});
