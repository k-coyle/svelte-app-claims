import { describe, it, expect, vi } from 'vitest';
import { createNdjsonIngestor } from '../src/lib/server/ndjson';

describe('ndjson ingestor', () => {
  it('batches, decorates, and flushes', async () => {
    const calls: any[] = [];
    const insertMany = vi.fn(async (docs: any[]) => { calls.push(docs.map((d: any) => d._sessionId)); });
    const ing = createNdjsonIngestor(insertMany, (o) => ({ ...o, _sessionId: 's1' }), 2);

    await ing.push('{"a":1}\n{"a":2}\n{"a":3}');
    await ing.flush();

    expect(insertMany).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([['s1','s1'], ['s1']]);
  });
});
