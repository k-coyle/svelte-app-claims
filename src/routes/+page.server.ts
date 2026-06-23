import type { Actions, PageServerLoad } from './$types';
import { listAnalysisManifestsForSessions, rerunAnalysisForSession } from '$lib/server/analysis';
import {
	clearDemoSessions,
	deleteUploadSession,
	getWorkspaceSummary,
	listMappings,
	listUploadSessions,
	upsertMapping
} from '$lib/server/db';
import { mappingPayloadToFields, parseMappingCsv } from '$lib/server/mappingImport';
import { buildWorkspaceQa } from '$lib/server/workspace/qa';
import { getAllowedAccounts, getUser, handleUploadAction } from '$lib/server/workspace/upload';
import type { MappingDoc } from '$lib/server/db';

const CLAIMS_FILE_TYPES = ['eligibility', 'medical', 'pharmacy'] as const;

type AccountOption = { id: string; name: string };
type ClientOption = AccountOption & {
	mappingCount: number;
	fileTypes: string[];
};
type ClaimsFileType = (typeof CLAIMS_FILE_TYPES)[number];
type MappingDisplayRow = {
	sourceColumn: string;
	targetColumn: string;
	dtype: string;
	parseDate: boolean;
};
type MappingSummary = {
	fileType: ClaimsFileType;
	defaultReason: 'latest_confirmed_upload' | 'newest_added' | null;
	defaultMapping: {
		id?: string;
		name: string;
		version: number;
		fieldCount: number;
		updatedAt?: string;
		originalFilename?: string;
	} | null;
	versions: Array<{
		id?: string;
		name: string;
		version: number;
		fieldCount: number;
		updatedAt?: string;
		originalFilename?: string;
		fields: MappingDisplayRow[];
		isDefault: boolean;
	}>;
};

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

function trimOptional(value: FormDataEntryValue | null) {
	const text = String(value ?? '').trim();
	return text || undefined;
}

function mappingNameFromFile(file: File, explicitName?: string) {
	return explicitName?.trim() || file.name;
}

function mappingFieldCount(mapping: MappingDoc) {
	const raw = mapping.json?.fieldCount;
	if (typeof raw === 'number') return raw;
	return Object.keys(mappingPayloadToFields(mapping.json) ?? {}).length;
}

function mappingFields(mapping: MappingDoc): MappingDisplayRow[] {
	const columns = Array.isArray(mapping.json?.columns) ? mapping.json.columns : [];
	if (columns.length) {
		return columns.map((column) => {
			const record = column as Record<string, unknown>;
			return {
				sourceColumn: String(record.sourceColumn ?? ''),
				targetColumn: String(record.targetColumn ?? ''),
				dtype: String(record.dtype ?? ''),
				parseDate: Boolean(record.parseDate)
			};
		});
	}

	return Object.entries(mappingPayloadToFields(mapping.json) ?? {}).map(
		([sourceColumn, targetColumn]) => ({
			sourceColumn,
			targetColumn,
			dtype: '',
			parseDate: false
		})
	);
}

function newestMapping(mappings: MappingDoc[]) {
	return mappings.slice().sort((a, b) => {
		const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
		if (byUpdated) return byUpdated;
		return b.version - a.version;
	})[0];
}

function findSessionMappingReference(
	sessions: Array<{ files?: Array<Record<string, unknown>>; createdAt: string }>,
	fileType: string
) {
	const sorted = sessions.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
	for (const session of sorted) {
		const file = (session.files ?? []).find((candidate) => candidate.fileType === fileType);
		const mapping = file?.mapping as Record<string, unknown> | undefined;
		if (!mapping || mapping.source !== 'stored') continue;
		return {
			mappingId:
				typeof mapping.mappingId === 'string'
					? mapping.mappingId
					: typeof mapping.id === 'string'
						? mapping.id
						: undefined,
			version:
				typeof mapping.version === 'number'
					? mapping.version
					: Number.isInteger(Number(mapping.version))
						? Number(mapping.version)
						: undefined
		};
	}
	return null;
}

function displayMapping(mapping: MappingDoc) {
	return {
		id: mapping._id,
		name: mapping.name ?? mapping.originalFilename ?? `${mapping.fileType} v${mapping.version}`,
		version: mapping.version,
		fieldCount: mappingFieldCount(mapping),
		updatedAt: mapping.updatedAt,
		originalFilename: mapping.originalFilename
	};
}

function buildMappingSummaries(
	mappings: MappingDoc[],
	sessions: Array<{ files?: Array<Record<string, unknown>>; createdAt: string }>
): MappingSummary[] {
	return CLAIMS_FILE_TYPES.map((fileType) => {
		const typedMappings = mappings.filter((mapping) => mapping.fileType === fileType);
		const reference = findSessionMappingReference(sessions, fileType);
		const defaultFromSession =
			(reference?.mappingId
				? typedMappings.find((mapping) => mapping._id === reference.mappingId)
				: undefined) ??
			(reference?.version
				? typedMappings.find((mapping) => mapping.version === reference.version)
				: undefined);
		const fallback = newestMapping(typedMappings);
		const defaultMapping = defaultFromSession ?? fallback ?? null;
		const defaultReason = defaultFromSession
			? 'latest_confirmed_upload'
			: fallback
				? 'newest_added'
				: null;

		return {
			fileType,
			defaultReason,
			defaultMapping: defaultMapping ? displayMapping(defaultMapping) : null,
			versions: typedMappings
				.slice()
				.sort((a, b) => {
					const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
					if (byUpdated) return byUpdated;
					return b.version - a.version;
				})
				.map((mapping) => ({
					...displayMapping(mapping),
					fields: mappingFields(mapping),
					isDefault: Boolean(defaultMapping && mapping._id === defaultMapping._id)
				}))
		};
	});
}

function labelForAccount(accountId: string, allowedAccounts: AccountOption[]) {
	return allowedAccounts.find((account) => account.id === accountId)?.name ?? accountId;
}

function buildClientOptions(
	mappings: MappingDoc[],
	allowedAccounts: AccountOption[]
): ClientOption[] {
	const byAccount = new Map<
		string,
		{ id: string; name: string; count: number; fileTypes: Set<string> }
	>();

	for (const mapping of mappings) {
		const accountId = String(mapping.accountId ?? '').trim();
		if (!accountId) continue;
		const existing = byAccount.get(accountId) ?? {
			id: accountId,
			name: labelForAccount(accountId, allowedAccounts),
			count: 0,
			fileTypes: new Set<string>()
		};

		existing.count += 1;
		if (mapping.fileType) existing.fileTypes.add(String(mapping.fileType));
		byAccount.set(accountId, existing);
	}

	return Array.from(byAccount.values()).map((client) => ({
		id: client.id,
		name: client.name,
		mappingCount: client.count,
		fileTypes: Array.from(client.fileTypes).sort()
	}));
}

function selectClientId(
	requestedClientId: string | null,
	clientOptions: ClientOption[],
	input: {
		allowedAccounts: AccountOption[];
		recentUploads: Array<{ accountId?: string | null }>;
		user: ReturnType<typeof getUser>;
	}
) {
	const hasClient = (accountId?: string | null) =>
		Boolean(accountId && clientOptions.some((client) => client.id === accountId));

	if (requestedClientId && hasClient(requestedClientId)) {
		return requestedClientId;
	}

	if (input.user.role === 'client' && input.user.accountId && hasClient(input.user.accountId)) {
		return input.user.accountId;
	}

	if (input.user.role !== 'client') {
		const latestUploadAccount = input.recentUploads.find((session) =>
			hasClient(session.accountId)
		)?.accountId;
		if (latestUploadAccount) return latestUploadAccount;
	}

	const allowedAccount = input.allowedAccounts.find((account) => hasClient(account.id))?.id;
	if (allowedAccount) return allowedAccount;

	return clientOptions[0]?.id ?? '';
}

export const load: PageServerLoad = async ({ url }) => {
	const user = getUser();
	const allowedAccounts = getAllowedAccounts(user);
	const [summary, defaultCandidateUploads, allMappings] = await Promise.all([
		getWorkspaceSummary(),
		listUploadSessions({ page: 1, pageSize: 8, sort: 'newest' }),
		listMappings({ limit: 500 })
	]);
	const clientOptions = buildClientOptions(allMappings, allowedAccounts);
	const selectedClientId = selectClientId(url.searchParams.get('client'), clientOptions, {
		allowedAccounts,
		recentUploads: defaultCandidateUploads,
		user
	});
	const allUploadSessions = selectedClientId
		? await listUploadSessions({
				accountId: selectedClientId,
				page: 1,
				pageSize: 100,
				sort: 'newest'
			})
		: [];
	const recentUploads = allUploadSessions.slice(0, 8);
	const sessionIds = allUploadSessions
		.map((session) => session._id)
		.filter((sessionId): sessionId is string => Boolean(sessionId));
	const runs = await listAnalysisManifestsForSessions(sessionIds);
	const latest = runs[0] ?? null;
	const mappings = selectedClientId
		? allMappings.filter((mapping) => mapping.accountId === selectedClientId)
		: [];
	const mappingSummaries = buildMappingSummaries(mappings, allUploadSessions);

	return {
		allowedAccounts,
		clientOptions,
		selectedClientId,
		defaultAccountId: selectedClientId,
		userId: user.id,
		summary,
		recentUploads,
		mappings,
		mappingSummaries,
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
		const name = trimOptional(form.get('name'));
		const jsonRaw = String(form.get('json') ?? '').trim();
		const isActive = form.get('isActive') !== 'off';

		if (!accountId) return { error: 'accountId is required' };
		if (!fileType) return { error: 'fileType is required' };
		if (!version) return { error: 'version must be a positive integer' };
		if (!jsonRaw) return { error: 'mapping JSON is required' };

		const json = parseMappingJson(jsonRaw);
		if (!json) return { error: 'mapping JSON is invalid JSON' };

		try {
			const id = await upsertMapping({ accountId, fileType, version, name, json, isActive });
			return { ok: true, id };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'unexpected error' };
		}
	},
	importMappingCsv: async ({ request }) => {
		const form = await request.formData();
		const accountId = String(form.get('accountId') ?? '').trim();

		if (!accountId) return { error: 'accountId is required' };

		try {
			const existingMappings = await listMappings({ accountId, limit: 500 });
			const imports: Array<{
				fileType: string;
				file: File;
				version: number;
				name: string;
				originalFilename: string;
			}> = [];

			for (const fileType of CLAIMS_FILE_TYPES) {
				const file = form.get(`mappingFile:${fileType}`);
				if (!(file instanceof File) || file.size === 0) continue;
				const version = parsePositiveVersion(String(form.get(`version:${fileType}`) ?? '1'));
				if (!version) return { error: `${fileType} version must be a positive integer` };
				const name = mappingNameFromFile(file, trimOptional(form.get(`name:${fileType}`)));
				imports.push({ fileType, file, version, name, originalFilename: file.name });
			}

			const legacyFile = form.get('mappingFile');
			if (legacyFile instanceof File && legacyFile.size > 0) {
				const fileType = String(form.get('fileType') ?? '').trim();
				const version = parsePositiveVersion(String(form.get('version') ?? ''));
				if (!fileType) return { error: 'fileType is required' };
				if (!version) return { error: 'version must be a positive integer' };
				const name = mappingNameFromFile(legacyFile, trimOptional(form.get('name')));
				imports.push({
					fileType,
					file: legacyFile,
					version,
					name,
					originalFilename: legacyFile.name
				});
			}

			if (!imports.length) return { error: 'mapping CSV is required' };

			const imported = [];
			for (const item of imports) {
				const buffer = Buffer.from(await item.file.arrayBuffer());
				const json = parseMappingCsv(buffer);
				const id = await upsertMapping({
					accountId,
					fileType: item.fileType,
					version: item.version,
					name: item.name,
					originalFilename: item.originalFilename,
					json,
					isActive: true
				});
				imported.push({
					id,
					fileType: item.fileType,
					version: item.version,
					name: item.name,
					importedFieldCount: json.fieldCount
				});
			}

			return {
				ok: true,
				id: imported[0]?.id,
				imported,
				importedFieldCount: imported[0]?.importedFieldCount,
				clientCreated: existingMappings.length === 0
			};
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
