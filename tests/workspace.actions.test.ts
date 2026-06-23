import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/server/db', () => ({
	getWorkspaceSummary: vi.fn(async () => ({
		uploadCount: 2,
		mappingCount: 3,
		activeMappings: 0,
		storePath: 'var/indexes',
		storageRoot: 'var'
	})),
	listUploadSessions: vi.fn(async () => []),
	listMappings: vi.fn(async (filters: { accountId?: string; fileType?: string } = {}) =>
		[
			{
				_id: 'map_clientA_eligibility_v1',
				accountId: 'clientA',
				fileType: 'eligibility',
				version: 1,
				isActive: true,
				json: {},
				updatedAt: '2026-05-28T10:00:00.000Z'
			}
		].filter(
			(mapping) =>
				(!filters.accountId || mapping.accountId === filters.accountId) &&
				(!filters.fileType || mapping.fileType === filters.fileType)
		)
	),
	upsertMapping: vi.fn(async () => 'map123'),
	deleteUploadSession: vi.fn(async () => ({ deleted: true, deletedArtifacts: [] })),
	clearDemoSessions: vi.fn(async () => ({ deletedSessions: 2, deletedArtifacts: [] })),
	getActiveMapping: vi.fn(async () => null),
	getDefaultMapping: vi.fn(async () => null),
	insertUploadSession: vi.fn(async () => 'sess_workspace')
}));

vi.mock('../src/lib/server/analysis', () => ({
	listAnalysisManifests: vi.fn(async () => []),
	listAnalysisManifestsForSessions: vi.fn(async () => []),
	rerunAnalysisForSession: vi.fn(async () => ({
		sessionId: 'sess_workspace',
		status: 'ready_for_bi'
	})),
	writeAnalysisArtifacts: vi.fn(async (input: unknown) => input)
}));

import { actions, load } from '../src/routes/+page.server';
import {
	clearDemoSessions,
	deleteUploadSession,
	listMappings,
	listUploadSessions,
	upsertMapping
} from '../src/lib/server/db';
import {
	listAnalysisManifests,
	listAnalysisManifestsForSessions,
	rerunAnalysisForSession
} from '../src/lib/server/analysis';

describe('root workspace server contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		const mockUpload = {
			_id: 'sess_global_mock',
			uploaderUserId: 'user_123',
			accountId: 'Mock',
			fileType: 'medical',
			fileTypes: ['medical'],
			usedMapping: 'stored' as const,
			stats: [{ filename: 'mock-medical.csv', bytes: 10, rowCount: 1 }],
			createdAt: '2026-05-29T12:00:00.000Z',
			totalBytes: 10
		};
		const clientAUpload = {
			_id: 'sess_global_clientA',
			uploaderUserId: 'user_123',
			accountId: 'clientA',
			fileType: 'eligibility',
			fileTypes: ['eligibility'],
			usedMapping: 'stored' as const,
			stats: [{ filename: 'eligibility.csv', bytes: 10, rowCount: 1 }],
			createdAt: '2026-05-28T12:00:00.000Z',
			totalBytes: 10
		};
		vi.mocked(listUploadSessions).mockImplementation(async (filtersOrLimit: any) => {
			if (filtersOrLimit?.accountId === 'Mock') return [mockUpload];
			if (filtersOrLimit?.accountId === 'clientA') return [clientAUpload];
			if (!filtersOrLimit?.accountId) {
				return [mockUpload, clientAUpload];
			}
			return [];
		});
		vi.mocked(listMappings).mockImplementation(
			async (filters: { accountId?: string; fileType?: string } = {}) =>
				[
					{
						_id: 'map_clientA_eligibility_v1',
						accountId: 'clientA',
						fileType: 'eligibility',
						version: 1,
						name: 'Client A eligibility.csv',
						originalFilename: 'Client A eligibility.csv',
						isActive: true,
						json: {
							fields: {
								MemberID: 'member_id',
								CoverageStart: 'medical_eligibility_start_date'
							},
							fieldCount: 2
						},
						updatedAt: '2026-05-28T10:00:00.000Z'
					},
					{
						_id: 'map_mock_medical_v1',
						accountId: 'Mock',
						fileType: 'medical',
						version: 1,
						name: 'Mock medical.csv',
						originalFilename: 'Mock medical.csv',
						isActive: true,
						json: {
							fields: {
								MemberID: 'member_id',
								Paid: 'amount_total'
							},
							fieldCount: 2
						},
						updatedAt: '2026-05-29T10:00:00.000Z'
					}
				].filter(
					(mapping) =>
						(!filters.accountId || mapping.accountId === filters.accountId) &&
						(!filters.fileType || mapping.fileType === filters.fileType)
				)
		);
		vi.mocked(listAnalysisManifests).mockResolvedValue([]);
		vi.mocked(listAnalysisManifestsForSessions).mockResolvedValue([]);
	});

	it('defaults managers to the latest valid upload account and scopes workspace rows', async () => {
		const data = await (load as any)({ url: new URL('http://local/') });

		expect(data.clientOptions).toEqual([
			{
				id: 'clientA',
				name: 'Client A',
				mappingCount: 1,
				fileTypes: ['eligibility']
			},
			{
				id: 'Mock',
				name: 'Mock',
				mappingCount: 1,
				fileTypes: ['medical']
			}
		]);
		expect(data.defaultAccountId).toBe('Mock');
		expect(data.selectedClientId).toBe('Mock');
		expect(data.recentUploads.map((row: any) => row.accountId)).toEqual(['Mock']);
		expect(data.mappings).toHaveLength(1);
		expect(data.mappingSummaries).toEqual([
			expect.objectContaining({ fileType: 'eligibility', defaultMapping: null }),
			expect.objectContaining({
				fileType: 'medical',
				defaultReason: 'newest_added',
				defaultMapping: expect.objectContaining({
					name: 'Mock medical.csv',
					version: 1,
					fieldCount: 2
				})
			}),
			expect.objectContaining({ fileType: 'pharmacy', defaultMapping: null })
		]);
		expect(data.runs).toEqual([]);
		expect(data.qa.source).toBe('empty');
	});

	it('lets an explicit client query win over the latest upload account', async () => {
		const data = await (load as any)({ url: new URL('http://local/?client=clientA') });

		expect(data.selectedClientId).toBe('clientA');
		expect(data.defaultAccountId).toBe('clientA');
		expect(data.recentUploads.map((row: any) => row.accountId)).toEqual(['clientA']);
		expect(data.mappings.every((mapping: any) => mapping.accountId === 'clientA')).toBe(true);
	});

	it('derives selectable clients from stored mappings and scopes workspace rows', async () => {
		vi.mocked(listMappings).mockResolvedValue([
			{
				_id: 'map_clientA_medical_v1',
				accountId: 'clientA',
				fileType: 'medical',
				version: 1,
				name: 'Client A medical.csv',
				isActive: true,
				json: {},
				updatedAt: '2026-05-28T10:00:00.000Z'
			},
			{
				_id: 'map_mock_medical_v1',
				accountId: 'Mock',
				fileType: 'medical',
				version: 1,
				name: 'Mock old medical.csv',
				isActive: true,
				json: {},
				updatedAt: '2026-05-28T10:00:00.000Z'
			},
			{
				_id: 'map_mock_rx_v1',
				accountId: 'Mock',
				fileType: 'pharmacy',
				version: 1,
				name: 'Mock pharmacy.csv',
				isActive: true,
				json: {},
				updatedAt: '2026-05-28T11:00:00.000Z'
			}
		]);
		vi.mocked(listUploadSessions).mockImplementation(async (filtersOrLimit: any) => {
			if (filtersOrLimit?.accountId === 'Mock') {
				return [
					{
						_id: 'sess_mock',
						uploaderUserId: 'user_123',
						accountId: 'Mock',
						fileType: 'medical',
						fileTypes: ['medical'],
						usedMapping: 'stored' as const,
						stats: [{ filename: 'mock-medical.csv', bytes: 10, rowCount: 1 }],
						files: [
							{
								fileType: 'medical',
								mapping: {
									source: 'stored',
									mappingId: 'map_mock_medical_v1',
									name: 'Mock old medical.csv',
									version: 1,
									fieldCount: 3
								}
							}
						],
						createdAt: '2026-05-28T12:00:00.000Z',
						totalBytes: 10
					}
				];
			}
			return [
				{
					_id: 'sess_global_mock',
					uploaderUserId: 'user_123',
					accountId: 'Mock',
					fileType: 'medical',
					fileTypes: ['medical'],
					usedMapping: 'stored' as const,
					stats: [{ filename: 'mock-medical.csv', bytes: 10, rowCount: 1 }],
					createdAt: '2026-05-28T12:00:00.000Z',
					totalBytes: 10
				}
			];
		});
		vi.mocked(listAnalysisManifestsForSessions).mockResolvedValue([
			{
				sessionId: 'sess_mock',
				accountId: 'Mock',
				createdAt: '2026-05-28T12:00:00.000Z',
				status: 'ready_for_bi',
				fileTypes: ['medical'],
				files: [
					{
						path: 'mock-medical.csv',
						filename: 'mock-medical.csv',
						fileType: 'medical',
						bytes: 10,
						rowCount: 1
					}
				],
				requirements: [],
				metrics: [],
				artifacts: { manifest: 'manifest.json', dashboard: 'dashboard.json' },
				validation: { productionReady: true, warnings: [] },
				python: {
					pythonRoot: '',
					requirementsFile: '',
					runner: '',
					status: 'ready',
					notes: []
				}
			} as any
		]);

		const data = await (load as any)({ url: new URL('http://local/?client=Mock') });

		expect(data.selectedClientId).toBe('Mock');
		expect(data.defaultAccountId).toBe('Mock');
		expect(data.clientOptions).toEqual([
			{
				id: 'clientA',
				name: 'Client A',
				mappingCount: 1,
				fileTypes: ['medical']
			},
			{
				id: 'Mock',
				name: 'Mock',
				mappingCount: 2,
				fileTypes: ['medical', 'pharmacy']
			}
		]);
		expect(data.mappings).toHaveLength(2);
		expect(data.mappings.every((mapping: any) => mapping.accountId === 'Mock')).toBe(true);
		expect(data.recentUploads).toHaveLength(1);
		expect(data.recentUploads[0].accountId).toBe('Mock');
		expect(listAnalysisManifestsForSessions).toHaveBeenCalledWith(['sess_mock']);
		expect(data.runs.map((run: any) => run.sessionId)).toEqual(['sess_mock']);
		expect(data.latest.sessionId).toBe('sess_mock');
		expect(data.qa.source).toBe('validation');
		expect(data.mappingSummaries).toContainEqual(
			expect.objectContaining({
				fileType: 'medical',
				defaultReason: 'latest_confirmed_upload',
				defaultMapping: expect.objectContaining({
					id: 'map_mock_medical_v1',
					name: 'Mock old medical.csv',
					version: 1
				})
			})
		);
	});

	it('loads selected-client manifests by session id instead of a global run window', async () => {
		vi.mocked(listAnalysisManifests).mockRejectedValue(
			new Error('global manifests should not be loaded')
		);
		vi.mocked(listMappings).mockResolvedValue([
			{
				_id: 'map_mock_medical_v1',
				accountId: 'Mock',
				fileType: 'medical',
				version: 1,
				name: 'Mock medical.csv',
				isActive: true,
				json: {},
				updatedAt: '2026-05-28T10:00:00.000Z'
			}
		]);
		vi.mocked(listUploadSessions).mockImplementation(async (filtersOrLimit: any) => {
			if (filtersOrLimit?.accountId === 'Mock') {
				return [
					{
						_id: 'sess_mock_old',
						uploaderUserId: 'user_123',
						accountId: 'Mock',
						fileType: 'medical',
						fileTypes: ['medical'],
						usedMapping: 'stored' as const,
						stats: [{ filename: 'mock-medical.csv', bytes: 10, rowCount: 1 }],
						createdAt: '2026-05-01T12:00:00.000Z',
						totalBytes: 10
					}
				];
			}
			return [];
		});
		vi.mocked(listAnalysisManifestsForSessions).mockResolvedValue([
			{
				sessionId: 'sess_mock_old',
				accountId: 'Mock',
				createdAt: '2026-05-01T12:00:00.000Z',
				status: 'ready_for_bi',
				fileTypes: ['medical'],
				files: [
					{
						path: 'mock-medical.csv',
						filename: 'mock-medical.csv',
						fileType: 'medical',
						bytes: 10,
						rowCount: 1
					}
				],
				requirements: [],
				metrics: [],
				artifacts: { manifest: 'manifest.json', dashboard: 'dashboard.json' },
				validation: { productionReady: true, warnings: [] },
				python: {
					pythonRoot: '',
					requirementsFile: '',
					runner: '',
					status: 'ready',
					notes: []
				}
			} as any
		]);

		const data = await (load as any)({ url: new URL('http://local/?client=Mock') });

		expect(listAnalysisManifestsForSessions).toHaveBeenCalledWith(['sess_mock_old']);
		expect(data.latest.sessionId).toBe('sess_mock_old');
		expect(data.qa.source).toBe('validation');
	});

	it('saves mapping JSON from the inline advanced panel', async () => {
		const form = new FormData();
		form.append('accountId', 'clientA');
		form.append('fileType', 'medical');
		form.append('version', '2');
		form.append('name', 'Manual medical mapping');
		form.append('json', '{"fields":{"MemberID":"member_id"}}');

		const result = await (actions as any).saveMapping({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.ok).toBe(true);
		expect(result.id).toBe('map123');
		expect(upsertMapping).toHaveBeenCalledWith({
			accountId: 'clientA',
			fileType: 'medical',
			version: 2,
			name: 'Manual medical mapping',
			json: { fields: { MemberID: 'member_id' } },
			isActive: true
		});
	});

	it('rejects add-client mapping import when no mapping CSV is provided', async () => {
		const form = new FormData();
		form.append('accountId', 'Mock');

		const result = await (actions as any).importMappingCsv({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.error).toMatch(/mapping csv/i);
		expect(upsertMapping).not.toHaveBeenCalled();
	});

	it('imports one or more mapping CSVs and defaults mapping names from filenames', async () => {
		vi.mocked(listMappings).mockResolvedValueOnce([]);
		const form = new FormData();
		form.append('accountId', 'Mock');
		form.append(
			'mappingFile:eligibility',
			new File(
				['column_number,column,column_uspm,dtype,parse_date\n1,MemberID,member_id,string,false\n'],
				'mock-eligibility.csv',
				{ type: 'text/csv' }
			)
		);
		form.append('version:eligibility', '1');
		form.append(
			'mappingFile:medical',
			new File(
				['column_number,column,column_uspm,dtype,parse_date\n1,ClaimNo,number,string,false\n'],
				'mock-medical.csv',
				{ type: 'text/csv' }
			)
		);
		form.append('version:medical', '2');
		form.append('name:medical', 'Mock Medical v2');

		const result = await (actions as any).importMappingCsv({
			request: new Request('http://local/', { method: 'POST', body: form })
		});

		expect(result.ok).toBe(true);
		expect(result.clientCreated).toBe(true);
		expect(result.imported).toEqual([
			expect.objectContaining({
				fileType: 'eligibility',
				name: 'mock-eligibility.csv',
				importedFieldCount: 1
			}),
			expect.objectContaining({
				fileType: 'medical',
				name: 'Mock Medical v2',
				importedFieldCount: 1
			})
		]);
		expect(upsertMapping).toHaveBeenCalledTimes(2);
		expect(upsertMapping).toHaveBeenNthCalledWith(1, {
			accountId: 'Mock',
			fileType: 'eligibility',
			version: 1,
			name: 'mock-eligibility.csv',
			originalFilename: 'mock-eligibility.csv',
			json: expect.objectContaining({ fieldCount: 1 }),
			isActive: true
		});
		expect(upsertMapping).toHaveBeenNthCalledWith(2, {
			accountId: 'Mock',
			fileType: 'medical',
			version: 2,
			name: 'Mock Medical v2',
			originalFilename: 'mock-medical.csv',
			json: expect.objectContaining({ fieldCount: 1 }),
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
