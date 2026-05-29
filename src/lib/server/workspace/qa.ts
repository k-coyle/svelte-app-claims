import { readFile } from 'node:fs/promises';
import type { AnalysisManifest } from '$lib/analysis/types';

export type QaMetric = {
	key: string;
	label: string;
	value: string | number;
	tone: 'default' | 'good' | 'warning';
};

export type QaWarning = {
	code: string;
	message: string;
	severity: 'blocking' | 'quality';
};

export type CuratedArtifact = {
	key: string;
	label: string;
	href: string;
	format: 'json' | 'csv' | 'xlsx';
};

export type WorkspaceQa = {
	source: 'empty' | 'validation' | 'etl';
	analyticsReady: boolean;
	productionReady: boolean;
	metrics: QaMetric[];
	warnings: {
		blocking: QaWarning[];
		quality: QaWarning[];
	};
	artifacts: CuratedArtifact[];
};

const money = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0
});

const knownEtlArtifacts: Record<string, { label: string; format: 'csv' | 'json' }> = {
	eligibilityClean: { label: 'Eligibility clean CSV', format: 'csv' },
	medicalClean: { label: 'Medical clean CSV', format: 'csv' },
	pharmacyClean: { label: 'Pharmacy clean CSV', format: 'csv' },
	medicalDiagnosisLong: { label: 'Diagnosis long CSV', format: 'csv' },
	memberComorbidity: { label: 'Member comorbidity CSV', format: 'csv' },
	validation: { label: 'ETL validation JSON', format: 'json' }
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value.replaceAll(',', ''));
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function csvRows(text: string) {
	const lines = text.trim().split(/\r?\n/).filter(Boolean);
	if (!lines.length) return [];
	const headers = splitCsvLine(lines[0]);
	return lines.slice(1).map((line) => {
		const values = splitCsvLine(line);
		return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
	});
}

function splitCsvLine(line: string) {
	const values: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];
		if (char === '"' && inQuotes && next === '"') {
			current += '"';
			index += 1;
		} else if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			values.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	values.push(current);
	return values;
}

async function readJson(path?: string) {
	if (!path) return null;
	try {
		return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function sumCsvColumn(path: string | undefined, column: string) {
	if (!path) return 0;
	try {
		const rows = csvRows(await readFile(path, 'utf8'));
		return rows.reduce((sum, row) => sum + asNumber(row[column]), 0);
	} catch {
		return 0;
	}
}

async function countCsvRows(path: string | undefined) {
	if (!path) return 0;
	try {
		return csvRows(await readFile(path, 'utf8')).length;
	} catch {
		return 0;
	}
}

function rowCount(validation: Record<string, unknown>, bucket: 'source' | 'clean', key: string) {
	const rowCounts = asRecord(validation.rowCounts);
	return asNumber(asRecord(asRecord(rowCounts[bucket])[key]));
}

function sumNestedNumbers(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumNestedNumbers(item), 0);
	if (value && typeof value === 'object') {
		return Object.values(value).reduce((sum, item) => sum + sumNestedNumbers(item), 0);
	}
	return 0;
}

function validationWarnings(validation: Record<string, unknown>) {
	const warnings = asRecord(validation.warnings);
	const normalize = (items: unknown, severity: QaWarning['severity']) =>
		(Array.isArray(items) ? items : [])
			.map((item) => asRecord(item))
			.map((item) => ({
				severity,
				code: String(item.code ?? severity),
				message: String(item.message ?? item.code ?? severity)
			}));

	return {
		blocking: normalize(warnings.blocking, 'blocking'),
		quality: normalize(warnings.quality, 'quality')
	};
}

function uploadWarnings(manifest: AnalysisManifest) {
	const warnings = Array.isArray(manifest.validation?.warnings) ? manifest.validation.warnings : [];
	return {
		blocking: warnings
			.filter((warning) => warning.severity === 'blocking')
			.map((warning) => ({
				severity: 'blocking' as const,
				code: String(warning.code ?? 'blocking'),
				message: String(warning.message ?? warning.code ?? 'Blocking warning')
			})),
		quality: warnings
			.filter((warning) => warning.severity !== 'blocking')
			.map((warning) => ({
				severity: 'quality' as const,
				code: String(warning.code ?? 'quality'),
				message: String(warning.message ?? warning.code ?? 'Quality warning')
			}))
	};
}

function metric(
	key: string,
	label: string,
	value: string | number,
	tone: QaMetric['tone']
): QaMetric {
	return { key, label, value, tone };
}

function currency(value: number) {
	return money.format(value);
}

function curatedArtifacts(manifest: AnalysisManifest): CuratedArtifact[] {
	const sessionId = encodeURIComponent(manifest.sessionId);
	const artifacts: CuratedArtifact[] = [];

	if (manifest.artifacts?.manifest) {
		artifacts.push({
			key: 'manifest',
			label: 'Manifest JSON',
			format: 'json',
			href: `/artifacts/${sessionId}/manifest`
		});
	}

	if (manifest.etlValidationPath || manifest.etlArtifacts?.validation) {
		artifacts.push({
			key: 'etlValidation',
			label: 'ETL validation JSON',
			format: 'json',
			href: `/artifacts/${sessionId}/etlValidation`
		});
	}

	for (const [key, details] of Object.entries(knownEtlArtifacts)) {
		if (key === 'validation' || !manifest.etlArtifacts?.[key]) continue;
		artifacts.push({
			key,
			label: details.label,
			format: details.format,
			href: `/artifacts/${sessionId}/${key}`
		});
	}

	if (manifest.artifacts?.reportXlsx) {
		artifacts.push({
			key: 'reportWorkbook',
			label: 'Analysis report workbook',
			format: 'xlsx',
			href: `/artifacts/${sessionId}/reportWorkbook`
		});
	}

	return artifacts;
}

export async function buildWorkspaceQa(manifest: AnalysisManifest | null): Promise<WorkspaceQa> {
	if (!manifest) {
		return {
			source: 'empty',
			analyticsReady: false,
			productionReady: false,
			metrics: [],
			warnings: { blocking: [], quality: [] },
			artifacts: []
		};
	}

	const etlValidation =
		manifest.etlValidation ??
		(await readJson(manifest.etlValidationPath ?? manifest.etlArtifacts?.validation));

	if (etlValidation) {
		const medicalTotal = await sumCsvColumn(manifest.etlArtifacts?.medicalClean, 'amount_total');
		const pharmacyTotal = await sumCsvColumn(manifest.etlArtifacts?.pharmacyClean, 'amount_total');
		const memberCount =
			rowCount(etlValidation, 'clean', 'memberComorbidity') ||
			(await countCsvRows(manifest.etlArtifacts?.memberComorbidity));
		const sourceRows =
			rowCount(etlValidation, 'source', 'eligibility') +
			rowCount(etlValidation, 'source', 'medical') +
			rowCount(etlValidation, 'source', 'pharmacy');
		const rejectedRows = sumNestedNumbers(etlValidation.droppedRows);
		const warnings = validationWarnings(etlValidation);
		const analyticsReady = Boolean(etlValidation.analyticsReady ?? manifest.analyticsReady);

		return {
			source: 'etl',
			analyticsReady,
			productionReady: Boolean(etlValidation.productionReady) && analyticsReady,
			metrics: [
				metric(
					'analytics_ready',
					'Analytics readiness',
					analyticsReady ? 'Ready' : 'Review',
					analyticsReady ? 'good' : 'warning'
				),
				metric(
					'blocking_warnings',
					'Blocking warnings',
					warnings.blocking.length,
					warnings.blocking.length ? 'warning' : 'good'
				),
				metric('source_rows', 'Source rows', sourceRows, 'default'),
				metric('rejected_rows', 'Rejected rows', rejectedRows, rejectedRows ? 'warning' : 'good'),
				metric('member_count', 'Members', memberCount, 'default'),
				metric(
					'medical_claims',
					'Medical claims',
					rowCount(etlValidation, 'clean', 'medical'),
					'default'
				),
				metric(
					'pharmacy_claims',
					'Pharmacy claims',
					rowCount(etlValidation, 'clean', 'pharmacy'),
					'default'
				),
				metric('medical_total', 'Medical total', currency(medicalTotal), 'default'),
				metric('pharmacy_total', 'Rx total', currency(pharmacyTotal), 'default')
			],
			warnings,
			artifacts: curatedArtifacts(manifest)
		};
	}

	const warnings = uploadWarnings(manifest);
	const sourceRows = manifest.files.reduce((sum, file) => sum + Number(file.rowCount ?? 0), 0);
	return {
		source: 'validation',
		analyticsReady: false,
		productionReady: Boolean(manifest.validation?.productionReady),
		metrics: [
			metric('analytics_ready', 'Analytics readiness', 'Pending ETL', 'warning'),
			metric(
				'blocking_warnings',
				'Blocking warnings',
				warnings.blocking.length,
				warnings.blocking.length ? 'warning' : 'good'
			),
			metric('source_rows', 'Source rows', sourceRows, 'default'),
			metric('rejected_rows', 'Rejected rows', 0, 'default'),
			metric('member_count', 'Members', 'Pending ETL', 'default'),
			metric('medical_claims', 'Medical claims', 'Pending ETL', 'default'),
			metric('pharmacy_claims', 'Pharmacy claims', 'Pending ETL', 'default'),
			metric('medical_total', 'Medical total', 'Pending ETL', 'default'),
			metric('pharmacy_total', 'Rx total', 'Pending ETL', 'default')
		],
		warnings,
		artifacts: curatedArtifacts(manifest)
	};
}
