// src/routes/admin/mappings/+page.server.ts
import type { PageServerLoad, Actions } from './$types';
import { listMappings, upsertMapping } from '$lib/server/db';
import { parseMappingCsv } from '$lib/server/mappingImport';

// Local workspace role used until auth is added.
type User = { id: string; role: 'client' | 'client_manager'; accountId?: string };
function getUser(): User {
	return { id: 'user_123', role: 'client_manager' };
}

export const load: PageServerLoad = async ({ url }) => {
	const user = getUser();
	if (user.role !== 'client_manager') {
		return { error: 'Not authorized' };
	}

	const accountId = url.searchParams.get('accountId') ?? '';
	const fileType = url.searchParams.get('fileType') ?? '';
	const rows = await listMappings({
		accountId: accountId || undefined,
		fileType: fileType || undefined,
		limit: 100
	});

	return { rows, filters: { accountId, fileType } };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const user = getUser();
		if (user.role !== 'client_manager') return { error: 'Not authorized' };

		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();
		const fileType = String(form.get('fileType') ?? '').trim();
		const versionRaw = String(form.get('version') ?? '').trim();
		const jsonRaw = String(form.get('json') ?? '').trim();
		const isActive = form.get('isActive') === 'on';

		if (!accountId) return { error: 'accountId is required' };
		if (!fileType) return { error: 'fileType is required' };
		const version = Number(versionRaw);
		if (!Number.isInteger(version) || version <= 0)
			return { error: 'version must be a positive integer' };
		if (!jsonRaw) return { error: 'mapping JSON is required' };

		let json: Record<string, unknown>;
		try {
			json = JSON.parse(jsonRaw);
			if (typeof json !== 'object' || Array.isArray(json) || json === null) {
				return { error: 'mapping JSON must be an object' };
			}
		} catch {
			return { error: 'mapping JSON is invalid JSON' };
		}

		try {
			const id = await upsertMapping({ accountId, fileType, version, json, isActive });
			return { ok: true, id };
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unexpected error';
			return { error: msg };
		}
	},
	importCsv: async ({ request }) => {
		const user = getUser();
		if (user.role !== 'client_manager') return { error: 'Not authorized' };

		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();
		const fileType = String(form.get('fileType') ?? '').trim();
		const versionRaw = String(form.get('version') ?? '').trim();
		const isActive = form.get('isActive') === 'on';
		const file = form.get('mappingFile');

		if (!accountId) return { error: 'accountId is required' };
		if (!fileType) return { error: 'fileType is required' };
		const version = Number(versionRaw);
		if (!Number.isInteger(version) || version <= 0)
			return { error: 'version must be a positive integer' };
		if (!(file instanceof File) || file.size === 0) return { error: 'mapping CSV is required' };

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			const json = parseMappingCsv(buffer);
			const id = await upsertMapping({ accountId, fileType, version, json, isActive });
			return { ok: true, id, importedFieldCount: json.fieldCount };
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unexpected error';
			return { error: msg };
		}
	}
};
