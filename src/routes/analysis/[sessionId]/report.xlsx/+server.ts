import type { RequestHandler } from './$types';
import { analysisPathsForSession } from '$lib/server/analysis';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch {
		return null;
	}
}

function pathInside(base: string, candidate: string) {
	const resolvedBase = resolve(base);
	const resolvedCandidate = resolve(candidate);
	return (
		resolvedCandidate === resolvedBase ||
		resolvedCandidate.toLowerCase().startsWith(`${resolvedBase.toLowerCase()}\\`) ||
		resolvedCandidate.toLowerCase().startsWith(`${resolvedBase.toLowerCase()}/`)
	);
}

export const GET: RequestHandler = async ({ params }) => {
	const paths = analysisPathsForSession(params.sessionId);
	const manifest = await readJson<{ artifacts?: { reportXlsx?: string; reportSections?: string } }>(
		paths.manifest
	);
	const reportSections = await readJson<{ xlsxReportPath?: string }>(
		manifest?.artifacts?.reportSections ?? join(paths.dir, 'report-sections.json')
	);
	const workbookPath = manifest?.artifacts?.reportXlsx ?? reportSections?.xlsxReportPath;

	if (!workbookPath || !pathInside(paths.dir, workbookPath)) {
		return new Response('Report workbook was not found for this analysis session.', { status: 404 });
	}

	try {
		const details = await stat(workbookPath);
		if (!details.isFile()) {
			return new Response('Report workbook was not found for this analysis session.', { status: 404 });
		}
		const buffer = await readFile(workbookPath);
		return new Response(new Uint8Array(buffer), {
			headers: {
				'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'content-disposition': `inline; filename="${params.sessionId}-analysis-report.xlsx"`
			}
		});
	} catch {
		return new Response('Report workbook was not found for this analysis session.', { status: 404 });
	}
};
