import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('python claims analysis runner', () => {
	it('reports a runnable MVP mode from --probe', async () => {
		const { stdout } = await execFileAsync('python', ['python/claims_analysis/run_analysis.py', '--probe']);
		const probe = JSON.parse(stdout);

		expect(probe.ok).toBe(true);
		expect(['stdlib_mvp', 'legacy_ready']).toContain(probe.mode);
		expect(probe.legacyDependencies).toBeTruthy();
	});
});
