// tests/lineCount.test.ts
import { describe, it, expect } from 'vitest';
import { countLinesFast } from '../src/lib/server/lineCount';

describe('countLinesFast', () => {
  it('counts non-empty lines', () => {
    const n = countLinesFast(Buffer.from('a,b,c\n1,2,3\n\n4,5,6\n'));
    expect(n).toBe(3); // header + 2 rows
  });
});
