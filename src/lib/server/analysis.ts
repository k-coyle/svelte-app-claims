import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ClaimsRunProfile } from './claimsProfile';
import type { AnalysisReportSummary as ReportWorkbookSummary } from '$lib/analysis/types';

export type AnalysisFileType =
	| 'eligibility'
	| 'medical'
	| 'pharmacy'
	| 'vision'
	| 'dental'
	| string;

export type AnalysisMappingSource = 'stored' | 'provided' | 'canonical' | 'none';

export type AnalysisFileInput = {
	fileId?: string;
	path: string;
	filename: string;
	bytes: number;
	fileType: AnalysisFileType;
	rowCount?: number | null;
	headers?: string[] | null;
	mime?: string;
	mapping?: {
		source: AnalysisMappingSource;
		mode?: string;
		version?: number;
		fields?: Record<string, string>;
		fieldCount?: number;
	};
	validation?: Record<string, unknown>;
	invalidRowCount?: number;
	rejectedRowCount?: number;
	artifacts?: {
		canonicalCsv?: string;
	};
};

export type AnalysisRunStatus =
	| 'ready_for_etl'
	| 'waiting_for_files'
	| 'ready_for_bi'
	| 'python_pending';

export type AnalysisRequirement = {
	key: 'eligibility' | 'medical' | 'pharmacy' | 'bi';
	label: string;
	status: 'met' | 'needed' | 'optional';
	description: string;
};

export type AnalysisManifest = {
	manifestVersion?: number;
	sessionId: string;
	accountId: string;
	createdAt: string;
	status: AnalysisRunStatus;
	fileTypes?: string[];
	files: AnalysisFileInput[];
	requirements: AnalysisRequirement[];
	metrics: Array<{ label: string; value: string | number; tone?: 'default' | 'good' | 'warning' }>;
	artifacts: {
		manifest: string;
		dashboard: string;
		reportWorkbook?: string;
		reportXlsx?: string;
		claimsProfile?: string;
		reportSections?: string;
		etl?: Record<string, string>;
	};
	mapping?: {
		source: AnalysisMappingSource;
		version?: number;
		fields?: Record<string, string>;
	};
	validation?: Record<string, unknown>;
	etlArtifacts?: Record<string, string>;
	etlValidationPath?: string;
	etlStatus?: string;
	analyticsReady?: boolean;
	etlValidation?: Record<string, unknown>;
	rawUploadRetention?: Record<string, unknown>;
	report?: ReportWorkbookSummary;
	claims?: ClaimsRunProfile;
	python: {
		pythonRoot: string;
		requirementsFile: string;
		runner: string;
		status: 'not_checked' | 'ready' | 'missing_dependencies' | 'error';
		notes: string[];
	};
};

const analysisRoot = join(process.cwd(), 'var', 'analysis');
const pythonRoot = join(process.cwd(), 'python', 'claims_analysis');
const requirementsFile = join(pythonRoot, 'requirements.txt');
const runnerFile = join(pythonRoot, 'run_analysis.py');
const localVenvPython = join(process.cwd(), '.venv', 'Scripts', 'python.exe');

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
		'Source-of-truth ETL and BI code is present under python/claims_analysis.',
		'Python execution is intentionally staged behind this manifest layer.',
		'Install python/claims_analysis/requirements.txt before enabling deep ETL/BI execution.'
	];
}

function pythonManifestStatus() {
	return {
		pythonRoot,
		requirementsFile,
		runner: runnerFile,
		status: 'not_checked' as const,
		notes: pythonStatusNotes()
	};
}

async function readJsonFile<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

function recordValue(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}

async function runPythonAnalysis(input: { manifestPath: string; outDir: string }) {
	const pythonBin =
		process.env.CLAIMS_PYTHON_BIN ??
		process.env.PYTHON_BIN ??
		(existsSync(localVenvPython) ? localVenvPython : 'python');
	const args = [runnerFile, '--manifest', input.manifestPath, '--out-dir', input.outDir];
	const child = spawn(pythonBin, args, {
		cwd: pythonRoot,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk) => (stdout += String(chunk)));
	child.stderr.on('data', (chunk) => (stderr += String(chunk)));

	const code = await new Promise<number>((resolve) => {
		child.on('error', () => resolve(-1));
		child.on('close', (exitCode) => resolve(exitCode ?? -1));
	});

	const statusPath = join(input.outDir, 'python-status.json');
	const reportPath = join(input.outDir, 'report-sections.json');
	const status = await readJsonFile<Record<string, unknown>>(statusPath);
	const report = await readJsonFile<{ summary?: ReportWorkbookSummary }>(reportPath);

	return {
		code,
		stdout,
		stderr,
		statusPath,
		reportPath,
		status,
		report: report?.summary ?? null
	};
}

export async function writeAnalysisArtifacts(input: {
	manifestVersion?: number;
	sessionId: string;
	accountId: string;
	files: AnalysisFileInput[];
	fileTypes?: string[];
	claims?: ClaimsRunProfile | null;
	mapping?: AnalysisManifest['mapping'];
	validation?: AnalysisManifest['validation'];
	rawUploadRetention?: AnalysisManifest['rawUploadRetention'];
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
	const reportSectionsPath = join(dir, 'report-sections.json');

	if (input.claims && claimsProfilePath) {
		await writeFile(claimsProfilePath, `${JSON.stringify(input.claims, null, 2)}\n`, 'utf8');
	}

	const manifest: AnalysisManifest = {
		manifestVersion: input.manifestVersion,
		sessionId: input.sessionId,
		accountId: input.accountId,
		createdAt,
		status,
		fileTypes: input.fileTypes,
		files: input.files,
		requirements,
		metrics: input.claims ? buildClaimsMetrics(input.claims) : buildMetrics(input.files, status),
		artifacts: {
			manifest: manifestPath,
			dashboard: dashboardPath,
			claimsProfile: claimsProfilePath,
			reportSections: reportSectionsPath
		},
		mapping: input.mapping,
		validation: input.validation,
		rawUploadRetention: input.rawUploadRetention,
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

	const pythonResult = await runPythonAnalysis({ manifestPath, outDir: dir });
	const etlArtifacts = recordValue(pythonResult.status?.etlArtifacts);
	if (etlArtifacts) {
		manifest.etlArtifacts = etlArtifacts;
		manifest.artifacts.etl = etlArtifacts;
	}
	if (typeof pythonResult.status?.etlValidationPath === 'string') {
		manifest.etlValidationPath = pythonResult.status.etlValidationPath;
	}
	if (typeof pythonResult.status?.etlStatus === 'string') {
		manifest.etlStatus = pythonResult.status.etlStatus;
	}
	if (typeof pythonResult.status?.analyticsReady === 'boolean') {
		manifest.analyticsReady = pythonResult.status.analyticsReady;
	}
	if (
		pythonResult.status?.etlValidation &&
		typeof pythonResult.status.etlValidation === 'object' &&
		!Array.isArray(pythonResult.status.etlValidation)
	) {
		manifest.etlValidation = pythonResult.status.etlValidation as Record<string, unknown>;
	}
	if (pythonResult.report) {
		manifest.report = pythonResult.report;
		if (typeof pythonResult.status?.xlsxReportPath === 'string') {
			manifest.artifacts.reportXlsx = pythonResult.status.xlsxReportPath;
		}
		manifest.status = 'ready_for_bi';
		manifest.metrics = buildReportMetrics(pythonResult.report);
		manifest.requirements = manifest.requirements.map((requirement) => {
			if (requirement.key === 'bi') {
				return {
					...requirement,
					status: 'met',
					description: 'Python report sections were generated from canonical ingestion artifacts.'
				};
			}
			return requirement;
		});
	}

	if (pythonResult.status?.ok === true) {
		manifest.python = {
			...manifest.python,
			status: 'ready',
			notes: [
				'Python runner completed and wrote dashboard-ready report sections.',
				`Runner mode: ${String(pythonResult.status.mode ?? 'unknown')}.`,
				'Python dependency readiness is recorded in python-status.json.'
			]
		};
	} else {
		manifest.python = {
			...manifest.python,
			status: 'error',
			notes: [
				'Python runner did not complete successfully.',
				pythonResult.stderr || pythonResult.stdout || 'See python-status.json for details.'
			]
		};
	}

	const enrichedDashboard = {
		...dashboard,
		status: manifest.status,
		metrics: manifest.metrics,
		requirements: manifest.requirements,
		python: manifest.python,
		report: manifest.report ?? null,
		etl: {
			status: manifest.etlStatus,
			analyticsReady: manifest.analyticsReady,
			artifacts: manifest.etlArtifacts,
			validationPath: manifest.etlValidationPath
		}
	};

	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	await writeFile(dashboardPath, `${JSON.stringify(enrichedDashboard, null, 2)}\n`, 'utf8');

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

function isSafeSessionId(sessionId: string) {
	return /^[A-Za-z0-9_.-]+$/.test(sessionId);
}

async function readAnalysisManifestForSession(sessionId: string) {
	if (!isSafeSessionId(sessionId)) return null;
	return readJsonFile<AnalysisManifest>(join(runDir(sessionId), 'manifest.json'));
}

export async function listAnalysisManifestsForSessions(
	sessionIds: string[]
): Promise<AnalysisManifest[]> {
	const uniqueSessionIds = Array.from(new Set(sessionIds.filter(isSafeSessionId)));
	if (!uniqueSessionIds.length) return [];

	const manifests = await Promise.all(uniqueSessionIds.map(readAnalysisManifestForSession));
	return manifests
		.filter((manifest): manifest is AnalysisManifest => Boolean(manifest))
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
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

export async function rerunAnalysisForSession(sessionId: string): Promise<AnalysisManifest> {
	if (!/^[A-Za-z0-9_.-]+$/.test(sessionId)) {
		throw new Error('Invalid session identifier.');
	}
	const paths = analysisPathsForSession(sessionId);
	const manifest = await readJsonFile<AnalysisManifest>(paths.manifest);
	if (!manifest) {
		throw new Error('Analysis manifest was not found for this session.');
	}

	return writeAnalysisArtifacts({
		manifestVersion: manifest.manifestVersion,
		sessionId: manifest.sessionId,
		accountId: manifest.accountId,
		files: manifest.files,
		fileTypes: manifest.fileTypes,
		claims: manifest.claims ?? null,
		mapping: manifest.mapping,
		validation: manifest.validation,
		rawUploadRetention: manifest.rawUploadRetention,
		createdAt: manifest.createdAt
	});
}
