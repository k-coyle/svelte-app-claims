import { describe, it, expect, vi } from 'vitest';

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
	insertUploadSession: vi.fn(async () => 'sess-mock')
}));

import { actions } from '../src/routes/+page.server';

function baseForm(intent: 'preview' | 'confirm' = 'preview') {
	const form = new FormData();
	form.append('intent', intent);
	form.append('fileType', 'eligibility');
	form.append('accountId', 'clientA');
	return form;
}

describe('upload validation', () => {
	it('rejects disallowed extensions', async () => {
		const form = baseForm();
		form.append('files', new File(['%PDF-1.7'], 'evil.pdf', { type: 'application/pdf' }));
		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });
		expect(res.error).toMatch(/not allowed/i);
	});

	it('accepts allowed extension even if MIME is odd', async () => {
		const form = baseForm();
		form.append('files', new File(['a,b\n1,2\n'], 'ok.csv', { type: 'application/octet-stream' }));
		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });
		expect(res.preview).toBeTruthy();
		expect(res.preview.stats[0].rowCount).toBe(2);
	});

	it('rejects when too many files are attached', async () => {
		const form = baseForm();
		for (let i = 0; i < 21; i++) {
			form.append('files', new File(['x\n'], `f${i}.csv`, { type: 'text/csv' }));
		}
		const req = new Request('http://local/', { method: 'POST', body: form });
		const res = await (actions as any).upload({ request: req });
		expect(res.error).toMatch(/Too many files/i);
	});
});
