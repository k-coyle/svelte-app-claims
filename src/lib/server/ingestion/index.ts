import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { mappingPayloadToFields } from '$lib/server/mappingImport';

export const SUPPORTED_FILE_TYPES = ['eligibility', 'medical', 'pharmacy'] as const;
export type SupportedIngestionFileType = (typeof SUPPORTED_FILE_TYPES)[number];
export type IngestionMappingSource = 'stored' | 'provided' | 'canonical' | 'none';
export type IngestionMappingMode = 'stored' | 'provided' | 'canonical' | 'auto';

export type UploadedFile = {
	name: string;
	type?: string;
	buf: Buffer;
};

export type FileStat = {
	filename: string;
	bytes: number;
	rowCount: number | null;
	mime?: string;
	headers?: string[] | null;
};

export type IngestionMapping = {
	source: IngestionMappingSource;
	mode: IngestionMappingMode;
	version?: number;
	fields: Record<string, string>;
	fieldCount: number;
	error?: string;
};

export type RequiredFieldCoverage = {
	status: 'met' | 'missing' | 'generated' | 'optional';
	fields: string[];
};

export type IngestionFileValidation = {
	status: 'ok' | 'warning' | 'blocking';
	requiredCoverage: Record<string, RequiredFieldCoverage>;
	blockingWarnings: string[];
	qualityWarnings: string[];
	invalidRowCount: number;
	rejectedRowCount: number;
};

export type IngestionWarning = {
	severity: 'blocking' | 'quality';
	code: string;
	message: string;
	fileId?: string;
	filename?: string;
	fileType?: SupportedIngestionFileType;
};

export type IngestionFileProfile = {
	fileId: string;
	filename: string;
	bytes: number;
	mime?: string;
	rowCount: number | null;
	dataRowCount: number;
	headers: string[] | null;
	inferredFileType: SupportedIngestionFileType;
	fileType: SupportedIngestionFileType;
	mapping: IngestionMapping;
	validation: IngestionFileValidation;
};

export type CanonicalIngestionFile = IngestionFileProfile & {
	path: string;
	artifacts: {
		canonicalCsv: string;
	};
};

export type RawUploadRetention = {
	retained: boolean;
	reason: string;
	cleanupStatus: 'not_started' | 'deleted' | 'retained' | 'failed';
	rawUploadDir?: string;
};

export type IngestionSessionValidation = {
	productionReady: boolean;
	session: {
		eligibilityPresent: boolean;
		medicalPresent: boolean;
		pharmacyPresent: boolean;
		claimMembersEligibleAssumptionAccepted: boolean;
	};
	warnings: IngestionWarning[];
	files: Array<{
		fileId: string;
		filename: string;
		fileType: SupportedIngestionFileType;
		status: IngestionFileValidation['status'];
		invalidRowCount: number;
		rejectedRowCount: number;
	}>;
};

export type ActiveMappingLookup = (
	accountId: string,
	fileType: string
) => Promise<{ version: number; json: Record<string, unknown> } | null>;

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 20;
const HEADER_PEEK_MAX = 10;
const ALLOWED_EXTS = new Set(['.csv', '.tsv', '.txt', '.psv', '.xls', '.xlsx']);

const AMOUNT_FIELDS = [
	'amount_total',
	'amount_allowed',
	'amount_net_payment',
	'paid_amount',
	'amount_billed',
	'amount_patient_responsibility'
];

const MEDICAL_DATE_FIELDS = [
	'date_service_start',
	'date_service_end',
	'date_paid',
	'date_claim_processed'
];

const PHARMACY_DATE_FIELDS = ['date_filled', 'date_written', 'date_claim_processed', 'date_paid'];
const ELIGIBILITY_START_FIELDS = [
	'medical_eligibility_start_date',
	'eligibility_start_date',
	'coverage_start',
	'date_coverage_start'
];
const ELIGIBILITY_END_FIELDS = [
	'medical_eligibility_end_date',
	'eligibility_end_date',
	'coverage_end',
	'date_coverage_end'
];
const ELIGIBILITY_AS_OF_FIELDS = [
	'medical_eligibility_date_as_of',
	'eligibility_date_as_of',
	'coverage_as_of',
	'as_of_date'
];

export function getExt(name: string) {
	return name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
}

export function isTextLike(name: string, mime?: string) {
	const ext = getExt(name);
	return ['.csv', '.tsv', '.txt', '.psv'].includes(ext) || (mime?.startsWith('text/') ?? false);
}

function stripBOM(value: string) {
	return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function normalizeField(value: string) {
	return value
		.trim()
		.replace(/^\uFEFF/, '')
		.toLowerCase();
}

function safeSegment(value: string) {
	const cleaned = basename(value, getExt(value))
		.replace(/[^A-Za-z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned || 'file';
}

function detectDelimiter(line: string) {
	const candidates = [',', '\t', '|', ';'];
	return (
		candidates
			.map((delimiter) => ({ delimiter, count: splitDelimitedLine(line, delimiter).length }))
			.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ','
	);
}

function splitDelimitedLine(line: string, delimiter: string) {
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
		} else if (char === delimiter && !inQuotes) {
			values.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}

	values.push(current.trim());
	return values.map((value) => {
		if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
		return value;
	});
}

function csvEscape(value: unknown) {
	const text = String(value ?? '');
	if (!/[",\r\n]/.test(text)) return text;
	return `"${text.replaceAll('"', '""')}"`;
}

function canonicalHeader(header: string, index: number, fields: Record<string, string>) {
	const trimmed = header.trim();
	return fields[trimmed] ?? fields[normalizeField(trimmed)] ?? fields[String(index)] ?? trimmed;
}

function hasAny(headers: string[], fields: string[]) {
	return fields.filter((field) => headers.includes(field));
}

function hasDiagnosis(headers: string[]) {
	return headers.filter((field) => /^icd_?\d+$/i.test(field) || field.startsWith('diagnosis'));
}

function hasDrug(headers: string[]) {
	return headers.filter((field) =>
		['ndc', 'drug_name', 'gpi', 'rx_number', 'number'].includes(field)
	);
}

function coverage(
	status: RequiredFieldCoverage['status'],
	fields: string[] = []
): RequiredFieldCoverage {
	return { status, fields };
}

async function readSheetRows(buf: Buffer) {
	const XLSX = await import('xlsx');
	const wb = XLSX.read(buf, { type: 'buffer' });
	const firstSheet = wb.SheetNames[0];
	if (!firstSheet) return [];
	return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[firstSheet], {
		header: 1,
		raw: false,
		defval: ''
	}) as unknown[][];
}

export async function readTabularRows(file: UploadedFile) {
	const ext = getExt(file.name);
	if (ext === '.xlsx' || ext === '.xls') {
		return (await readSheetRows(file.buf)).map((row) =>
			row.map((value) => String(value ?? '').trim())
		);
	}

	const text = stripBOM(file.buf.toString('utf8'));
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (!lines.length) return [];
	const delimiter = detectDelimiter(lines[0]);
	return lines.map((line) => splitDelimitedLine(line, delimiter));
}

export async function countRowsSmart(file: UploadedFile) {
	return (await readTabularRows(file)).length;
}

export async function extractHeadersSmart(file: UploadedFile) {
	const rows = await readTabularRows(file);
	const header = Array.isArray(rows?.[0]) ? rows[0] : null;
	return header
		? header.slice(0, HEADER_PEEK_MAX).map((value) => String(value ?? '').trim())
		: null;
}

export async function readFilesFromForm(form: FormData) {
	const out: UploadedFile[] = [];
	let total = 0;

	for (const item of form.getAll('files')) {
		if (!(item instanceof File)) continue;
		const buf = Buffer.from(await item.arrayBuffer());
		total += buf.byteLength;
		if (total > MAX_UPLOAD_BYTES) throw new Error('Total upload too large (200MB limit).');
		out.push({ name: item.name, type: item.type, buf });
	}

	return out;
}

export function validateAllowedFiles(files: UploadedFile[]) {
	if (files.length > MAX_FILES) return `Too many files. Maximum allowed is ${MAX_FILES}.`;

	const bad = files.map((file) => file.name).filter((name) => !ALLOWED_EXTS.has(getExt(name)));
	if (bad.length) {
		return `These file types are not allowed: ${bad.join(', ')}. Allowed: ${Array.from(ALLOWED_EXTS).join(', ')}`;
	}

	return null;
}

export function inferFileType(
	filename: string,
	headers?: string[] | null
): SupportedIngestionFileType {
	const name = filename.toLowerCase();
	const joinedHeaders = (headers ?? []).join(' ').toLowerCase();
	if (
		name.includes('elig') ||
		joinedHeaders.includes('eligibility') ||
		joinedHeaders.includes('coverage')
	) {
		return 'eligibility';
	}
	if (
		name.includes('pharm') ||
		name.includes('rx') ||
		joinedHeaders.includes('ndc') ||
		joinedHeaders.includes('fill')
	) {
		return 'pharmacy';
	}
	return 'medical';
}

export function fileTypeFromForm(
	form: FormData,
	index: number,
	fallback: SupportedIngestionFileType
): SupportedIngestionFileType | null {
	const raw = String(form.get(`fileType:${index}`) ?? form.get('fileType') ?? fallback).trim();
	return SUPPORTED_FILE_TYPES.includes(raw as SupportedIngestionFileType)
		? (raw as SupportedIngestionFileType)
		: null;
}

function mappingModeFromForm(form: FormData, index: number): IngestionMappingMode {
	const raw = String(form.get(`mappingMode:${index}`) ?? '').trim();
	if (raw === 'stored' || raw === 'provided' || raw === 'canonical') return raw;
	if (form.get('useStoredMapping') === 'on') return 'stored';
	if (String(form.get(`mappingJson:${index}`) ?? form.get('mappingJson') ?? '').trim())
		return 'provided';
	return 'auto';
}

async function safeGetActiveMapping(
	accountId: string,
	fileType: SupportedIngestionFileType,
	getActiveMapping: ActiveMappingLookup
) {
	const timeoutMs = Number(process.env.MAPPING_LOOKUP_TIMEOUT_MS ?? 400);
	const timeout = Symbol('mapping-timeout');

	try {
		const lookup = getActiveMapping(accountId, fileType);
		const timed = new Promise<typeof timeout>((resolve) =>
			setTimeout(() => resolve(timeout), timeoutMs)
		);
		const result = await Promise.race([lookup, timed]);
		if (result === timeout) {
			console.warn(`mapping lookup timeout after ${timeoutMs}ms`);
			return null;
		}
		return result;
	} catch (e) {
		console.warn('mapping lookup failed:', e instanceof Error ? e.message : e);
		return null;
	}
}

export async function resolveFileMapping(input: {
	accountId: string;
	fileType: SupportedIngestionFileType;
	form: FormData;
	index: number;
	headers?: string[] | null;
	getActiveMapping: ActiveMappingLookup;
}): Promise<IngestionMapping> {
	const mode = mappingModeFromForm(input.form, input.index);
	const mappingJson = String(
		input.form.get(`mappingJson:${input.index}`) ?? input.form.get('mappingJson') ?? ''
	);

	if (mode === 'canonical') {
		return { source: 'canonical', mode, fields: {}, fieldCount: 0 };
	}

	if (mode === 'provided') {
		try {
			const payload = JSON.parse(mappingJson) as Record<string, unknown>;
			const fields = mappingPayloadToFields(payload, input.headers) ?? {};
			return { source: 'provided', mode, fields, fieldCount: Object.keys(fields).length };
		} catch {
			return { source: 'none', mode, fields: {}, fieldCount: 0, error: 'Mapping JSON is invalid.' };
		}
	}

	const stored = await safeGetActiveMapping(
		input.accountId,
		input.fileType,
		input.getActiveMapping
	);
	if (stored) {
		const fields = mappingPayloadToFields(stored.json, input.headers) ?? {};
		return {
			source: 'stored',
			mode,
			version: stored.version,
			fields,
			fieldCount: Object.keys(fields).length
		};
	}

	if (mode === 'stored') {
		return {
			source: 'none',
			mode,
			fields: {},
			fieldCount: 0,
			error: 'No stored mapping found for this account & file type.'
		};
	}

	return { source: 'none', mode, fields: {}, fieldCount: 0 };
}

function validateCanonicalHeaders(
	fileType: SupportedIngestionFileType,
	headers: string[]
): Omit<IngestionFileValidation, 'invalidRowCount' | 'rejectedRowCount'> {
	const normalized = headers.map(normalizeField);
	const requiredCoverage: Record<string, RequiredFieldCoverage> = {};
	const blockingWarnings: string[] = [];
	const qualityWarnings: string[] = [];

	if (fileType === 'eligibility') {
		const member = hasAny(normalized, ['member_id', 'employee_id', 'responsible_party_id']);
		const start = hasAny(normalized, ELIGIBILITY_START_FIELDS);
		const end = hasAny(normalized, ELIGIBILITY_END_FIELDS);
		const asOf = hasAny(normalized, ELIGIBILITY_AS_OF_FIELDS);
		requiredCoverage.member = coverage(member.length ? 'met' : 'missing', member);
		requiredCoverage.coverage = coverage(
			start.length && end.length ? 'met' : asOf.length ? 'met' : 'missing',
			[...start, ...end, ...asOf]
		);
		if (!member.length)
			blockingWarnings.push('Eligibility requires member_id or equivalent member identifier.');
		if (!start.length || (!end.length && !asOf.length)) {
			blockingWarnings.push(
				'Eligibility requires start/end coverage fields or an accepted as-of coverage field.'
			);
		}
	}

	if (fileType === 'medical') {
		const member = hasAny(normalized, ['member_id', 'responsible_party_id']);
		const serviceDate = hasAny(normalized, MEDICAL_DATE_FIELDS);
		const amount = hasAny(normalized, AMOUNT_FIELDS);
		const claim = hasAny(normalized, ['claim_id', 'number', 'claim_number']);
		const sequence = hasAny(normalized, ['sequence', 'claim_sequence']);
		const diagnosis = hasDiagnosis(normalized);
		requiredCoverage.member = coverage(member.length ? 'met' : 'missing', member);
		requiredCoverage.serviceDate = coverage(serviceDate.length ? 'met' : 'missing', serviceDate);
		requiredCoverage.amount = coverage(amount.length ? 'met' : 'missing', amount);
		requiredCoverage.claimIdentifier = coverage(
			claim.length || sequence.length ? 'met' : 'generated',
			[...claim, ...sequence]
		);
		requiredCoverage.diagnosis = coverage(diagnosis.length ? 'met' : 'optional', diagnosis);
		if (!member.length) blockingWarnings.push('Medical claims require member_id.');
		if (!serviceDate.length) blockingWarnings.push('Medical claims require a service date field.');
		if (!amount.length) blockingWarnings.push('Medical claims require an amount field.');
		if (!diagnosis.length)
			qualityWarnings.push('No diagnosis fields were mapped; clinical analytics will be limited.');
	}

	if (fileType === 'pharmacy') {
		const member = hasAny(normalized, ['member_id', 'responsible_party_id']);
		const fillDate = hasAny(normalized, PHARMACY_DATE_FIELDS);
		const amount = hasAny(normalized, AMOUNT_FIELDS);
		const drug = hasDrug(normalized);
		requiredCoverage.member = coverage(member.length ? 'met' : 'missing', member);
		requiredCoverage.fillDate = coverage(fillDate.length ? 'met' : 'missing', fillDate);
		requiredCoverage.amount = coverage(amount.length ? 'met' : 'missing', amount);
		requiredCoverage.drug = coverage(drug.length ? 'met' : 'optional', drug);
		if (!member.length) blockingWarnings.push('Pharmacy claims require member_id.');
		if (!fillDate.length)
			blockingWarnings.push('Pharmacy claims require a fill, written, or processed date field.');
		if (!amount.length) blockingWarnings.push('Pharmacy claims require an amount field.');
		if (!drug.length)
			qualityWarnings.push('No NDC or drug fields were mapped; Rx analytics will be limited.');
	}

	return {
		status: blockingWarnings.length ? 'blocking' : qualityWarnings.length ? 'warning' : 'ok',
		requiredCoverage,
		blockingWarnings,
		qualityWarnings
	};
}

function canonicalHeadersFor(headers: string[], fields: Record<string, string>) {
	return headers.map((header, index) => canonicalHeader(header, index, fields));
}

function rowObject(headers: string[], row: string[]) {
	const out: Record<string, string> = {};
	headers.forEach((header, index) => {
		if (!header) return;
		out[normalizeField(header)] = row[index] ?? '';
	});
	return out;
}

function requiredValueFields(fileType: SupportedIngestionFileType, headers: string[]) {
	if (fileType === 'eligibility') {
		return [
			hasAny(headers, ['member_id', 'employee_id', 'responsible_party_id'])[0],
			hasAny(headers, [...ELIGIBILITY_START_FIELDS, ...ELIGIBILITY_AS_OF_FIELDS])[0]
		].filter((field): field is string => Boolean(field));
	}
	if (fileType === 'medical') {
		return [
			hasAny(headers, ['member_id', 'responsible_party_id'])[0],
			hasAny(headers, MEDICAL_DATE_FIELDS)[0],
			hasAny(headers, AMOUNT_FIELDS)[0]
		].filter((field): field is string => Boolean(field));
	}
	return [
		hasAny(headers, ['member_id', 'responsible_party_id'])[0],
		hasAny(headers, PHARMACY_DATE_FIELDS)[0],
		hasAny(headers, AMOUNT_FIELDS)[0]
	].filter((field): field is string => Boolean(field));
}

export async function profileUploadedFiles(input: {
	accountId: string;
	form: FormData;
	files: UploadedFile[];
	getActiveMapping: ActiveMappingLookup;
}) {
	const profiles: IngestionFileProfile[] = [];

	for (const [index, file] of input.files.entries()) {
		const rows = await readTabularRows(file);
		const headers =
			rows[0]?.map((value) => String(value ?? '').trim()).slice(0, HEADER_PEEK_MAX) ?? null;
		const inferredFileType = inferFileType(file.name, headers);
		const fileType = fileTypeFromForm(input.form, index, inferredFileType);
		if (!fileType) {
			throw new Error('File type must be eligibility, medical, or pharmacy.');
		}

		const mapping = await resolveFileMapping({
			accountId: input.accountId,
			fileType,
			form: input.form,
			index,
			headers,
			getActiveMapping: input.getActiveMapping
		});
		if (mapping.error) throw new Error(mapping.error);

		const sourceHeaders = rows[0]?.map((value) => String(value ?? '').trim()) ?? [];
		const canonicalHeaders = canonicalHeadersFor(sourceHeaders, mapping.fields);
		const baseValidation = validateCanonicalHeaders(fileType, canonicalHeaders);
		const requiredFields = requiredValueFields(fileType, canonicalHeaders.map(normalizeField));
		let invalidRowCount = 0;
		for (const row of rows.slice(1)) {
			const rowData = rowObject(canonicalHeaders, row);
			if (requiredFields.some((field) => !String(rowData[field] ?? '').trim()))
				invalidRowCount += 1;
		}

		profiles.push({
			fileId: `file_${index + 1}`,
			filename: file.name,
			bytes: file.buf.byteLength,
			mime: file.type,
			rowCount: rows.length,
			dataRowCount: Math.max(0, rows.length - 1),
			headers,
			inferredFileType,
			fileType,
			mapping,
			validation: {
				...baseValidation,
				invalidRowCount,
				rejectedRowCount: 0
			}
		});
	}

	return profiles;
}

export function buildSessionValidation(input: {
	files: IngestionFileProfile[];
	claimMembersEligibleAssumptionAccepted: boolean;
}): IngestionSessionValidation {
	const fileTypes = new Set(input.files.map((file) => file.fileType));
	const eligibilityPresent = fileTypes.has('eligibility');
	const medicalPresent = fileTypes.has('medical');
	const pharmacyPresent = fileTypes.has('pharmacy');
	const warnings: IngestionWarning[] = [];

	for (const file of input.files) {
		for (const message of file.validation.blockingWarnings) {
			warnings.push({
				severity: 'blocking',
				code: 'missing_required_field',
				message,
				fileId: file.fileId,
				filename: file.filename,
				fileType: file.fileType
			});
		}
		for (const message of file.validation.qualityWarnings) {
			warnings.push({
				severity: 'quality',
				code: 'analytics_quality',
				message,
				fileId: file.fileId,
				filename: file.filename,
				fileType: file.fileType
			});
		}
	}

	if (!eligibilityPresent) {
		warnings.push({
			severity: 'blocking',
			code: 'missing_eligibility',
			message: input.claimMembersEligibleAssumptionAccepted
				? 'Eligibility was not uploaded; claim-member eligibility was explicitly assumed for preview analytics only.'
				: 'Eligibility file is required for production-ready analytics.'
		});
	}

	return {
		productionReady:
			eligibilityPresent && !warnings.some((warning) => warning.severity === 'blocking'),
		session: {
			eligibilityPresent,
			medicalPresent,
			pharmacyPresent,
			claimMembersEligibleAssumptionAccepted: input.claimMembersEligibleAssumptionAccepted
		},
		warnings,
		files: input.files.map((file) => ({
			fileId: file.fileId,
			filename: file.filename,
			fileType: file.fileType,
			status: file.validation.status,
			invalidRowCount: file.validation.invalidRowCount,
			rejectedRowCount: file.validation.rejectedRowCount
		}))
	};
}

export function rawUploadRetentionPolicy(): RawUploadRetention {
	const retained =
		process.env.CLAIMS_RETAIN_RAW_UPLOADS === '1' && process.env.NODE_ENV !== 'production';
	return {
		retained,
		reason: retained
			? 'CLAIMS_RETAIN_RAW_UPLOADS=1 is enabled outside production.'
			: 'Raw uploads are deleted after canonicalization by default.',
		cleanupStatus: 'not_started'
	};
}

export async function writeRawTempFiles(input: {
	sessionId: string;
	files: UploadedFile[];
	baseDir?: string;
}) {
	const rawDir =
		input.baseDir ?? join(process.cwd(), 'var', 'uploads', input.sessionId, 'raw-temp');
	await mkdir(rawDir, { recursive: true });
	await Promise.all(
		input.files.map((file, index) =>
			writeFile(
				join(rawDir, `${String(index + 1).padStart(2, '0')}-${basename(file.name)}`),
				file.buf
			)
		)
	);
	return rawDir;
}

export async function cleanupRawTempFiles(rawDir: string, retention: RawUploadRetention) {
	if (retention.retained) {
		return { ...retention, cleanupStatus: 'retained' as const, rawUploadDir: rawDir };
	}
	try {
		await rm(rawDir, { recursive: true, force: true });
		return { ...retention, cleanupStatus: 'deleted' as const };
	} catch {
		return { ...retention, cleanupStatus: 'failed' as const, rawUploadDir: rawDir };
	}
}

export async function writeCanonicalFiles(input: {
	sessionId: string;
	files: UploadedFile[];
	profiles: IngestionFileProfile[];
}) {
	const canonicalDir = join(process.cwd(), 'var', 'analysis', input.sessionId, 'canonical');
	await mkdir(canonicalDir, { recursive: true });
	const out: CanonicalIngestionFile[] = [];

	for (const [index, file] of input.files.entries()) {
		const profile = input.profiles[index];
		const rows = await readTabularRows(file);
		const sourceHeaders = rows[0]?.map((value) => String(value ?? '').trim()) ?? [];
		const canonicalHeaders = canonicalHeadersFor(sourceHeaders, profile.mapping.fields).map(
			normalizeField
		);
		const hasClaimId =
			profile.fileType !== 'medical' ||
			hasAny(canonicalHeaders, ['claim_id', 'number', 'claim_number']).length > 0 ||
			hasAny(canonicalHeaders, ['sequence', 'claim_sequence']).length > 0;
		const finalHeaders = hasClaimId ? canonicalHeaders : [...canonicalHeaders, 'claim_id'];
		const outputRows = [finalHeaders.map(csvEscape).join(',')];

		for (const [rowIndex, row] of rows.slice(1).entries()) {
			const values = canonicalHeaders.map((_header, columnIndex) => row[columnIndex] ?? '');
			if (!hasClaimId) values.push(`generated-${profile.fileId}-${rowIndex + 1}`);
			outputRows.push(values.map(csvEscape).join(','));
		}

		const canonicalCsv = join(
			canonicalDir,
			`${String(index + 1).padStart(2, '0')}-${profile.fileType}-${safeSegment(file.name)}.csv`
		);
		await writeFile(canonicalCsv, `${outputRows.join('\n')}\n`, 'utf8');
		out.push({
			...profile,
			path: canonicalCsv,
			artifacts: { canonicalCsv }
		});
	}

	return out;
}

export function fileStatsFromProfiles(files: IngestionFileProfile[]): FileStat[] {
	return files.map((file) => ({
		filename: file.filename,
		bytes: file.bytes,
		rowCount: file.rowCount,
		mime: file.mime,
		headers: file.headers
	}));
}

export function legacySessionFileType(files: IngestionFileProfile[]) {
	const unique = [...new Set(files.map((file) => file.fileType))];
	return unique.length === 1 ? unique[0] : 'mixed';
}

export function fileTypes(files: IngestionFileProfile[]) {
	return [...new Set(files.map((file) => file.fileType))];
}
