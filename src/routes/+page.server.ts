import type { Actions, PageServerLoad } from './$types';
import { listAnalysisManifests, rerunAnalysisForSession } from '$lib/server/analysis';
import {
	clearDemoSessions,
	deleteUploadSession,
	getWorkspaceSummary,
	listMappings,
	listUploadSessions,
	upsertMapping
} from '$lib/server/db';
import { parseMappingCsv } from '$lib/server/mappingImport';
import { buildWorkspaceQa } from '$lib/server/workspace/qa';
import { getAllowedAccounts, getUser, handleUploadAction } from '$lib/server/workspace/upload';

function parsePositiveVersion(raw: string) {
	const version = Number(raw.trim());
	return Number.isInteger(version) && version > 0 ? version : null;
}

function parseMappingJson(raw: string) {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async () => {
	const user = getUser();
	const allowedAccounts = getAllowedAccounts(user);
	const [summary, recentUploads, allUploadSessions, mappings, allRuns] = await Promise.all([
		getWorkspaceSummary(),
		listUploadSessions({ page: 1, pageSize: 8, sort: 'newest' }),
		listUploadSessions({ page: 1, pageSize: 100, sort: 'newest' }),
		listMappings({ limit: 25 }),
		listAnalysisManifests(25)
	]);
	const sessionIds = new Set(allUploadSessions.map((session) => session._id).filter(Boolean));
	const runs = allRuns.filter((run) => sessionIds.has(run.sessionId));
	const latest = runs[0] ?? null;

	return {
		allowedAccounts,
		defaultAccountId: user.role === 'client' ? user.accountId : allowedAccounts[0]?.id,
		userId: user.id,
		summary,
		recentUploads,
		mappings,
		runs,
		latest,
		qa: await buildWorkspaceQa(latest)
	};
};

export const actions: Actions = {
	upload: handleUploadAction,
	saveMapping: async ({ request }) => {
		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();
		const fileType = String(form.get('fileType') ?? '').trim();
		const version = parsePositiveVersion(String(form.get('version') ?? ''));
		const jsonRaw = String(form.get('json') ?? '').trim();
		const isActive = form.get('isActive') === 'on';

		if (!accountId) return { error: 'accountId is required' };
		if (!fileType) return { error: 'fileType is required' };
		if (!version) return { error: 'version must be a positive integer' };
		if (!jsonRaw) return { error: 'mapping JSON is required' };

		const json = parseMappingJson(jsonRaw);
		if (!json) return { error: 'mapping JSON is invalid JSON' };

		try {
			const id = await upsertMapping({ accountId, fileType, version, json, isActive });
			return { ok: true, id };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	},
	importMappingCsv: async ({ request }) => {
		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();
		const fileType = String(form.get('fileType') ?? '').trim();
		const version = parsePositiveVersion(String(form.get('version') ?? ''));
		const isActive = form.get('isActive') === 'on';
		const file = form.get('mappingFile');

		if (!accountId) return { error: 'accountId is required' };
		if (!fileType) return { error: 'fileType is required' };
		if (!version) return { error: 'version must be a positive integer' };
		if (!(file instanceof File) || file.size === 0) return { error: 'mapping CSV is required' };

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			const json = parseMappingCsv(buffer);
			const id = await upsertMapping({ accountId, fileType, version, json, isActive });
			return { ok: true, id, importedFieldCount: json.fieldCount };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	},
	deleteSession: async ({ request }) => {
		const form = await request.formData();
		const sessionId = String(form.get('sessionId') ?? '').trim();
		if (!sessionId) return { error: 'sessionId is required' };

		try {
			const result = await deleteUploadSession(sessionId);
			return { ok: true, ...result };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	},
	clearSessions: async () => {
		try {
			const result = await clearDemoSessions();
			return { ok: true, ...result };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	},
	runSession: async ({ request }) => {
		const form = await request.formData();
		const sessionId = String(form.get('sessionId') ?? '').trim();
		if (!sessionId) return { error: 'sessionId is required' };

		try {
			const manifest = await rerunAnalysisForSession(sessionId);
			return { ok: true, sessionId: manifest.sessionId, status: manifest.status };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	}
};
