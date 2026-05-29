export type ClaimsFileProfile = {
	filename: string;
	fileType: string;
	profiledRows: number;
	totalRows?: number | null;
	mappedFieldCount: number;
	coverage: {
		hasMemberId: boolean;
		hasServiceDate: boolean;
		hasAmount: boolean;
		hasDiagnosis: boolean;
	};
	metrics: {
		uniqueMembers: number;
		totalAmount: number | null;
		averageAmount: number | null;
		minServiceDate: string | null;
		maxServiceDate: string | null;
	};
	serviceYears: Array<{ year: string; count: number; amount: number | null }>;
	topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
	topPlacesOfService: Array<{ code: string; count: number; amount: number | null }>;
	topRelationships: Array<{ value: string; count: number; amount: number | null }>;
};

export type ClaimsRunProfile = {
	source: 'uploaded_claims';
	profiledAt: string;
	maxRowsPerFile: number;
	files: ClaimsFileProfile[];
	summary: {
		fileCount: number;
		profiledRows: number;
		uniqueMembers: number;
		totalAmount: number | null;
		serviceYears: Array<{ year: string; count: number; amount: number | null }>;
		topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
	};
};

type ClaimsProfileInput = {
	filename: string;
	fileType: string;
	buffer: Buffer;
	headers?: string[] | null;
	rowCount?: number | null;
	mappingFields?: Record<string, string> | null;
	maxRows?: number;
};

const DEFAULT_MAX_ROWS = 25000;

const AMOUNT_FIELDS = [
	'amount_total',
	'amount_allowed',
	'amount_net_payment',
	'paid_amount',
	'amount_billed',
	'amount_patient_responsibility'
];

const SERVICE_DATE_FIELDS = [
	'date_service_start',
	'date_filled',
	'date_admission',
	'date_paid',
	'date_claim_processed'
];

function stripBOM(value: string) {
	return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function detectDelimiter(line: string) {
	const candidates = [',', '\t', '|', ';'];
	return (
		candidates
			.map((delimiter) => ({ delimiter, count: line.split(delimiter).length }))
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

function canonicalHeaders(headers: string[], mappingFields?: Record<string, string> | null) {
	return headers.map((header, index) => {
		const trimmed = header.trim();
		return mappingFields?.[trimmed] ?? mappingFields?.[String(index)] ?? trimmed;
	});
}

function rowObject(canonical: string[], row: string[]) {
	const out: Record<string, string> = {};
	canonical.forEach((field, index) => {
		if (!field) return;
		out[field] = row[index] ?? '';
	});
	return out;
}

function parseNumber(value: string | undefined) {
	if (!value) return null;
	const cleaned = value.replace(/[$,]/g, '').trim();
	if (!cleaned) return null;
	const parsed = Number(cleaned);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | undefined) {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
}

function firstPresent(row: Record<string, string>, fields: string[]) {
	for (const field of fields) {
		const value = row[field];
		if (value !== undefined && value !== null && String(value).trim()) return value;
	}
	return '';
}

function diagnosisFields(row: Record<string, string>) {
	return Object.keys(row)
		.filter((field) => /^icd_?\d+$/i.test(field))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function incrementCounter(
	counter: Map<string, { count: number; amount: number; amountCount: number }>,
	key: string,
	amount: number | null
) {
	const normalized = key.trim();
	if (!normalized) return;
	const existing = counter.get(normalized) ?? { count: 0, amount: 0, amountCount: 0 };
	existing.count += 1;
	if (amount !== null) {
		existing.amount += amount;
		existing.amountCount += 1;
	}
	counter.set(normalized, existing);
}

function counterRows<K extends string>(
	counter: Map<string, { count: number; amount: number; amountCount: number }>,
	keyName: K,
	limit = 8
): Array<Record<K, string> & { count: number; amount: number | null }> {
	return [...counter.entries()]
		.map(
			([key, value]) =>
				({
					[keyName]: key,
					count: value.count,
					amount: value.amountCount > 0 && Number.isFinite(value.amount) ? value.amount : null
				}) as Record<K, string> & { count: number; amount: number | null }
		)
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}

function mergeCounterRows<T extends string>(
	rows: Array<Record<T, string> & { count: number; amount: number | null }>,
	key: T
) {
	const counter = new Map<string, { count: number; amount: number; amountCount: number }>();
	for (const row of rows) {
		const existing = counter.get(row[key]) ?? { count: 0, amount: 0, amountCount: 0 };
		existing.count += row.count;
		if (row.amount !== null) {
			existing.amount += row.amount;
			existing.amountCount += 1;
		}
		counter.set(row[key], existing);
	}
	return counterRows(counter, key, 8) as Array<
		Record<T, string> & { count: number; amount: number | null }
	>;
}

export function profileClaimsBuffer(input: ClaimsProfileInput): ClaimsFileProfile | null {
	const text = stripBOM(input.buffer.toString('utf8'));
	const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length < 2) return null;

	const delimiter = detectDelimiter(lines[0]);
	const sourceHeaders = input.headers?.length
		? input.headers
		: splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());
	const canonical = canonicalHeaders(sourceHeaders, input.mappingFields);
	const mappedFieldCount = new Set(canonical.filter(Boolean)).size;
	const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;

	const memberIds = new Set<string>();
	const serviceYears = new Map<string, { count: number; amount: number; amountCount: number }>();
	const diagnoses = new Map<string, { count: number; amount: number; amountCount: number }>();
	const placesOfService = new Map<string, { count: number; amount: number; amountCount: number }>();
	const relationships = new Map<string, { count: number; amount: number; amountCount: number }>();

	let profiledRows = 0;
	let totalAmount = 0;
	let amountCount = 0;
	let minServiceDate: string | null = null;
	let maxServiceDate: string | null = null;
	let hasServiceDate = false;
	let hasDiagnosis = false;

	for (const line of lines.slice(1, maxRows + 1)) {
		const row = rowObject(canonical, splitDelimitedLine(line, delimiter));
		const memberId = firstPresent(row, ['member_id', 'responsible_party_id']);
		const amount = parseNumber(firstPresent(row, AMOUNT_FIELDS));
		const serviceDateValue = parseDate(firstPresent(row, SERVICE_DATE_FIELDS));

		profiledRows += 1;
		if (memberId) memberIds.add(memberId);
		if (amount !== null) {
			totalAmount += amount;
			amountCount += 1;
		}
		if (serviceDateValue) {
			hasServiceDate = true;
			if (minServiceDate === null || serviceDateValue.localeCompare(minServiceDate) < 0) {
				minServiceDate = serviceDateValue;
			}
			if (maxServiceDate === null || serviceDateValue.localeCompare(maxServiceDate) > 0) {
				maxServiceDate = serviceDateValue;
			}
			incrementCounter(serviceYears, serviceDateValue.slice(0, 4), amount);
		}

		const pos = firstPresent(row, ['pos_code', 'place_of_service']);
		incrementCounter(placesOfService, pos, amount);

		const relationship = firstPresent(row, ['member_relationship', 'relationship']);
		incrementCounter(relationships, relationship, amount);

		for (const field of diagnosisFields(row)) {
			const diagnosis = row[field]?.trim();
			if (!diagnosis) continue;
			hasDiagnosis = true;
			incrementCounter(diagnoses, diagnosis, amount);
		}
	}

	const totalAmountValue = amountCount ? totalAmount : null;

	return {
		filename: input.filename,
		fileType: input.fileType,
		profiledRows,
		totalRows: input.rowCount,
		mappedFieldCount,
		coverage: {
			hasMemberId: canonical.includes('member_id'),
			hasServiceDate,
			hasAmount: amountCount > 0,
			hasDiagnosis
		},
		metrics: {
			uniqueMembers: memberIds.size,
			totalAmount: totalAmountValue,
			averageAmount: amountCount ? totalAmount / amountCount : null,
			minServiceDate,
			maxServiceDate
		},
		serviceYears: counterRows(serviceYears, 'year', 8),
		topDiagnoses: counterRows(diagnoses, 'code', 8),
		topPlacesOfService: counterRows(placesOfService, 'code', 8),
		topRelationships: counterRows(relationships, 'value', 8)
	};
}

export function buildClaimsRunProfile(files: ClaimsFileProfile[]): ClaimsRunProfile | null {
	if (!files.length) return null;

	const memberCount = files.reduce((sum, file) => sum + file.metrics.uniqueMembers, 0);
	const totalAmount = files.reduce((sum, file) => sum + (file.metrics.totalAmount ?? 0), 0);
	const hasAmount = files.some((file) => file.metrics.totalAmount !== null);

	return {
		source: 'uploaded_claims',
		profiledAt: new Date().toISOString(),
		maxRowsPerFile: DEFAULT_MAX_ROWS,
		files,
		summary: {
			fileCount: files.length,
			profiledRows: files.reduce((sum, file) => sum + file.profiledRows, 0),
			uniqueMembers: memberCount,
			totalAmount: hasAmount ? totalAmount : null,
			serviceYears: mergeCounterRows(
				files.flatMap((file) => file.serviceYears),
				'year'
			),
			topDiagnoses: mergeCounterRows(
				files.flatMap((file) => file.topDiagnoses),
				'code'
			)
		}
	};
}
