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

async function runPython(manifestPath: string, outDir: string) {
	await execFileAsync(localPythonBin(), [
		'python/claims_analysis/run_analysis.py',
		'--manifest',
		manifestPath,
		'--out-dir',
		outDir
	]);
}

async function writeManifest(dir: string, manifest: Record<string, unknown>) {
	const manifestPath = join(dir, 'manifest.json');
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	return manifestPath;
}

function csvRows(text: string) {
	const [headerLine, ...lines] = text.trim().split(/\r?\n/);
	const headers = headerLine.split(',');
	return lines.filter(Boolean).map((line) => {
		const values = line.split(',');
		return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
	});
}

describe('python ETL layer', () => {
	it('preserves the AbstractReader DataFrame-only read contract', async () => {
		const script = [
			'import json',
			'import os',
			'import sys',
			'from pathlib import Path',
			"root = Path('python/claims_analysis').resolve()",
			'os.chdir(root)',
			'sys.path.insert(0, str(root))',
			'from etl.ingestion.cleaner import MedicalReader',
			'import pandas as pd',
			'reader = MedicalReader(paths=[])',
			"df = reader.read(data=[{'Member Identifier': 'M001', 'Date Service Started': '2024-01-01', 'Paid Amount': '12.50'}])",
			"print(json.dumps({'isTuple': isinstance(df, tuple), 'shape': list(df.shape), 'columns': list(df.columns)}))"
		].join('; ');

		const { stdout } = await execFileAsync(localPythonBin(), ['-c', script]);
		const result = JSON.parse(stdout);

		expect(result.isTuple).toBe(false);
		expect(result.shape[0]).toBe(1);
		expect(result.columns).toContain('member_id');
	}, 20000);

	it('writes saturated ETL datasets for mixed eligibility medical and pharmacy canonical files', async () => {
		const dir = await mkdtemp(join(process.cwd(), 'var', 'test-etl-'));
		try {
			const canonicalDir = join(dir, 'canonical');
			const outDir = join(dir, 'analysis');
			await mkdir(canonicalDir, { recursive: true });
			await mkdir(outDir, { recursive: true });

			const eligibilityCsv = [
				'member_id,coverage_start,coverage_end,member_relationship,member_gender',
				'M001,2024-01-01,2024-12-31,self,F',
				'M002,2024-01-01,2024-12-31,spouse,M'
			].join('\n');
			const medicalCsv = [
				'member_id,date_service_start,date_service_end,amount_total,claim_number,claim_sequence,pos_code,icd_1,icd_2,procedure_code',
				'M001,2024-01-05,2024-01-07,125.00,C1,1,21,I10,E119,99213',
				'M001,2024-01-05,2024-01-07,125.00,C1,1,21,I10,E119,99213',
				'M002,bad-date,2024-02-11,50.00,C2,1,11,E119,,99214',
				'M999,2024-01-10,2024-01-10,80.00,C3,1,23,I10,,99284'
			].join('\n');
			const pharmacyCsv = [
				'member_id,date_filled,amount_total,rx_number,ndc,drug_name',
				'M001,2024-01-15,20.00,R1,12345678901,Lisinopril',
				'M002,2024-02-01,thirty,R2,222,Metformin',
				'M999,2024-02-02,99.00,R3,333,Other'
			].join('\n');
			const eligibilityPath = join(canonicalDir, 'eligibility.csv');
			const medicalPath = join(canonicalDir, 'medical.csv');
			const pharmacyPath = join(canonicalDir, 'pharmacy.csv');
			await writeFile(eligibilityPath, eligibilityCsv, 'utf8');
			await writeFile(medicalPath, medicalCsv, 'utf8');
			await writeFile(pharmacyPath, pharmacyCsv, 'utf8');

			const manifestPath = await writeManifest(dir, {
				manifestVersion: 2,
				sessionId: 'test_etl_full',
				accountId: 'testClient',
				files: [
					{
						filename: 'eligibility.csv',
						fileType: 'eligibility',
						bytes: Buffer.byteLength(eligibilityCsv),
						artifacts: { canonicalCsv: eligibilityPath },
						mapping: { source: 'canonical', fields: {} }
					},
					{
						filename: 'medical.csv',
						fileType: 'medical',
						bytes: Buffer.byteLength(medicalCsv),
						artifacts: { canonicalCsv: medicalPath },
						mapping: { source: 'canonical', fields: {} }
					},
					{
						filename: 'pharmacy.csv',
						fileType: 'pharmacy',
						bytes: Buffer.byteLength(pharmacyCsv),
						artifacts: { canonicalCsv: pharmacyPath },
						mapping: { source: 'canonical', fields: {} }
					}
				],
				validation: {
					productionReady: true,
					session: { eligibilityPresent: true, medicalPresent: true, pharmacyPresent: true }
				}
			});

			await runPython(manifestPath, outDir);

			const status = JSON.parse(await readFile(join(outDir, 'python-status.json'), 'utf8'));
			const validation = JSON.parse(
				await readFile(join(outDir, 'etl', 'etl_validation.json'), 'utf8')
			);
			const medicalRows = csvRows(await readFile(join(outDir, 'etl', 'medical_clean.csv'), 'utf8'));
			const diagnosisRows = csvRows(
				await readFile(join(outDir, 'etl', 'medical_diagnosis_long.csv'), 'utf8')
			);
			const comorbidityRows = csvRows(
				await readFile(join(outDir, 'etl', 'member_comorbidity.csv'), 'utf8')
			);

			expect(status.ok).toBe(true);
			expect(status.etlStatus).toBe('complete');
			expect(status.analyticsReady).toBe(true);
			expect(status.etlArtifacts.medicalClean).toContain('medical_clean.csv');
			expect(medicalRows).toHaveLength(1);
			expect(medicalRows[0].claim_id).toBe('C1.1');
			expect(medicalRows[0].is_ip).toBe('true');
			expect(medicalRows[0].days_spent).toBe('3');
			expect(diagnosisRows.some((row) => row.condition_group === 'Hypertension')).toBe(true);
			expect(diagnosisRows.some((row) => row.condition_group === 'Diabetes')).toBe(true);
			expect(
				comorbidityRows.some((row) => row.member_id === 'M001' && row.comorbidity_count === '2')
			).toBe(true);
			expect(validation.duplicateCounts.medical).toBe(1);
			expect(validation.dateParseFailures.medical).toBeGreaterThan(0);
			expect(validation.numericParseFailures.pharmacy).toBeGreaterThan(0);
			expect(validation.unmappedCounts.icd).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20000);

	it('generates preview eligibility only when the manifest records the claim-member assumption', async () => {
		const dir = await mkdtemp(join(process.cwd(), 'var', 'test-etl-'));
		try {
			const canonicalDir = join(dir, 'canonical');
			const outDir = join(dir, 'analysis');
			await mkdir(canonicalDir, { recursive: true });
			await mkdir(outDir, { recursive: true });

			const medicalCsv = [
				'member_id,date_service_start,amount_total,claim_id,pos_code,icd_1',
				'M001,2024-01-05,125.00,C1,11,I10'
			].join('\n');
			const medicalPath = join(canonicalDir, 'medical.csv');
			await writeFile(medicalPath, medicalCsv, 'utf8');

			const manifestPath = await writeManifest(dir, {
				manifestVersion: 2,
				sessionId: 'test_etl_assumed_eligibility',
				accountId: 'testClient',
				files: [
					{
						filename: 'medical.csv',
						fileType: 'medical',
						bytes: Buffer.byteLength(medicalCsv),
						artifacts: { canonicalCsv: medicalPath },
						mapping: { source: 'canonical', fields: {} }
					}
				],
				validation: {
					productionReady: false,
					session: {
						eligibilityPresent: false,
						medicalPresent: true,
						pharmacyPresent: false,
						claimMembersEligibleAssumptionAccepted: true
					}
				}
			});

			await runPython(manifestPath, outDir);

			const status = JSON.parse(await readFile(join(outDir, 'python-status.json'), 'utf8'));
			const eligibilityRows = csvRows(
				await readFile(join(outDir, 'etl', 'eligibility_clean.csv'), 'utf8')
			);
			const pharmacyRows = csvRows(
				await readFile(join(outDir, 'etl', 'pharmacy_clean.csv'), 'utf8')
			);
			const validation = JSON.parse(
				await readFile(join(outDir, 'etl', 'etl_validation.json'), 'utf8')
			);

			expect(status.etlStatus).toBe('complete_with_warnings');
			expect(status.analyticsReady).toBe(false);
			expect(eligibilityRows).toHaveLength(1);
			expect(eligibilityRows[0].source).toBe('assumed_from_claim_members');
			expect(pharmacyRows).toHaveLength(0);
			expect(validation.eligibility.assumedFromClaims).toBe(true);
			expect(
				validation.warnings.blocking.some(
					(warning: { code: string }) => warning.code === 'assumed_eligibility'
				)
			).toBe(true);
			expect(JSON.stringify(status)).not.toContain('M001');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20000);

	it('blocks analytics readiness when eligibility is missing without explicit assumption', async () => {
		const dir = await mkdtemp(join(process.cwd(), 'var', 'test-etl-'));
		try {
			const canonicalDir = join(dir, 'canonical');
			const outDir = join(dir, 'analysis');
			await mkdir(canonicalDir, { recursive: true });
			await mkdir(outDir, { recursive: true });

			const medicalCsv = [
				'member_id,date_service_start,amount_total,claim_id,pos_code,icd_1',
				'M001,2024-01-05,125.00,C1,11,I10'
			].join('\n');
			const medicalPath = join(canonicalDir, 'medical.csv');
			await writeFile(medicalPath, medicalCsv, 'utf8');

			const manifestPath = await writeManifest(dir, {
				manifestVersion: 2,
				sessionId: 'test_etl_missing_eligibility',
				accountId: 'testClient',
				files: [
					{
						filename: 'medical.csv',
						fileType: 'medical',
						bytes: Buffer.byteLength(medicalCsv),
						artifacts: { canonicalCsv: medicalPath },
						mapping: { source: 'canonical', fields: {} }
					}
				],
				validation: {
					productionReady: false,
					session: {
						eligibilityPresent: false,
						medicalPresent: true,
						pharmacyPresent: false,
						claimMembersEligibleAssumptionAccepted: false
					}
				}
			});

			await runPython(manifestPath, outDir);

			const status = JSON.parse(await readFile(join(outDir, 'python-status.json'), 'utf8'));
			const validation = JSON.parse(
				await readFile(join(outDir, 'etl', 'etl_validation.json'), 'utf8')
			);
			const eligibilityRows = csvRows(
				await readFile(join(outDir, 'etl', 'eligibility_clean.csv'), 'utf8')
			);

			expect(status.etlStatus).toBe('blocked');
			expect(status.analyticsReady).toBe(false);
			expect(eligibilityRows).toHaveLength(0);
			expect(
				validation.warnings.blocking.some(
					(warning: { code: string }) => warning.code === 'missing_eligibility'
				)
			).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20000);
});
