import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const sessionId = 'sess_phi_mixed';
const analysisInputs: unknown[] = [];

vi.mock('../src/lib/server/db', () => ({
	getActiveMapping: vi.fn(async (_accountId: string, fileType: string) => {
		const fieldsByType: Record<string, Record<string, string>> = {
			eligibility: {
				MemberID: 'member_id',
				CoverageStart: 'medical_eligibility_start_date',
				CoverageEnd: 'medical_eligibility_end_date'
			},
			medical: {
				MemberID: 'member_id',
				ServiceDate: 'date_service_start',
				Paid: 'amount_total',
				ClaimNo: 'number',
				Sequence: 'sequence',
				Diag1: 'icd_1'
			},
			pharmacy: {
				MemberID: 'member_id',
				FillDate: 'date_filled',
				Paid: 'amount_total',
				NDC: 'ndc'
			}
		};
		const fields = fieldsByType[fileType];
		return fields
			? {
					accountId: 'clientA',
					fileType,
					version: fileType === 'eligibility' ? 1 : fileType === 'medical' ? 2 : 3,
					json: { fields },
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					isActive: true
				}
			: null;
	}),
	insertUploadSession: vi.fn(async () => sessionId)
}));

vi.mock('../src/lib/server/analysis', () => ({
	writeAnalysisArtifacts: vi.fn(async (input: unknown) => {
		analysisInputs.push(input);
		return input;
	})
}));

import { actions } from '../src/routes/upload/+page.server';
import { insertUploadSession } from '../src/lib/server/db';

function textFile(name: string, csv: string) {
	return new File([csv], name, { type: 'text/csv' });
}

function baseForm(intent: 'preview' | 'confirm' = 'confirm') {
	const form = new FormData();
	form.append('intent', intent);
	form.append('accountId', 'clientA');
	return form;
}

describe('production PHI upload ingestion v2', () => {
	beforeEach(() => {
		analysisInputs.length = 0;
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await rm(join(process.cwd(), 'var', 'uploads', sessionId), { recursive: true, force: true });
		await rm(join(process.cwd(), 'var', 'analysis', sessionId), { recursive: true, force: true });
	});

	it('confirms a mixed eligibility, medical, and pharmacy session with per-file mappings and deletes raw temp files', async () => {
		const form = baseForm('confirm');
		form.append(
			'files',
			textFile('eligibility.csv', 'MemberID,CoverageStart,CoverageEnd\nM001,2024-01-01,2024-12-31\n')
		);
		form.append(
			'files',
			textFile('medical.csv', 'MemberID,ServiceDate,Paid,ClaimNo,Sequence,Diag1\nM001,2024-02-01,100,C1,1,I10\n')
		);
		form.append('files', textFile('pharmacy.csv', 'MemberID,FillDate,Paid,NDC\nM001,2024-03-01,25,12345678901\n'));
		form.append('fileType:0', 'eligibility');
		form.append('fileType:1', 'medical');
		form.append('fileType:2', 'pharmacy');
		form.append('mappingMode:0', 'stored');
		form.append('mappingMode:1', 'stored');
		form.append('mappingMode:2', 'stored');

		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const result = await (actions as any).default({ request: req });

		expect(result.confirmed).toBe(true);
		expect(result.sessionId).toBe(sessionId);
		expect(insertUploadSession).toHaveBeenCalledTimes(1);

		const storedSession = vi.mocked(insertUploadSession).mock.calls[0][0] as any;
		expect(storedSession.fileType).toBe('mixed');
		expect(storedSession.fileTypes).toEqual(['eligibility', 'medical', 'pharmacy']);
		expect(storedSession.validation.productionReady).toBe(true);
		expect(storedSession.rawUploadRetention.retained).toBe(false);

		const analysisInput = analysisInputs[0] as any;
		expect(analysisInput.manifestVersion).toBe(2);
		expect(analysisInput.validation.productionReady).toBe(true);
		expect(analysisInput.files.map((file: any) => file.fileType)).toEqual([
			'eligibility',
			'medical',
			'pharmacy'
		]);
		expect(analysisInput.files.map((file: any) => file.mapping.version)).toEqual([1, 2, 3]);
		expect(analysisInput.files.every((file: any) => file.artifacts.canonicalCsv === file.path)).toBe(true);
		expect(analysisInput.files.every((file: any) => existsSync(file.artifacts.canonicalCsv))).toBe(true);
		expect(existsSync(join(process.cwd(), 'var', 'uploads', sessionId, 'raw-temp'))).toBe(false);

		const medicalCsv = await readFile(analysisInput.files[1].artifacts.canonicalCsv, 'utf8');
		expect(medicalCsv.split(/\r?\n/)[0]).toContain('member_id');
		expect(medicalCsv.split(/\r?\n/)[0]).toContain('date_service_start');
	});

	it('blocks medical-only confirmation unless the user accepts the explicit eligibility assumption', async () => {
		const form = baseForm('confirm');
		form.append('files', textFile('medical.csv', 'MemberID,ServiceDate,Paid,ClaimNo\nM001,2024-02-01,100,C1\n'));
		form.append('fileType:0', 'medical');
		form.append('mappingMode:0', 'provided');
		form.append(
			'mappingJson:0',
			JSON.stringify({
				fields: {
					MemberID: 'member_id',
					ServiceDate: 'date_service_start',
					Paid: 'amount_total',
					ClaimNo: 'number'
				}
			})
		);

		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const result = await (actions as any).default({ request: req });

		expect(result.error).toMatch(/eligibility/i);
		expect(analysisInputs).toHaveLength(0);
	});

	it('allows explicitly assumed medical-only eligibility while marking the session not production-ready', async () => {
		const form = baseForm('confirm');
		form.append('assumeClaimMembersEligible', 'on');
		form.append('files', textFile('medical.csv', 'MemberID,ServiceDate,Paid,ClaimNo\nM001,2024-02-01,100,C1\n'));
		form.append('fileType:0', 'medical');
		form.append('mappingMode:0', 'provided');
		form.append(
			'mappingJson:0',
			JSON.stringify({
				fields: {
					MemberID: 'member_id',
					ServiceDate: 'date_service_start',
					Paid: 'amount_total',
					ClaimNo: 'number'
				}
			})
		);

		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const result = await (actions as any).default({ request: req });

		expect(result.confirmed).toBe(true);
		const analysisInput = analysisInputs[0] as any;
		expect(analysisInput.validation.productionReady).toBe(false);
		expect(analysisInput.validation.session.claimMembersEligibleAssumptionAccepted).toBe(true);
		expect(analysisInput.files[0].validation.blockingWarnings).toEqual([]);
	});

	it('reports missing required canonical fields during preview', async () => {
		const form = baseForm('preview');
		form.append('files', textFile('medical.csv', 'MemberID,ServiceDate\nM001,2024-02-01\n'));
		form.append('fileType:0', 'medical');
		form.append('mappingMode:0', 'canonical');

		const req = new Request('http://local/upload', { method: 'POST', body: form });
		const result = await (actions as any).default({ request: req });

		expect(result.preview.validation.productionReady).toBe(false);
		expect(result.preview.files[0].validation.requiredCoverage.amount.status).toBe('missing');
		expect(result.preview.files[0].validation.blockingWarnings.join(' ')).toMatch(/amount/i);
	});

	it('keeps audit logs free of row-level PHI values', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			const form = baseForm('preview');
			form.append('files', textFile('medical.csv', 'MemberID,ServiceDate,Paid,ClaimNo\nSECRET_MEMBER,2024-02-01,100,C1\n'));
			form.append('fileType:0', 'medical');
			form.append('mappingMode:0', 'canonical');

			const req = new Request('http://local/upload', { method: 'POST', body: form });
			await (actions as any).default({ request: req });

			const logText = spy.mock.calls.map((call) => String(call[0])).join('\n');
			expect(logText).toContain('upload.preview');
			expect(logText).not.toContain('SECRET_MEMBER');
			expect(logText).not.toContain('2024-02-01');
		} finally {
			spy.mockRestore();
		}
	});
});
