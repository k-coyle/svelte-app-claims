import { describe, it, expect } from 'vitest';

async function makeXlsxBuffer(rows: string[][]): Promise<Buffer> {
	const XLSX = await import('xlsx');
	const ws = XLSX.utils.aoa_to_sheet(rows);
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
	const bin = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
	return bin;
}

async function countRowsXlsx(buf: Buffer): Promise<number> {
	const XLSX = await import('xlsx');
	const wb = XLSX.read(buf, { type: 'buffer' });
	const sheet = wb.Sheets[wb.SheetNames[0]];
	const arr = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[];
	return arr.length;
}

describe('xlsx row count', () => {
	it('counts rows including header', async () => {
		const buf = await makeXlsxBuffer([
			['a', 'b'],
			['1', '2'],
			['3', '4']
		]);
		const n = await countRowsXlsx(buf);
		expect(n).toBe(3);
	});
});
