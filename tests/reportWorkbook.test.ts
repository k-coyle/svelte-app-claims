import { describe, expect, it } from 'vitest';
import { parseReportWorkbookBuffer } from '../src/lib/server/reportWorkbook';

function makeYearSheet(XLSX: typeof import('xlsx'), year: number, medicalTotal: number) {
	return XLSX.utils.aoa_to_sheet([
		['get_summary'],
		['', 0],
		['apply_exclusions', false],
		['client_name', 'demo'],
		['analysis_year', year],
		['medical_total', medicalTotal],
		['pharmacy_total', 0],
		['fte', 100],
		['medical_total_pppy', medicalTotal / 100],
		['pharmacy_total_pppy', 0],
		['get_summary_w_exlusions'],
		['', 0],
		['apply_exclusions', true],
		['client_name', 'demo'],
		['analysis_year', year],
		['medical_total', medicalTotal - 1000],
		['pharmacy_total', 0],
		['fte', 100],
		['medical_total_pppy', (medicalTotal - 1000) / 100],
		['pharmacy_total_pppy', 0],
		['get_cc_costs_exclusions'],
		['condition_group', 'claimant_count', 'pct', 'cost_medical', 'cost_rx', 'total', 'pppy'],
		['Diabetes', 10, 0.1, 5000, 0, 5000, 500],
		['Asthma', 5, 0.05, 2500, 0, 2500, 500],
		['get_cc__prevalence'],
		['condition_group', 'claimant_count', 'pct'],
		['Diabetes', 10, 0.1],
		['get_disease_risk_acuity_profile_exclusions_applied'],
		['disease_risk_acuity_profile', 'claimant_count'],
		['High', 3]
	]);
}

describe('report workbook parser', () => {
	it('parses yearly write_excel_report sheets into summaries and table sections', async () => {
		const XLSX = await import('xlsx');
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, makeYearSheet(XLSX, 2021, 10000), 'year_1');
		XLSX.utils.book_append_sheet(wb, makeYearSheet(XLSX, 2022, 20000), 'year_2');
		XLSX.utils.book_append_sheet(wb, makeYearSheet(XLSX, 2023, 30000), 'year_3');
		const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

		const parsed = parseReportWorkbookBuffer(buffer, 'demo.xlsx');

		expect(parsed.summary.yearCount).toBe(3);
		expect(parsed.summary.latestYear?.analysisYear).toBe(2023);
		expect(parsed.summary.latestYear?.exclusionSavings).toBe(1000);
		expect(parsed.summary.conditionCosts[0].condition_group).toBe('Diabetes');
		expect(parsed.years[0].sections.get_summary.properties.medical_total).toBe(10000);
	});
});
