import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function localPythonBin() {
	const windowsVenv = join(process.cwd(), '.venv', 'Scripts', 'python.exe');
	const posixVenv = join(process.cwd(), '.venv', 'bin', 'python');
	if (existsSync(windowsVenv)) return windowsVenv;
	if (existsSync(posixVenv)) return posixVenv;
	return 'python';
}

describe('python claims analysis runner', () => {
	it('reports a runnable analytics mode from --probe', async () => {
		const { stdout } = await execFileAsync(localPythonBin(), [
			'python/claims_analysis/run_analysis.py',
			'--probe'
		]);
		const probe = JSON.parse(stdout);

		expect(probe.ok).toBe(true);
		expect(['fallback_analysis', 'source_ready']).toContain(probe.mode);
		expect(probe.analyticsDependencies).toBeTruthy();
	}, 15000);

	it('converts raw claims into report sections and canonical artifacts', async () => {
		const dir = await mkdtemp(join(process.cwd(), 'var', 'test-analysis-'));
		try {
			const uploadDir = join(dir, 'uploads');
			const outDir = join(dir, 'analysis');
			await mkdir(uploadDir, { recursive: true });
			await mkdir(outDir, { recursive: true });

			const claimsCsv = [
				'source_member,service_date,total_paid,diag_1,pos',
				'M001,2021-01-05,125.00,I10,11',
				'M002,2022-03-12,250.00,E119,23',
				'M001,2023-04-20,300.00,I10,21'
			].join('\n');
			const claimsPath = join(uploadDir, 'claims.csv');
			await writeFile(claimsPath, claimsCsv, 'utf8');

			const manifest = {
				sessionId: 'test_session',
				accountId: 'testClient',
				files: [
					{
						path: claimsPath,
						filename: 'claims.csv',
						bytes: Buffer.byteLength(claimsCsv),
						fileType: 'medical'
					}
				],
				mapping: {
					fields: {
						source_member: 'member_id',
						service_date: 'date_service_start',
						total_paid: 'amount_total',
						diag_1: 'icd_1',
						pos: 'pos_code'
					}
				}
			};
			const manifestPath = join(dir, 'manifest.json');
			await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

			await execFileAsync(localPythonBin(), [
				'python/claims_analysis/run_analysis.py',
				'--manifest',
				manifestPath,
				'--out-dir',
				outDir
			]);

			const status = JSON.parse(await readFile(join(outDir, 'python-status.json'), 'utf8'));
			const report = JSON.parse(await readFile(join(outDir, 'report-sections.json'), 'utf8'));

			expect(status.ok).toBe(true);
			expect(status.validation.claimCount).toBe(3);
			expect(report.summary.yearCount).toBe(3);
			expect(report.summary.latestYear.medicalTotal).toBe(300);
			expect(report.summary.conditionCosts.length).toBeGreaterThan(0);
			expect(report.validation.checks.length).toBeGreaterThan(0);
			expect(report.dashboard.kpis.latestMedicalTotal).toBe(300);
			expect(report.dashboard.findings.length).toBeGreaterThan(0);

			if (typeof status.xlsxReportPath === 'string') {
				expect(existsSync(status.xlsxReportPath)).toBe(true);
			}

			if (status.mode === 'source_ready') {
				expect(status.cleanedArtifacts.medical).toContain('medical-claims.csv');
				expect(status.cleanedArtifacts.eligibility).toContain('eligibility-generated.csv');
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 15000);

	it('reads v2 canonical file artifacts without silently generating eligibility', async () => {
		const dir = await mkdtemp(join(process.cwd(), 'var', 'test-analysis-'));
		try {
			const canonicalDir = join(dir, 'canonical-source');
			const outDir = join(dir, 'analysis');
			await mkdir(canonicalDir, { recursive: true });
			await mkdir(outDir, { recursive: true });

			const medicalCsv = [
				'member_id,date_service_start,amount_total,claim_id,icd_1,pos_code',
				'M001,2024-01-05,125.00,C1,I10,11'
			].join('\n');
			const medicalPath = join(canonicalDir, 'medical-canonical.csv');
			await writeFile(medicalPath, medicalCsv, 'utf8');

			const manifest = {
				manifestVersion: 2,
				sessionId: 'test_v2_session',
				accountId: 'testClient',
				files: [
					{
						filename: 'medical.csv',
						bytes: Buffer.byteLength(medicalCsv),
						fileType: 'medical',
						rowCount: 2,
						headers: ['member_id', 'date_service_start', 'amount_total', 'claim_id', 'icd_1', 'pos_code'],
						mapping: {
							source: 'canonical',
							fields: {}
						},
						artifacts: {
							canonicalCsv: medicalPath
						}
					}
				],
				validation: {
					productionReady: false,
					session: {
						eligibilityPresent: false,
						medicalPresent: true,
						pharmacyPresent: false,
						claimMembersEligibleAssumptionAccepted: false
					},
					warnings: [
						{
							severity: 'blocking',
							code: 'missing_eligibility',
							message: 'Eligibility file is required for production-ready analytics.'
						}
					]
				},
				rawUploadRetention: {
					retained: false,
					cleanupStatus: 'deleted'
				}
			};
			const manifestPath = join(dir, 'manifest.json');
			await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

			await execFileAsync(localPythonBin(), [
				'python/claims_analysis/run_analysis.py',
				'--manifest',
				manifestPath,
				'--out-dir',
				outDir
			]);

			const status = JSON.parse(await readFile(join(outDir, 'python-status.json'), 'utf8'));
			const report = JSON.parse(await readFile(join(outDir, 'report-sections.json'), 'utf8'));

			expect(status.ok).toBe(true);
			expect(status.validation.claimCount).toBe(1);
			expect(status.cleanedArtifacts.medical).toBe(medicalPath);
			expect(status.cleanedArtifacts.eligibility).toBeUndefined();
			expect(JSON.stringify(status)).not.toContain('eligibility-generated.csv');
			expect(report.validation.productionReady).toBe(false);
			expect(report.warnings.join(' ')).toMatch(/eligibility/i);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 15000);
});
