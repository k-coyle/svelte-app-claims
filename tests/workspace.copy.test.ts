import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('USPM Claims Engine workspace copy', () => {
	it('uses cleaned product copy without demo-mode badges or active mapping checkbox text', () => {
		const layout = readFileSync(join(process.cwd(), 'src', 'routes', '+layout.svelte'), 'utf8');
		const page = readFileSync(join(process.cwd(), 'src', 'routes', '+page.svelte'), 'utf8');
		const visibleSource = `${layout}\n${page}`;

		expect(visibleSource).toContain('USPM Claims Engine');
		expect(visibleSource).not.toContain('Claims QA console');
		expect(visibleSource).not.toContain('Upload, validate, run, review');
		expect(visibleSource).not.toContain('Local artifact mode');
		expect(visibleSource).not.toContain('MVP demo workspace');
		expect(visibleSource).not.toContain('Flat-file storage');
		expect(visibleSource).not.toContain('QA review');
		expect(visibleSource).not.toContain(
			'Ingest claims files, validate readiness, run the Python artifact flow, and review ETL QA metrics in one workspace.'
		);
		expect(visibleSource).not.toMatch(/>\s*Active\s*</);
	});
});
