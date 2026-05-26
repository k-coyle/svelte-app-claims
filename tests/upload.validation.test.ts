import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/server/db', () => ({
	getActiveMapping: vi.fn(async () => null),
	insertUploadSession: vi.fn(async () => 'sess-mock')
}));

import { actions } from '../src/routes/upload/+page.server';

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
		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const res = await (actions as any).default({ request: req });
		expect(res.error).toMatch(/not allowed/i);
	});

	it('accepts allowed extension even if MIME is odd', async () => {
		const form = baseForm();
		form.append('files', new File(['a,b\n1,2\n'], 'ok.csv', { type: 'application/octet-stream' }));
		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const res = await (actions as any).default({ request: req });
		expect(res.preview).toBeTruthy();
		expect(res.preview.stats[0].rowCount).toBe(2);
	});

	it('rejects when too many files are attached', async () => {
		const form = baseForm();
		for (let i = 0; i < 21; i++) {
			form.append('files', new File(['x\n'], `f${i}.csv`, { type: 'text/csv' }));
		}
		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const res = await (actions as any).default({ request: req });
		expect(res.error).toMatch(/Too many files/i);
	});
});
