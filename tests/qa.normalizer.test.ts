import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildWorkspaceQa } from '../src/lib/server/workspace/qa';
import type { AnalysisManifest } from '../src/lib/analysis/types';

describe('workspace QA normalizer', () => {
	let root: string | null = null;

	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
		root = null;
	});

	it('prefers ETL validation and clean artifacts for core QA metrics', async () => {
		root = await mkdtemp(join(process.cwd(), 'var', 'test-qa-'));
		const etlDir = join(root, 'etl');
		await mkdir(etlDir, { recursive: true });
		const validationPath = join(etlDir, 'etl_validation.json');
		const medicalPath = join(etlDir, 'medical_clean.csv');
		const pharmacyPath = join(etlDir, 'pharmacy_clean.csv');
		const memberPath = join(etlDir, 'member_comorbidity.csv');
		await writeFile(
			validationPath,
			JSON.stringify({
				analyticsReady: true,
				rowCounts: {
					source: { eligibility: 2, medical: 3, pharmacy: 2 },
					clean: { eligibility: 2, medical: 2, pharmacy: 1, memberComorbidity: 2 }
				},
				droppedRows: { medical: { invalid_service_date: 1 }, pharmacy: {} },
				duplicateCounts: { medical: 1, pharmacy: 0 },
				warnings: {
					blocking: [],
					quality: [{ code: 'missing_pharmacy', message: 'Pharmacy is optional.' }]
				}
			}),
			'utf8'
		);
		await writeFile(
			medicalPath,
			'claim_id,member_id,amount_total\nC1,M001,125.50\nC2,M002,74.50\n',
			'utf8'
		);
		await writeFile(pharmacyPath, 'claim_id,member_id,amount_total\nR1,M001,20\n', 'utf8');
		await writeFile(memberPath, 'member_id,total_cost\nM001,145.50\nM002,74.50\n', 'utf8');

		const qa = await buildWorkspaceQa({
			sessionId: 'sess_qa',
			accountId: 'clientA',
			createdAt: '2026-05-27T12:00:00.000Z',
			status: 'ready_for_bi',
			files: [],
			requirements: [],
			metrics: [],
			python: { pythonRoot: '', requirementsFile: '', runner: '', status: 'ready', notes: [] },
			analyticsReady: true,
			etlValidationPath: validationPath,
			etlArtifacts: {
				medicalClean: medicalPath,
				pharmacyClean: pharmacyPath,
				memberComorbidity: memberPath
			}
		} satisfies AnalysisManifest);

		expect(qa.source).toBe('etl');
		expect(qa.analyticsReady).toBe(true);
		expect(qa.metrics.find((metric) => metric.key === 'medical_total')?.value).toBe('$200');
		expect(qa.metrics.find((metric) => metric.key === 'pharmacy_total')?.value).toBe('$20');
		expect(qa.metrics.find((metric) => metric.key === 'member_count')?.value).toBe(2);
		expect(qa.metrics.find((metric) => metric.key === 'rejected_rows')?.value).toBe(1);
		expect(qa.warnings.quality).toHaveLength(1);
	});

	it('falls back to upload validation when ETL artifacts are missing', async () => {
		const qa = await buildWorkspaceQa({
			sessionId: 'sess_preview',
			accountId: 'clientA',
			createdAt: '2026-05-27T12:00:00.000Z',
			status: 'ready_for_etl',
			files: [
				{ filename: 'medical.csv', fileType: 'medical', rowCount: 10 },
				{ filename: 'eligibility.csv', fileType: 'eligibility', rowCount: 5 }
			],
			requirements: [],
			metrics: [],
			python: {
				pythonRoot: '',
				requirementsFile: '',
				runner: '',
				status: 'not_checked',
				notes: []
			},
			validation: {
				productionReady: false,
				warnings: [
					{ severity: 'blocking', code: 'missing_required_field', message: 'Missing amount.' }
				]
			}
		} satisfies AnalysisManifest);

		expect(qa.source).toBe('validation');
		expect(qa.analyticsReady).toBe(false);
		expect(qa.metrics.find((metric) => metric.key === 'source_rows')?.value).toBe(15);
		expect(qa.metrics.find((metric) => metric.key === 'medical_claims')?.value).toBe('Pending ETL');
		expect(qa.warnings.blocking).toHaveLength(1);
	});
});
