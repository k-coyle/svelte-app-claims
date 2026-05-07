// tests/worker.spawn.test.ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { makeRunEtl, type WorkerJob } from '../src/lib/server/worker';

describe('runEtl()', () => {
  it('spawns node with ETL entry and args, collects output', async () => {
    // Fake spawn implementation
    const fakeSpawn = (...received: any[]) => {
      // capture for assertions later
      (fakeSpawn as any).calls = [...((fakeSpawn as any).calls ?? []), received];

      const child: any = new EventEmitter();
      const mk = () => {
        const s: any = new EventEmitter();
        s.setEncoding = () => {};
        return s;
      };
      child.stdout = mk();
      child.stderr = mk();

      // simulate process output then close
      setTimeout(() => {
        child.stdout.emit('data', 'OK\n');
        child.emit('close', 0);
      }, 10);

      return child;
    };

    const runEtl = makeRunEtl(fakeSpawn as any);

    const job: WorkerJob = {
      sessionId: 's1',
      accountId: 'clientA',
      fileType: 'eligibility',
      files: [{ path: 'var/uploads/s1/elig.csv', filename: 'elig.csv', bytes: 12 }],
      eligibilityStartDate: '2024-01-01T00:00:00.000Z',
      mapping: { fields: { MemberID: 'member_id' } }
    };

    const res = await runEtl(job, { entry: 'path/to/etl.js', timeoutMs: 2000 });

    // spawn was called
    const calls = (fakeSpawn as any).calls;
    expect(Array.isArray(calls) && calls.length).toBeTruthy();

    const [cmd, args, opts] = calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe('path/to/etl.js');
    expect(args).toContain('--mode');
    expect(args).toContain('eligibility');
    expect(args).toContain('--file');
    expect(args).toContain('var/uploads/s1/elig.csv');
    expect(opts?.stdio).toEqual(['ignore', 'pipe', 'pipe']);

    expect(res.code).toBe(0);
    expect(res.stdout).toContain('OK');
    expect(res.stderr).toBe('');
  });
});
