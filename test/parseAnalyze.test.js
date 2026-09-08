import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { parseAnalyzeResponse } from '../src/parseAnalyze.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
fs.mkdirSync(path.join(root, 'maestro'), { recursive: true });

describe('parseAnalyzeResponse', () => {
  it('reads fenced json', () => {
    const raw = '```json\n{"rationale":"r","risks":["x"],"files":[{"path":"maestro/a.yaml","content":"appId: x\\n"}]}\n```';
    const out = parseAnalyzeResponse(raw, root);
    assert.equal(out.files[0].path, 'maestro/a.yaml');
  });
  it('422 when files missing', () => {
    assert.throws(() => parseAnalyzeResponse('{"rationale":"r","risks":[]}', root), /422/);
  });
  it('422 when path escapes', () => {
    const raw = JSON.stringify({
      rationale: 'r',
      risks: [],
      files: [{ path: 'app/Foo.kt', content: 'x' }],
    });
    assert.throws(() => parseAnalyzeResponse(raw, root), /422/);
  });
});
