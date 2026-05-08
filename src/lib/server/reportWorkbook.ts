import * as XLSX from 'xlsx';

export type ReportCellValue = string | number | boolean | null;

export type ReportSection = {
	name: string;
	columns: string[];
	properties: Record<string, ReportCellValue>;
	rows: Record<string, ReportCellValue>[];
};

export type YearReport = {
	sheetName: string;
	analysisYear: number | null;
	clientName: string | null;
	sections: Record<string, ReportSection>;
};

export type YearSummary = {
	sheetName: string;
	analysisYear: number | null;
	medicalTotal: number | null;
	medicalTotalAfterExclusions: number | null;
	pharmacyTotal: number | null;
	fte: number | null;
	medicalPppy: number | null;
	medicalPppyAfterExclusions: number | null;
	exclusionSavings: number | null;
};

export type ReportWorkbookSummary = {
	sourceFilename: string;
	sourceFormat: 'write_excel_report_workbook' | 'python_claims_analysis';
	yearCount: number;
	sectionCount: number;
	years: YearSummary[];
	latestYear: YearSummary | null;
	conditionCosts: Record<string, ReportCellValue>[];
	conditionPrevalence: Record<string, ReportCellValue>[];
	riskProfile: Record<string, ReportCellValue>[];
	availableSections: string[];
};

export type ParsedReportWorkbook = {
	sourceFilename: string;
	sourceFormat: 'write_excel_report_workbook';
	parsedAt: string;
	years: YearReport[];
	summary: ReportWorkbookSummary;
};

const YEAR_SHEETS = ['year_1', 'year_2', 'year_3'];

function isBlank(value: unknown) {
	return value === null || value === undefined || String(value).trim() === '';
}

function text(value: unknown) {
	return String(value ?? '').trim();
}

function numberValue(value: ReportCellValue | undefined) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function normalizeCell(value: unknown): ReportCellValue {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	return String(value).trim();
}

function trimTrailingEmptyCells(row: unknown[]) {
	const next = row.slice();
	while (next.length && isBlank(next[next.length - 1])) next.pop();
	return next;
}

function nonEmptyCells(row: unknown[]) {
	return trimTrailingEmptyCells(row).filter((value) => !isBlank(value));
}

function isSectionHeader(row: unknown[]) {
	return /^get_/.test(text(row[0]));
}

function meaningfulRows(rows: unknown[][]) {
	return rows.filter((row) => nonEmptyCells(row).length > 0);
}

function uniqueColumnName(name: string, index: number, seen: Set<string>) {
	const fallback = `column_${index + 1}`;
	const base = name || fallback;
	if (!seen.has(base)) {
		seen.add(base);
		return base;
	}

	let suffix = 2;
	while (seen.has(`${base}_${suffix}`)) suffix += 1;
	const next = `${base}_${suffix}`;
	seen.add(next);
	return next;
}

function parseSection(name: string, bodyRows: unknown[][]): ReportSection {
	const rows = meaningfulRows(bodyRows);
	const first = rows[0] ?? [];
	const firstCellCount = nonEmptyCells(first).length;
	const firstCellIsBlank = isBlank(first[0]);
	const isTable = firstCellIsBlank ? firstCellCount >= 2 : firstCellCount >= 3;

	if (!isTable) {
		const withoutIndexRows = rows.filter((row) => !(isBlank(row[0]) && nonEmptyCells(row).length <= 1));
		const properties: Record<string, ReportCellValue> = {};
		for (const row of withoutIndexRows) {
			const key = text(row[0]);
			if (!key) continue;
			properties[key] = normalizeCell(row[1]);
		}
		return { name, columns: [], properties, rows: [] };
	}

	const seen = new Set<string>();
	const columns = trimTrailingEmptyCells(first).map((value, index) =>
		uniqueColumnName(index === 0 && isBlank(value) ? 'condition_group' : text(value), index, seen)
	);
	const tableRows = rows.slice(1).map((row) => {
		const out: Record<string, ReportCellValue> = {};
		columns.forEach((column, index) => {
			out[column] = normalizeCell(row[index]);
		});
		return out;
	});

	return {
		name,
		columns,
		properties: {},
		rows: tableRows.filter((row) => Object.values(row).some((value) => !isBlank(value)))
	};
}

function parseYearSheet(workbook: XLSX.WorkBook, sheetName: string): YearReport | null {
	const sheet = workbook.Sheets[sheetName];
	if (!sheet) return null;

	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		raw: true,
		defval: null,
		blankrows: false
	});

	const sections: Record<string, ReportSection> = {};
	let currentName: string | null = null;
	let currentRows: unknown[][] = [];

	function flush() {
		if (!currentName) return;
		sections[currentName] = parseSection(currentName, currentRows);
		currentRows = [];
	}

	for (const row of rows) {
		if (isSectionHeader(row)) {
			flush();
			currentName = text(row[0]);
			currentRows = [];
		} else if (currentName) {
			currentRows.push(row);
		}
	}
	flush();

	const summary = sections.get_summary?.properties ?? {};

	return {
		sheetName,
		analysisYear: numberValue(summary.analysis_year),
		clientName: typeof summary.client_name === 'string' ? summary.client_name : null,
		sections
	};
}

function yearSummary(report: YearReport): YearSummary {
	const full = report.sections.get_summary?.properties ?? {};
	const exclusions = report.sections.get_summary_w_exlusions?.properties ?? {};
	const medicalTotal = numberValue(full.medical_total);
	const medicalTotalAfterExclusions = numberValue(exclusions.medical_total);

	return {
		sheetName: report.sheetName,
		analysisYear: report.analysisYear,
		medicalTotal,
		medicalTotalAfterExclusions,
		pharmacyTotal: numberValue(full.pharmacy_total),
		fte: numberValue(exclusions.fte ?? full.fte),
		medicalPppy: numberValue(full.medical_total_pppy),
		medicalPppyAfterExclusions: numberValue(exclusions.medical_total_pppy),
		exclusionSavings:
			medicalTotal !== null && medicalTotalAfterExclusions !== null
				? medicalTotal - medicalTotalAfterExclusions
				: null
	};
}

function latestReport(years: YearReport[]) {
	return years
		.slice()
		.sort((a, b) => Number(b.analysisYear ?? 0) - Number(a.analysisYear ?? 0))[0];
}

function sortedByNumericColumn(rows: Record<string, ReportCellValue>[], column: string, limit: number) {
	return rows
		.slice()
		.sort((a, b) => Number(numberValue(b[column]) ?? 0) - Number(numberValue(a[column]) ?? 0))
		.slice(0, limit);
}

function sortedByFirstNumericColumn(
	rows: Record<string, ReportCellValue>[],
	columns: string[],
	limit: number
) {
	const column = columns.find((name) => rows.some((row) => numberValue(row[name]) !== null));
	return column ? sortedByNumericColumn(rows, column, limit) : rows.slice(0, limit);
}

function summarizeWorkbook(sourceFilename: string, years: YearReport[]): ReportWorkbookSummary {
	const latest = latestReport(years);
	const availableSections = [
		...new Set(years.flatMap((year) => Object.keys(year.sections)))
	].sort((a, b) => a.localeCompare(b));
	const sectionCount = years.reduce((sum, year) => sum + Object.keys(year.sections).length, 0);
	const yearSummaries = years.map(yearSummary);

	return {
		sourceFilename,
		sourceFormat: 'write_excel_report_workbook' as const,
		yearCount: years.length,
		sectionCount,
		years: yearSummaries,
		latestYear: latest ? yearSummary(latest) : null,
		conditionCosts: latest
			? sortedByNumericColumn(latest.sections.get_cc_costs_exclusions?.rows ?? [], 'total', 8)
			: [],
		conditionPrevalence: latest
			? sortedByFirstNumericColumn(
					latest.sections.get_cc__prevalence?.rows ?? [],
					['claimant_count', 'member_count', 'count'],
					8
				)
			: [],
		riskProfile: latest
			? (latest.sections.get_disease_risk_acuity_profile_exclusions_applied?.rows ?? []).slice(0, 8)
			: [],
		availableSections
	};
}

export function parseReportWorkbookBuffer(
	buffer: Buffer,
	sourceFilename = 'report_workbook.xlsx'
): ParsedReportWorkbook {
	const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
	const years = YEAR_SHEETS.map((sheetName) => parseYearSheet(workbook, sheetName)).filter(
		(report): report is YearReport => Boolean(report)
	);

	if (!years.length) {
		throw new Error('Workbook does not contain year_1, year_2, or year_3 report sheets.');
	}

	return {
		sourceFilename,
		sourceFormat: 'write_excel_report_workbook',
		parsedAt: new Date().toISOString(),
		years,
		summary: summarizeWorkbook(sourceFilename, years)
	};
}
