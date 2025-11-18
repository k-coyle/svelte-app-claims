import { describe, it, expect } from 'vitest';
import * as db from '../src/lib/server/db';

describe('db exports', () => {
  it('has enqueueJob as a function', () => {
    expect(typeof (db as any).enqueueJob).toBe('function');
  });
});
