import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DB listing calls
vi.mock('../src/lib/server/db', () => ({
  listUploadSessions: vi.fn(async () => ([
    {
      uploaderUserId: 'user_123',
      accountId: 'clientA',
      fileType: 'eligibility',
      createdAt: new Date('2025-01-01T12:00:00Z').toISOString(),
      totalBytes: 12345,
      stats: [{ filename: 'file1.csv', bytes: 12345, rowCount: 10, mime: 'text/csv' }]
    }
  ])),
  countUploadSessions: vi.fn(async () => 1)
}));

import { load } from '../src/routes/upload/history/+page.server';
import { listUploadSessions, countUploadSessions } from '../src/lib/server/db';

describe('history load', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('uses filters and pagination from query params', async () => {
    const url = new URL('http://local/upload/history?accountId=clientA&fileType=eligibility&page=2&pageSize=10');
    const data = await (load as any)({ url });

    expect(listUploadSessions).toHaveBeenCalledWith({
      accountId: 'clientA',
      fileType: 'eligibility',
      page: 2,
      pageSize: 10,
      sort: 'newest'
    });
    expect(countUploadSessions).toHaveBeenCalledWith({
      accountId: 'clientA',
      fileType: 'eligibility'
    });
    expect(data.rows).toHaveLength(1);
    expect(data.paging.total).toBe(1);
    expect(data.paging.pages).toBe(1);
  });
});
