import type { ReportCellValue } from './types';

const money = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 0
});

const number = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 1
});

export function statusLabel(value: string) {
	return value.replaceAll('_', ' ');
}

export function fmtDate(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function fmtMoney(value: number | null | undefined) {
	return typeof value === 'number' && Number.isFinite(value) ? money.format(value) : '-';
}

export function fmtNumber(value: ReportCellValue | undefined) {
	if (typeof value === 'number' && Number.isFinite(value)) return number.format(value);
	if (typeof value === 'string' && value.trim()) return value;
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	return '-';
}

export function conditionName(row: Record<string, ReportCellValue>) {
	return String(row.condition_group ?? row.condition ?? row.label ?? '-');
}

export function coverageLabel(value: boolean) {
	return value ? 'Present' : 'Missing';
}

export function pctChange(current: number | null | undefined, previous: number | null | undefined) {
	if (typeof current !== 'number' || typeof previous !== 'number' || previous === 0) return '-';
	return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export function asNumber(value: ReportCellValue | undefined) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
