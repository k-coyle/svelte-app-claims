import { describe, expect, it, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GET } from '../src/routes/analysis/[sessionId]/report.xlsx/+server';

const sessionId = 'unit_report_download';
const dir = join(process.cwd(), 'var', 'analysis', sessionId);

describe('analysis report workbook route', () => {
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('serves the generated trace workbook from the session directory', async () => {
		await mkdir(dir, { recursive: true });
		const workbookPath = join(dir, 'analysis-report.xlsx');
		await writeFile(workbookPath, Buffer.from('xlsx-bytes'));
		await writeFile(
			join(dir, 'manifest.json'),
			`${JSON.stringify({ artifacts: { reportXlsx: workbookPath } }, null, 2)}\n`,
			'utf8'
		);

		const response = await GET({ params: { sessionId } } as never);
		const body = Buffer.from(await response.arrayBuffer()).toString('utf8');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(body).toBe('xlsx-bytes');
	});
});
