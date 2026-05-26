import type { PageServerLoad } from './$types';
import { getWorkspaceSummary, listMappings, listUploadSessions } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const [summary, recentUploads, mappings] = await Promise.all([
		getWorkspaceSummary(),
		listUploadSessions({ page: 1, pageSize: 5, sort: 'newest' }),
		listMappings({ limit: 5 })
	]);

	return {
		summary,
		recentUploads,
		mappings
	};
};
