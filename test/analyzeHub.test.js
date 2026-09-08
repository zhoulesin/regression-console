import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzeHub } from '../src/analyzeHub.js';

describe('analyzeHub occupancy', () => {
  it('second tryBegin fails until release', () => {
    const hub = createAnalyzeHub();
    const a = hub.tryBegin('analyze');
    assert.ok(a > 0);
    assert.equal(hub.tryBegin('diagnose'), 0);
    assert.deepEqual(hub.status(), { busy: true, kind: 'analyze' });
    hub.release(a);
    assert.equal(hub.status().busy, false);
    assert.ok(hub.tryBegin('diagnose') > 0);
  });

  it('abort without child still frees the slot', () => {
    const hub = createAnalyzeHub();
    hub.tryBegin('analyze');
    assert.equal(hub.abort(), false);
    assert.equal(hub.status().busy, false);
    assert.ok(hub.tryBegin('diagnose') > 0);
  });

  it('stale release after abort does not clear the new occupant', () => {
    const hub = createAnalyzeHub();
    const first = hub.tryBegin('analyze');
    hub.abort();
    const second = hub.tryBegin('diagnose');
    hub.release(first);
    assert.equal(hub.status().busy, true);
    assert.equal(hub.status().kind, 'diagnose');
    hub.release(second);
    assert.equal(hub.status().busy, false);
  });
});
