import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GET } from '../src/routes/artifacts/[sessionId]/[artifactKey]/+server';

const sessionId = 'unit_artifact_download';
const dir = join(process.cwd(), 'var', 'analysis', sessionId);

describe('curated artifact download route', () => {
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('serves whitelisted ETL artifacts from inside the session directory', async () => {
		await mkdir(join(dir, 'etl'), { recursive: true });
		const validationPath = join(dir, 'etl', 'etl_validation.json');
		await writeFile(validationPath, '{"ok":true}\n', 'utf8');
		await writeFile(
			join(dir, 'manifest.json'),
			`${JSON.stringify({ etlValidationPath: validationPath, etlArtifacts: { validation: validationPath } }, null, 2)}\n`,
			'utf8'
		);

		const response = await GET({ params: { sessionId, artifactKey: 'etlValidation' } } as never);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(body).toContain('"ok":true');
	});

	it('rejects unknown artifact keys instead of resolving arbitrary paths', async () => {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'manifest.json'), '{}\n', 'utf8');

		const response = await GET({
			params: { sessionId, artifactKey: '..%2F..%2Fpackage.json' }
		} as never);

		expect(response.status).toBe(404);
	});
});
