import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DB: provide getDefaultMapping, and no-op insert for this suite
vi.mock('../src/lib/server/db', () => ({
	clearDemoSessions: vi.fn(async () => ({ deletedSessions: 0, deletedArtifacts: [] })),
	deleteUploadSession: vi.fn(async () => ({ deleted: false, deletedArtifacts: [] })),
	getWorkspaceSummary: vi.fn(async () => ({
		uploadCount: 0,
		mappingCount: 0,
		activeMappings: 0,
		storePath: '',
		storageRoot: ''
	})),
	listMappings: vi.fn(async () => []),
	listUploadSessions: vi.fn(async () => []),
	upsertMapping: vi.fn(async () => 'map123'),
	getActiveMapping: vi.fn(async () => null),
	getDefaultMapping: vi.fn(async (accountId: string, fileType: string) => {
		if (accountId === 'clientA' && fileType === 'eligibility') {
			return {
				_id: 'map_clientA_eligibility_v3',
				accountId,
				fileType,
				version: 3,
				name: 'Eligibility v3',
				json: { columnA: 'canonical.fieldA', columnB: 'canonical.fieldB' },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				isActive: true,
				defaultReason: 'newest_added'
			};
		}
		return null;
	}),
	insertUploadSession: vi.fn(async () => 'sess123')
}));

import { actions } from '../src/routes/+page.server';
import { getDefaultMapping } from '../src/lib/server/db';

describe('stored mapping lookup', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => vi.clearAllMocks());

	it('uses stored mapping when checkbox is on', async () => {
		const form = new FormData();
		form.append('intent', 'preview');
		form.append('fileType', 'eligibility');
		form.append('accountId', 'clientA');
		form.append('useStoredMapping', 'on'); // checkbox
		form.append('files', new File(['a,b\n1,2\n'], 'test.csv', { type: 'text/csv' }));

		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });

		expect(res.preview).toBeTruthy();
		expect(res.preview.usedMapping).toBe('stored');
		expect(res.preview.mappingVersion).toBe(3);
		expect(res.preview.mappingFieldCount).toBe(2);
		expect(getDefaultMapping).toHaveBeenCalledTimes(1);
	});

	it('errors if stored mapping requested but not found', async () => {
		const form = new FormData();
		form.append('intent', 'preview');
		form.append('fileType', 'eligibility');
		form.append('accountId', 'clientZ'); // no mapping in our mock
		form.append('useStoredMapping', 'on');
		form.append('files', new File(['x\n'], 'f.csv', { type: 'text/csv' }));

		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });

		expect(res.error).toMatch(/No stored mapping/);
	});

	it('uses provided mapping JSON when textarea is filled', async () => {
		const form = new FormData();
		form.append('intent', 'preview');
		form.append('fileType', 'eligibility');
		form.append('accountId', 'clientA');
		// Do NOT set useStoredMapping
		form.append('mappingJson', '{"c1":"canonical.one","c2":"canonical.two"}');
		form.append('files', new File(['x\n'], 'f.csv', { type: 'text/csv' }));

		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });

		expect(res.preview).toBeTruthy();
		expect(res.preview.usedMapping).toBe('provided');
		expect(res.preview.mappingVersion).toBeUndefined();
		expect(res.preview.mappingFieldCount).toBe(2);
		expect(getDefaultMapping).toHaveBeenCalledTimes(0);
	});

	it('falls back to stored mapping when no JSON provided and checkbox off', async () => {
		const form = new FormData();
		form.append('intent', 'preview');
		form.append('fileType', 'eligibility');
		form.append('accountId', 'clientA');
		// neither useStoredMapping nor mappingJson
		form.append('files', new File(['x\n'], 'f.csv', { type: 'text/csv' }));

		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });

		expect(res.preview.usedMapping).toBe('stored');
		expect(res.preview.mappingVersion).toBe(3);
	});
});
