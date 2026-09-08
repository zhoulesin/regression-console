import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamParser } from '../src/claudeStream.js';

function line(obj) {
  return JSON.stringify(obj) + '\n';
}

describe('claude stream parser', () => {
  it('emits progress for thinking and text deltas', () => {
    const p = createStreamParser();
    let out = '';
    out += p.push(line({ type: 'system', subtype: 'init', model: 'test-model' }));
    out += p.push(
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: '想一下' },
        },
      }),
    );
    out += p.push(
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '{"rationale"' },
        },
      }),
    );
    assert.match(out, /test-model/);
    assert.match(out, /思考中/);
    assert.match(out, /想一下/);
    assert.match(out, /输出结果/);
    assert.match(out, /\{"rationale"/);
  });

  it('handles chunk split across line boundary', () => {
    const p = createStreamParser();
    const full = line({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'HELLO' },
      },
    });
    const cut = Math.floor(full.length / 2);
    let out = p.push(full.slice(0, cut));
    out += p.push(full.slice(cut));
    assert.match(out, /HELLO/);
  });

  it('takes final text from result event', () => {
    const p = createStreamParser();
    p.push(
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '{"rationale":"r","risks":[],"files":[]}',
        duration_ms: 4200,
      }),
    );
    assert.equal(p.finalText, '{"rationale":"r","risks":[],"files":[]}');
    assert.equal(p.errorMessage, '');
  });

  it('records error result', () => {
    const p = createStreamParser();
    p.push(
      line({ type: 'result', subtype: 'error', is_error: true, result: 'boom' }),
    );
    assert.equal(p.finalText, null);
    assert.match(p.errorMessage, /boom/);
  });
});
