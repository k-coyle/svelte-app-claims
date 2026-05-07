import { spawn } from './cp';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

export type WorkerJob = {
  sessionId: string;
  accountId: string;
  fileType: 'eligibility' | 'medical' | 'pharmacy' | 'vision' | 'dental';
  files: Array<{ path: string; filename: string; bytes: number }>;
  eligibilityStartDate?: string | null;
  mapping?: { fields: Record<string, string> } | null;
};

/** Build args for your Node ETL wrapper (already added earlier). */
export function buildEtlArgs(job: WorkerJob, etlNodeEntry: string): string[] {
  const args: string[] = [
    etlNodeEntry,
    '--mode', job.fileType,
    '--session', job.sessionId,
    '--account', job.accountId
  ];
  if (job.eligibilityStartDate) args.push('--start', job.eligibilityStartDate);
  if (job.mapping?.fields) {
    const b64 = Buffer.from(JSON.stringify(job.mapping.fields), 'utf8').toString('base64');
    args.push('--mapping-b64', b64);
  }
  for (const f of job.files) args.push('--file', f.path);
  return args;
}

/**
 * Spawn the ETL wrapper (Node) that calls your Python (`stream_cleaner.py`).
 * Returns { code, stdout, stderr }. No DB writes yet.
 */
type SpawnLike = (
	command: string,
	args?: readonly string[],
	options?: SpawnOptions
) => ChildProcess;

export function makeRunEtl(spawnImpl: SpawnLike = spawn as SpawnLike) {
	return async function runEtlWithSpawn(
		job: WorkerJob,
		opts?: { entry?: string; timeoutMs?: number }
	): Promise<{ code: number; stdout: string; stderr: string }> {
		const entry = opts?.entry ?? process.env.ETL_NODE_ENTRY ?? '../claims-analysis/test_python_etl.js';
		const args = buildEtlArgs(job, entry);

		const child = spawnImpl(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';
		if (child.stdout && 'setEncoding' in child.stdout) child.stdout.setEncoding('utf8');
		if (child.stderr && 'setEncoding' in child.stderr) child.stderr.setEncoding('utf8');

		child.stdout?.on('data', (c) => (stdout += String(c)));
		child.stderr?.on('data', (c) => (stderr += String(c)));

		const code: number = await new Promise((resolve, reject) => {
			let timer: NodeJS.Timeout | null = null;
			if (opts?.timeoutMs) timer = setTimeout(() => { child.kill(); resolve(-1); }, opts.timeoutMs);
			child.on('error', reject);
			child.on('close', (c) => { if (timer) clearTimeout(timer); resolve(c ?? -1); });
		});

		return { code, stdout, stderr };
	};
}

export async function runEtl(
  job: WorkerJob,
  opts?: { entry?: string; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
	return makeRunEtl()(job, opts);
}
