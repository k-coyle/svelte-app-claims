import type { RequestHandler } from './$types';
import { analysisPathsForSession } from '$lib/server/analysis';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

type ArtifactManifest = {
	artifacts?: {
		manifest?: string;
		reportXlsx?: string;
		reportWorkbook?: string;
		etl?: Record<string, string>;
	};
	etlArtifacts?: Record<string, string>;
	etlValidationPath?: string;
};

const contentTypes: Record<string, string> = {
	json: 'application/json; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function pathInside(base: string, candidate: string) {
	const resolvedBase = resolve(base).toLowerCase();
	const resolvedCandidate = resolve(candidate).toLowerCase();
	return (
		resolvedCandidate === resolvedBase ||
		resolvedCandidate.startsWith(`${resolvedBase}\\`) ||
		resolvedCandidate.startsWith(`${resolvedBase}/`)
	);
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

function artifactPathFor(
	key: string,
	manifest: ArtifactManifest,
	paths: ReturnType<typeof analysisPathsForSession>
) {
	if (key === 'manifest') return { path: paths.manifest, format: 'json' as const };
	if (key === 'etlValidation') {
		const path =
			manifest.etlValidationPath ??
			manifest.etlArtifacts?.validation ??
			manifest.artifacts?.etl?.validation;
		return path ? { path, format: 'json' as const } : null;
	}
	if (key === 'reportWorkbook') {
		const path = manifest.artifacts?.reportXlsx ?? manifest.artifacts?.reportWorkbook;
		return path
			? {
					path,
					format: path.toLowerCase().endsWith('.xlsx') ? ('xlsx' as const) : ('json' as const)
				}
			: null;
	}

	const etlPath = manifest.etlArtifacts?.[key] ?? manifest.artifacts?.etl?.[key];
	if (!etlPath) return null;
	return {
		path: etlPath,
		format: etlPath.toLowerCase().endsWith('.json') ? ('json' as const) : ('csv' as const)
	};
}

export const GET: RequestHandler = async ({ params }) => {
	const artifactKey = decodeURIComponent(params.artifactKey);
	if (!/^[A-Za-z0-9_-]+$/.test(artifactKey)) {
		return new Response('Artifact was not found for this analysis session.', { status: 404 });
	}

	const paths = analysisPathsForSession(params.sessionId);
	const manifest = await readJson<ArtifactManifest>(paths.manifest);
	if (!manifest) {
		return new Response('Artifact was not found for this analysis session.', { status: 404 });
	}

	const artifact = artifactPathFor(artifactKey, manifest, paths);
	if (!artifact || !pathInside(paths.dir, artifact.path)) {
		return new Response('Artifact was not found for this analysis session.', { status: 404 });
	}

	try {
		const details = await stat(artifact.path);
		if (!details.isFile()) {
			return new Response('Artifact was not found for this analysis session.', { status: 404 });
		}
		const buffer = await readFile(artifact.path);
		const filename = basename(artifact.path);
		return new Response(new Uint8Array(buffer), {
			headers: {
				'content-type': contentTypes[artifact.format],
				'content-disposition': `attachment; filename="${filename}"`
			}
		});
	} catch {
		return new Response('Artifact was not found for this analysis session.', { status: 404 });
	}
};
