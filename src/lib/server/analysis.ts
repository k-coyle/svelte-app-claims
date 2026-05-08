import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ClaimsRunProfile } from './claimsProfile';
import {
	parseReportWorkbookBuffer,
	type ReportWorkbookSummary
} from './reportWorkbook';

export type AnalysisFileType = 'eligibility' | 'medical' | 'pharmacy' | 'vision' | 'dental' | string;

export type AnalysisFileInput = {
	path: string;
	filename: string;
	bytes: number;
	fileType: AnalysisFileType;
	rowCount?: number | null;
	headers?: string[] | null;
};

export type AnalysisRunStatus = 'ready_for_etl' | 'waiting_for_files' | 'ready_for_bi' | 'python_pending';

export type AnalysisRequirement = {
	key: 'eligibility' | 'medical' | 'pharmacy' | 'bi';
	label: string;
	status: 'met' | 'needed' | 'optional';
	description: string;
};

export type AnalysisManifest = {
	sessionId: string;
	accountId: string;
	createdAt: string;
	status: AnalysisRunStatus;
	files: AnalysisFileInput[];
	requirements: AnalysisRequirement[];
	metrics: Array<{ label: string; value: string | number; tone?: 'default' | 'good' | 'warning' }>;
	artifacts: {
		manifest: string;
		dashboard: string;
		reportWorkbook?: string;
		claimsProfile?: string;
	};
	report?: ReportWorkbookSummary;
	claims?: ClaimsRunProfile;
	python: {
		vendoredRoot: string;
		requirementsFile: string;
		runner: string;
		status: 'not_checked' | 'ready' | 'missing_dependencies';
		notes: string[];
	};
};

const analysisRoot = join(process.cwd(), 'var', 'analysis');
const vendoredRoot = join(process.cwd(), 'python', 'claims_analysis');
const requirementsFile = join(vendoredRoot, 'requirements.txt');
const runnerFile = join(vendoredRoot, 'run_analysis.py');

function runDir(sessionId: string) {
	return join(analysisRoot, sessionId);
}

function uniqueFileTypes(files: AnalysisFileInput[]) {
	return new Set(files.map((file) => file.fileType));
}

function buildRequirements(files: AnalysisFileInput[]): AnalysisRequirement[] {
	const fileTypes = uniqueFileTypes(files);
	const hasEligibility = fileTypes.has('eligibility');
	const hasMedical = fileTypes.has('medical');
	const hasPharmacy = fileTypes.has('pharmacy');

	return [
		{
			key: 'eligibility',
			label: 'Eligibility baseline',
			status: hasEligibility ? 'met' : 'needed',
			description: hasEligibility
				? 'Eligibility records can establish member-month coverage.'
				: 'Claims BI needs eligibility to establish covered population and FTE.'
		},
		{
			key: 'medical',
			label: 'Medical claims',
			status: hasMedical ? 'met' : 'needed',
			description: hasMedical
				? 'Medical claims can feed diagnosis, chronic-condition, IP, ER, and cost logic.'
				: 'Medical claims are required for chronic-condition and utilization analytics.'
		},
		{
			key: 'pharmacy',
			label: 'Pharmacy claims',
			status: hasPharmacy ? 'met' : 'optional',
			description: hasPharmacy
				? 'Pharmacy claims can be included in total cost and Rx cost views.'
				: 'Pharmacy is optional for early ETL, but needed for total cost reporting.'
		},
		{
			key: 'bi',
			label: 'BI dashboard inputs',
			status: hasEligibility && hasMedical ? 'met' : 'needed',
			description:
				hasEligibility && hasMedical
					? 'Core BI inputs are present. Pharmacy improves total cost views.'
					: 'The BI dashboard needs eligibility plus medical claims before full analysis.'
		}
	];
}

function deriveStatus(requirements: AnalysisRequirement[]): AnalysisRunStatus {
	const eligibility = requirements.find((item) => item.key === 'eligibility')?.status === 'met';
	const medical = requirements.find((item) => item.key === 'medical')?.status === 'met';
	const bi = requirements.find((item) => item.key === 'bi')?.status === 'met';

	if (bi) return 'ready_for_bi';
	if (eligibility || medical) return 'ready_for_etl';
	return 'waiting_for_files';
}

function buildMetrics(files: AnalysisFileInput[], status: AnalysisRunStatus) {
	const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
	const totalRows = files.reduce((sum, file) => sum + Number(file.rowCount ?? 0), 0);
	const fileTypeList = [...uniqueFileTypes(files)].join(', ') || 'none';

	return [
		{ label: 'Files captured', value: files.length, tone: 'default' as const },
		{ label: 'Rows available', value: totalRows, tone: 'good' as const },
		{ label: 'Total MB', value: (totalBytes / 1048576).toFixed(2), tone: 'default' as const },
		{
			label: 'Analysis state',
			value: status.replaceAll('_', ' '),
			tone: status === 'ready_for_bi' ? ('good' as const) : ('warning' as const)
		},
		{ label: 'File types', value: fileTypeList, tone: 'default' as const }
	];
}

function buildClaimsMetrics(claims: ClaimsRunProfile) {
	return [
		{ label: 'Claims profiled', value: claims.summary.profiledRows, tone: 'good' as const },
		{ label: 'Unique members', value: claims.summary.uniqueMembers, tone: 'default' as const },
		{
			label: 'Claim amount',
			value: currency(claims.summary.totalAmount),
			tone: 'default' as const
		},
		{ label: 'Files captured', value: claims.summary.fileCount, tone: 'default' as const },
		{ label: 'Profile source', value: 'uploaded claims', tone: 'good' as const }
	];
}

function currency(value: number | null | undefined) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	}).format(value);
}

function buildReportMetrics(report: ReportWorkbookSummary) {
	const latest = report.latestYear;

	return [
		{ label: 'Report years', value: report.yearCount, tone: 'good' as const },
		{
			label: 'Latest medical cost',
			value: currency(latest?.medicalTotalAfterExclusions ?? latest?.medicalTotal),
			tone: 'default' as const
		},
		{
			label: 'Latest PPPY',
			value: currency(latest?.medicalPppyAfterExclusions ?? latest?.medicalPppy),
			tone: 'default' as const
		},
		{
			label: 'Exclusion savings',
			value: currency(latest?.exclusionSavings),
			tone: 'good' as const
		},
		{ label: 'Sections parsed', value: report.sectionCount, tone: 'default' as const }
	];
}

function pythonStatusNotes() {
	return [
		'Vendored ETL and BI code is present under python/claims_analysis.',
		'Python execution is intentionally staged behind this manifest layer.',
		'Install python/claims_analysis/requirements.txt before enabling deep ETL/BI execution.'
	];
}

function pythonManifestStatus() {
	return {
		vendoredRoot,
		requirementsFile,
		runner: runnerFile,
		status: 'not_checked' as const,
		notes: pythonStatusNotes()
	};
}

export async function writeAnalysisArtifacts(input: {
	sessionId: string;
	accountId: string;
	files: AnalysisFileInput[];
	claims?: ClaimsRunProfile | null;
	createdAt?: string;
}) {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const dir = runDir(input.sessionId);
	await mkdir(dir, { recursive: true });

	const requirements = buildRequirements(input.files);
	const status = deriveStatus(requirements);
	const dashboardPath = join(dir, 'dashboard.json');
	const manifestPath = join(dir, 'manifest.json');
	const claimsProfilePath = input.claims ? join(dir, 'claims-profile.json') : undefined;

	if (input.claims && claimsProfilePath) {
		await writeFile(claimsProfilePath, `${JSON.stringify(input.claims, null, 2)}\n`, 'utf8');
	}

	const manifest: AnalysisManifest = {
		sessionId: input.sessionId,
		accountId: input.accountId,
		createdAt,
		status,
		files: input.files,
		requirements,
		metrics: input.claims ? buildClaimsMetrics(input.claims) : buildMetrics(input.files, status),
		artifacts: {
			manifest: manifestPath,
			dashboard: dashboardPath,
			claimsProfile: claimsProfilePath
		},
		claims: input.claims ?? undefined,
		python: {
			...pythonManifestStatus()
		}
	};

	const dashboard = {
		sessionId: manifest.sessionId,
		accountId: manifest.accountId,
		status: manifest.status,
		createdAt: manifest.createdAt,
		metrics: manifest.metrics,
		requirements: manifest.requirements,
		claims: input.claims ?? null,
		files: manifest.files.map((file) => ({
			filename: file.filename,
			fileType: file.fileType,
			rowCount: file.rowCount,
			headers: file.headers ?? []
		}))
	};

	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	await writeFile(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');

	return manifest;
}

export async function writeReportWorkbookArtifacts(input: {
	accountId: string;
	filename: string;
	bytes: number;
	buffer: Buffer;
	createdAt?: string;
	sessionId?: string;
}): Promise<AnalysisManifest> {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const sessionId = input.sessionId ?? `report_${randomUUID()}`;
	const dir = runDir(sessionId);
	await mkdir(dir, { recursive: true });

	const parsed = parseReportWorkbookBuffer(input.buffer, input.filename);
	const dashboardPath = join(dir, 'dashboard.json');
	const manifestPath = join(dir, 'manifest.json');
	const reportWorkbookPath = join(dir, 'report-workbook.json');
	const sourceWorkbookPath = join(dir, 'source-workbook.xlsx');

	await writeFile(reportWorkbookPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
	await writeFile(sourceWorkbookPath, input.buffer);

	const files: AnalysisFileInput[] = [
		{
			path: sourceWorkbookPath,
			filename: input.filename,
			bytes: input.bytes,
			fileType: 'report_workbook',
			rowCount: parsed.years.reduce((sum, year) => sum + Object.keys(year.sections).length, 0),
			headers: parsed.summary.availableSections.slice(0, 10)
		}
	];

	const requirements: AnalysisRequirement[] = [
		{
			key: 'eligibility',
			label: 'Eligibility baseline',
			status: 'met',
			description: 'Eligibility denominator logic is already reflected in the imported report output.'
		},
		{
			key: 'medical',
			label: 'Medical claims',
			status: 'met',
			description: 'Medical claims are already represented in the yearly report sections.'
		},
		{
			key: 'pharmacy',
			label: 'Pharmacy claims',
			status: parsed.summary.years.some((year) => Number(year.pharmacyTotal ?? 0) > 0)
				? 'met'
				: 'optional',
			description:
				'Pharmacy claims are supported by the report shape; this workbook has no pharmacy spend.'
		},
		{
			key: 'bi',
			label: 'BI dashboard inputs',
			status: 'met',
			description: 'Yearly write_excel_report output has been parsed into dashboard-ready artifacts.'
		}
	];

	const manifest: AnalysisManifest = {
		sessionId,
		accountId: input.accountId,
		createdAt,
		status: 'ready_for_bi',
		files,
		requirements,
		metrics: buildReportMetrics(parsed.summary),
		artifacts: {
			manifest: manifestPath,
			dashboard: dashboardPath,
			reportWorkbook: reportWorkbookPath
		},
		report: parsed.summary,
		python: {
			...pythonManifestStatus()
		}
	};

	const dashboard = {
		sessionId: manifest.sessionId,
		accountId: manifest.accountId,
		status: manifest.status,
		createdAt: manifest.createdAt,
		metrics: manifest.metrics,
		requirements: manifest.requirements,
		files: manifest.files,
		report: parsed.summary
	};

	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	await writeFile(dashboardPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');

	return manifest;
}

export async function listAnalysisManifests(limit = 25): Promise<AnalysisManifest[]> {
	try {
		const entries = await readdir(analysisRoot, { withFileTypes: true });
		const manifests = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map(async (entry) => {
					try {
						const raw = await readFile(join(analysisRoot, entry.name, 'manifest.json'), 'utf8');
						return JSON.parse(raw) as AnalysisManifest;
					} catch {
						return null;
					}
				})
		);

		return manifests
			.filter((manifest): manifest is AnalysisManifest => Boolean(manifest))
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
			.slice(0, limit);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}
}

export async function getLatestAnalysisManifest() {
	return (await listAnalysisManifests(1))[0] ?? null;
}

export function analysisPathsForSession(sessionId: string) {
	const dir = runDir(sessionId);
	return {
		dir,
		manifest: join(dir, 'manifest.json'),
		dashboard: join(dir, 'dashboard.json'),
		root: dirname(dir)
	};
}
