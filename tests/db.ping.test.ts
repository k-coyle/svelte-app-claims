// tests/db.ping.test.ts
import { it, expect } from 'vitest';
import { ping } from '../src/lib/server/db';

it.skip('atlas ping (requires .env set and IP allow-listed)', async () => {
  await expect(ping()).resolves.toBe(true);
});
