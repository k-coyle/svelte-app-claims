import type { Actions, PageServerLoad } from './$types';
import { listAnalysisManifests, writeReportWorkbookArtifacts } from '$lib/server/analysis';

export const load: PageServerLoad = async () => {
	const runs = await listAnalysisManifests(25);
	return {
		runs,
		latest: runs[0] ?? null
	};
};

export const actions: Actions = {
	importWorkbook: async ({ request }) => {
		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();
		const workbook = form.get('workbook');

		if (!accountId) return { error: 'accountId is required' };
		if (!(workbook instanceof File) || workbook.size === 0) {
			return { error: 'report workbook is required' };
		}

		const lowerName = workbook.name.toLowerCase();
		if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
			return { error: 'report workbook must be an Excel file' };
		}

		try {
			const buffer = Buffer.from(await workbook.arrayBuffer());
			const manifest = await writeReportWorkbookArtifacts({
				accountId,
				filename: workbook.name,
				bytes: workbook.size,
				buffer
			});

			return {
				ok: true,
				sessionId: manifest.sessionId,
				yearCount: manifest.report?.yearCount ?? 0
			};
		} catch (e) {
			return { error: e instanceof Error ? e.message : 'unexpected error' };
		}
	}
};
