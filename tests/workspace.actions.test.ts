import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/server/db', () => ({
	getWorkspaceSummary: vi.fn(async () => ({
		uploadCount: 0,
		mappingCount: 0,
		activeMappings: 0,
		storePath: 'var/indexes',
		storageRoot: 'var'
	})),
	listUploadSessions: vi.fn(async () => []),
	listMappings: vi.fn(async () => []),
	upsertMapping: vi.fn(async () => 'map123'),
	deleteUploadSession: vi.fn(async () => ({ deleted: true, deletedArtifacts: [] })),
	clearDemoSessions: vi.fn(async () => ({ deletedSessions: 2, deletedArtifacts: [] })),
	getActiveMapping: vi.fn(async () => null),
	insertUploadSession: vi.fn(async () => 'sess_workspace')
}));

vi.mock('../src/lib/server/analysis', () => ({
	listAnalysisManifests: vi.fn(async () => []),
	rerunAnalysisForSession: vi.fn(async () => ({
		sessionId: 'sess_workspace',
		status: 'ready_for_bi'
	})),
	writeAnalysisArtifacts: vi.fn(async (input: unknown) => input)
}));

import { actions, load } from '../src/routes/+page.server';
import { clearDemoSessions, deleteUploadSession, upsertMapping } from '../src/lib/server/db';
import { rerunAnalysisForSession } from '../src/lib/server/analysis';

describe('root workspace server contract', () => {
	beforeEach(() => vi.clearAllMocks());

	it('loads the single workspace data model', async () => {
		const data = await (load as any)({ url: new URL('http://local/') });

		expect(data.allowedAccounts).toHaveLength(3);
		expect(data.defaultAccountId).toBe('clientA');
		expect(data.recentUploads).toEqual([]);
		expect(data.mappings).toEqual([]);
		expect(data.runs).toEqual([]);
		expect(data.qa.source).toBe('empty');
	});

	it('saves mapping JSON from the inline advanced panel', async () => {
		const form = new FormData();
		form.append('accountId', 'clientA');
		form.append('fileType', 'medical');
		form.append('version', '2');
		form.append('json', '{"fields":{"MemberID":"member_id"}}');
		form.append('isActive', 'on');

		const result = await (actions as any).saveMapping({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.ok).toBe(true);
		expect(result.id).toBe('map123');
		expect(upsertMapping).toHaveBeenCalledWith({
			accountId: 'clientA',
			fileType: 'medical',
			version: 2,
			json: { fields: { MemberID: 'member_id' } },
			isActive: true
		});
	});

	it('deletes one selected demo session', async () => {
		const form = new FormData();
		form.append('sessionId', 'sess_workspace');

		const result = await (actions as any).deleteSession({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.ok).toBe(true);
		expect(deleteUploadSession).toHaveBeenCalledWith('sess_workspace');
	});

	it('clears all demo sessions from the root workspace', async () => {
		const result = await (actions as any).clearSessions({
			request: new Request('http://local/', { method: 'POST', body: new FormData() })
		});

		expect(result.ok).toBe(true);
		expect(result.deletedSessions).toBe(2);
		expect(clearDemoSessions).toHaveBeenCalledTimes(1);
	});

	it('runs analysis for a selected session from the root workspace', async () => {
		const form = new FormData();
		form.append('sessionId', 'sess_workspace');

		const result = await (actions as any).runSession({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.ok).toBe(true);
		expect(result.sessionId).toBe('sess_workspace');
		expect(rerunAnalysisForSession).toHaveBeenCalledWith('sess_workspace');
	});
});
