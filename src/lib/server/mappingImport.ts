import * as XLSX from 'xlsx';

export type HistoricalMappingColumn = {
	columnNumber: number | null;
	sourceColumn: string;
	targetColumn: string;
	dtype: string | null;
	parseDate: boolean;
};

export type HistoricalMappingImport = {
	sourceFormat: 'historical_column_mapping_csv';
	fields: Record<string, string>;
	positionFields: Record<string, string>;
	columns: HistoricalMappingColumn[];
	fieldCount: number;
	dateFields: string[];
};

const REQUIRED_COLUMNS = ['column', 'column_uspm'];

function normalizeHeader(value: unknown) {
	return String(value ?? '')
		.trim()
		.replace(/^\uFEFF/, '')
		.toLowerCase();
}

function normalizeCell(value: unknown) {
	return String(value ?? '').trim();
}

function booleanCell(value: unknown) {
	const normalized = normalizeCell(value).toLowerCase();
	return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function numberCell(value: unknown) {
	const normalized = normalizeCell(value);
	if (!normalized) return null;
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

function firstSheetRows(csv: string) {
	const workbook = XLSX.read(csv, { type: 'string', raw: false });
	const firstSheet = workbook.SheetNames[0];
	if (!firstSheet) return [];
	return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
		defval: '',
		raw: false
	});
}

function normalizeRow(row: Record<string, unknown>) {
	return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyFields(fields: Record<string, unknown>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(fields)
			.filter(([key, value]) => normalizeCell(key) && value !== undefined && value !== null)
			.map(([key, value]) => [normalizeCell(key), normalizeCell(value)])
			.filter(([key, value]) => Boolean(key && value))
	);
}

function headersArePositionBased(headers?: string[] | null) {
	if (!headers?.length) return false;
	const populated = headers.map((header) => header.trim()).filter(Boolean);
	if (!populated.length) return false;
	return populated.every((header) => /^\d+$/.test(header));
}

export function parseHistoricalMappingCsv(input: Buffer | string): HistoricalMappingImport {
	const csv = Buffer.isBuffer(input) ? input.toString('utf8') : input;
	const rows = firstSheetRows(csv).map(normalizeRow);

	if (!rows.length) {
		throw new Error('Mapping CSV has no rows.');
	}

	const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
	if (missingColumns.length) {
		throw new Error(`Mapping CSV is missing required columns: ${missingColumns.join(', ')}`);
	}

	const columns: HistoricalMappingColumn[] = [];
	const fields: Record<string, string> = {};
	const positionFields: Record<string, string> = {};

	rows.forEach((row, index) => {
		const sourceColumn = normalizeCell(row.column);
		const targetColumn = normalizeCell(row.column_uspm);
		const dtype = normalizeCell(row.dtype) || null;
		const columnNumber = numberCell(row.column_number);
		const parseDate = booleanCell(row.parse_date);

		if (!sourceColumn && !targetColumn) return;
		if (!sourceColumn || !targetColumn) {
			throw new Error(`Mapping CSV row ${index + 2} must include both column and column_uspm.`);
		}

		fields[sourceColumn] = targetColumn;
		if (columnNumber !== null) {
			positionFields[String(columnNumber)] = targetColumn;
		}

		columns.push({
			columnNumber,
			sourceColumn,
			targetColumn,
			dtype,
			parseDate
		});
	});

	if (!columns.length) {
		throw new Error('Mapping CSV did not contain any usable mapping rows.');
	}

	return {
		sourceFormat: 'historical_column_mapping_csv',
		fields,
		positionFields,
		columns,
		fieldCount: Object.keys(fields).length,
		dateFields: columns.filter((column) => column.parseDate).map((column) => column.targetColumn)
	};
}

export function mappingPayloadToFields(
	payload: Record<string, unknown> | undefined,
	headers?: string[] | null
): Record<string, string> | null {
	if (!payload) return null;

	if (headersArePositionBased(headers) && isRecord(payload.positionFields)) {
		const positionFields = stringifyFields(payload.positionFields);
		if (Object.keys(positionFields).length) return positionFields;
	}

	if (isRecord(payload.fields)) {
		const fields = stringifyFields(payload.fields);
		if (Object.keys(fields).length) return fields;
	}

	const fields = stringifyFields(payload);
	return Object.keys(fields).length ? fields : null;
}
