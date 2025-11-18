import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ✅ Mock DB so tests never touch Atlas during preview/confirm
vi.mock('../src/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    insertUploadSession: vi.fn(async () => 'mockSession123'),
    enqueueJob: vi.fn(async () => 'job123'),
    // 👇 add this so confirm path can resolve a mapping without throwing
    getActiveMapping: vi.fn(async (_accountId: string, _fileType: string) => ({
      version: 1,
      json: {
        MemberID: 'member_id',
        EligibilityStart: 'medical_eligibility_start_date',
        EligibilityEnd: 'medical_eligibility_end_date',
        Relationship: 'member_relationship'
      }
    }))
  };
});


import { actions } from '../src/routes/upload/+page.server';
import { insertUploadSession } from '../src/lib/server/db';

describe('audit logging', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    vi.clearAllMocks();
  });

  it('logs a preview event with summary', async () => {
    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    form.append('files', new File(['a,b\n1,2\n'], 'test.csv', { type: 'text/csv' }));

    const req = new Request('http://local/upload', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });

    expect(res.preview).toBeTruthy();

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const line = calls.find((s) => s.includes('"event":"upload.preview"'));
    expect(line).toBeTruthy();

    const obj = JSON.parse(line!);
    expect(obj.event).toBe('upload.preview');
    expect(obj.accountId).toBe('clientA');
    expect(obj.fileType).toBe('eligibility');
    expect(obj.totalBytes).toBeGreaterThan(0);
  });

  it('logs a confirm event with summary', async () => {
    const form = new FormData();
    form.append('intent', 'confirm');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    form.append('files', new File(['a,b\n1,2\n'], 'test.csv', { type: 'text/csv' }));

    const req = new Request('http://local/upload', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });

    expect(res.confirmed).toBe(true);
    expect(res.sessionId).toBe('mockSession123');
    expect(insertUploadSession).toHaveBeenCalledTimes(1);

    const calls = spy.mock.calls.map((c) => String(c[0]));
    const line = calls.find((s) => s.includes('"event":"upload.confirm"'));
    expect(line).toBeTruthy();

    const obj = JSON.parse(line!);
    expect(obj.event).toBe('upload.confirm');
    expect(obj.accountId).toBe('clientA');
    expect(obj.fileType).toBe('eligibility');
  });
});
