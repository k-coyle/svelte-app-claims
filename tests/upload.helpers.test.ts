import { describe, it, expect } from 'vitest';

// Inline copies of tiny helpers for unit test scope
function countLinesFast(buf: Buffer): number {
  return buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

describe('countLinesFast', () => {
  it('counts non-empty lines', () => {
    const n = countLinesFast(Buffer.from('a,b,c\n1,2,3\n\n4,5,6\n'));
    expect(n).toBe(3);
  });
});
