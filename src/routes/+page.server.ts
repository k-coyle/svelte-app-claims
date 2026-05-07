import type { PageServerLoad } from './$types';
import { getDemoSummary, listJobs, listMappings, listUploadSessions } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const [summary, recentUploads, recentJobs, mappings] = await Promise.all([
		getDemoSummary(),
		listUploadSessions({ page: 1, pageSize: 5, sort: 'newest' }),
		listJobs(5),
		listMappings({ limit: 5 })
	]);

	return {
		summary,
		recentUploads,
		recentJobs,
		mappings
	};
};
