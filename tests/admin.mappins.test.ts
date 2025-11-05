import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('../src/lib/server/db', () => ({
  listMappings: vi.fn(async () => ([
    { accountId: 'clientA', fileType: 'eligibility', version: 2, isActive: true, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }
  ])),
  upsertMapping: vi.fn(async () => 'map123')
}));

import { load, actions } from '../src/routes/admin/mappings/+page.server';
import { upsertMapping } from '../src/lib/server/db';

describe('admin mappings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('load lists mappings with filters', async () => {
    const url = new URL('http://local/admin/mappings?accountId=clientA&fileType=eligibility');
    const data = await (load as any)({ url });
    expect(data.rows.length).toBe(1);
    expect(data.filters.accountId).toBe('clientA');
  });

  it('action upserts mapping', async () => {
    const form = new FormData();
    form.append('accountId', 'clientA');
    form.append('fileType', 'eligibility');
    form.append('version', '3');
    form.append('json', '{"colA":"canonical.a"}');
    form.append('isActive', 'on');

    const req = new Request('http://local/admin/mappings', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });

    expect(res.ok).toBe(true);
    expect(res.id).toBe('map123');
    expect(upsertMapping).toHaveBeenCalledTimes(1);
  });

  it('rejects bad JSON', async () => {
    const form = new FormData();
    form.append('accountId', 'clientA');
    form.append('fileType', 'eligibility');
    form.append('version', '1');
    form.append('json', '{bad json}');
    const req = new Request('http://local/admin/mappings', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });
    expect(res.error).toMatch(/invalid/i);
  });
});
