import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const storePath = process.env.CLAIMS_LOCAL_STORE_PATH ?? join(process.cwd(), 'var', 'local-store.json');

export type FileType = 'eligibility' | 'medical' | 'pharmacy' | 'vision' | 'dental' | string;

export type UploadStat = {
	filename: string;
	bytes: number;
	rowCount: number | null;
	mime?: string;
	headers?: string[] | null;
	path?: string;
};

export type UploadSessionDoc = {
	_id?: string;
	uploaderUserId: string;
	accountId: string;
	fileType: FileType;
	eligibilityStartDate?: string;
	usedMapping: 'stored' | 'provided' | 'none';
	mappingVersion?: number;
	stats: UploadStat[];
	createdAt: string;
	totalBytes: number;
	audit?: { previewAt?: string; confirmAt?: string };
};

export type MappingDoc = {
	_id?: string;
	accountId: string;
	fileType: FileType;
	isActive: boolean;
	version: number;
	json: Record<string, unknown>;
	createdAt?: string;
	updatedAt: string;
};

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type JobDoc = {
	_id?: string;
	sessionId: string;
	accountId: string;
	fileType: FileType;
	mappingVersion?: number;
	files: Array<{ path: string; filename: string; bytes: number }>;
	status: JobStatus;
	createdAt: string;
	updatedAt: string;
	error?: string;
	stats?: { processedRows?: number };
	eligibilityStartDate?: string | null;
	mapping?: { fields: Record<string, string> } | null;
};

type LocalStore = {
	upload_sessions: UploadSessionDoc[];
	mappings: MappingDoc[];
	jobs: JobDoc[];
};

export type UploadSessionFilters = {
	accountId?: string;
	fileType?: string;
	page?: number;
	pageSize?: number;
	sort?: 'newest' | 'oldest';
};

export type MappingFilters = {
	accountId?: string;
	fileType?: string;
	limit?: number;
};

const emptyStore = (): LocalStore => {
	const now = new Date().toISOString();
	return {
		upload_sessions: [],
		mappings: [
			{
				_id: 'map_demo_clientA_eligibility_v1',
				accountId: 'clientA',
				fileType: 'eligibility',
				version: 1,
				isActive: true,
				json: {
					MemberID: 'member_id',
					EligibilityStart: 'medical_eligibility_start_date',
					EligibilityEnd: 'medical_eligibility_end_date',
					Relationship: 'member_relationship'
				},
				createdAt: now,
				updatedAt: now
			}
		],
		jobs: []
	};
};

async function ensureStoreFile() {
	await mkdir(dirname(storePath), { recursive: true });
}

async function readStore(): Promise<LocalStore> {
	await ensureStoreFile();
	try {
		const raw = await readFile(storePath, 'utf8');
		const parsed = JSON.parse(raw) as Partial<LocalStore>;
		return {
			upload_sessions: Array.isArray(parsed.upload_sessions) ? parsed.upload_sessions : [],
			mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [],
			jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
		};
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
		throw e;
	}
}

let writeQueue = Promise.resolve();

async function writeStore(store: LocalStore): Promise<void> {
	await ensureStoreFile();
	const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
	await rename(tmp, storePath);
}

async function mutateStore<T>(fn: (store: LocalStore) => T | Promise<T>): Promise<T> {
	const work = writeQueue.then(async () => {
		const store = await readStore();
		const result = await fn(store);
		await writeStore(store);
		return result;
	});
	writeQueue = work.then(
		() => undefined,
		() => undefined
	);
	return work;
}

function id(prefix: string) {
	return `${prefix}_${randomUUID()}`;
}

function uploadPredicate(filters: Pick<UploadSessionFilters, 'accountId' | 'fileType'>) {
	return (row: UploadSessionDoc) =>
		(!filters.accountId || row.accountId === filters.accountId) &&
		(!filters.fileType || row.fileType === filters.fileType);
}

function mappingPredicate(filters: Pick<MappingFilters, 'accountId' | 'fileType'>) {
	return (row: MappingDoc) =>
		(!filters.accountId || row.accountId === filters.accountId) &&
		(!filters.fileType || row.fileType === filters.fileType);
}

export async function ping(): Promise<{ ok: true; storePath: string }> {
	await readStore();
	return { ok: true, storePath };
}

export async function ensureIndexes(): Promise<void> {
	await ping();
}

export async function insertUploadSession(doc: UploadSessionDoc): Promise<string> {
	return mutateStore((store) => {
		const now = new Date().toISOString();
		const _id = doc._id ?? id('sess');
		store.upload_sessions.push({
			...doc,
			_id,
			createdAt: doc.createdAt ?? now
		});
		return _id;
	});
}

export async function listUploadSessions(filtersOrLimit: UploadSessionFilters | number = 50) {
	const store = await readStore();
	const filters =
		typeof filtersOrLimit === 'number' ? { page: 1, pageSize: filtersOrLimit } : filtersOrLimit;
	const page = Math.max(1, Number(filters.page ?? 1));
	const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize ?? 50)));
	const sorted = store.upload_sessions
		.filter(uploadPredicate(filters))
		.sort((a, b) => {
			const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
			return filters.sort === 'oldest' ? -delta : delta;
		});

	return sorted.slice((page - 1) * pageSize, page * pageSize);
}

export async function countUploadSessions(filters: Pick<UploadSessionFilters, 'accountId' | 'fileType'> = {}) {
	const store = await readStore();
	return store.upload_sessions.filter(uploadPredicate(filters)).length;
}

export async function getActiveMapping(accountId: string, fileType: string): Promise<MappingDoc | null> {
	const store = await readStore();
	return (
		store.mappings
			.filter((row) => row.accountId === accountId && row.fileType === fileType && row.isActive)
			.sort((a, b) => {
				const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
				return byUpdated || b.version - a.version;
			})[0] ?? null
	);
}

export async function listMappings(filters: MappingFilters = {}) {
	const store = await readStore();
	const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100)));
	return store.mappings
		.filter(mappingPredicate(filters))
		.sort((a, b) => {
			const byAccount = a.accountId.localeCompare(b.accountId);
			if (byAccount) return byAccount;
			const byType = String(a.fileType).localeCompare(String(b.fileType));
			if (byType) return byType;
			return b.version - a.version;
		})
		.slice(0, limit);
}

export async function upsertMapping(input: {
	accountId: string;
	fileType: string;
	version: number;
	json: Record<string, unknown>;
	isActive?: boolean;
}): Promise<string> {
	return mutateStore((store) => {
		const now = new Date().toISOString();
		const existing = store.mappings.find(
			(row) =>
				row.accountId === input.accountId &&
				row.fileType === input.fileType &&
				row.version === input.version
		);

		if (input.isActive) {
			for (const row of store.mappings) {
				if (row.accountId === input.accountId && row.fileType === input.fileType) {
					row.isActive = false;
					row.updatedAt = now;
				}
			}
		}

		if (existing) {
			existing.json = input.json;
			existing.isActive = Boolean(input.isActive);
			existing.updatedAt = now;
			return existing._id ?? '';
		}

		const _id = id('map');
		store.mappings.push({
			_id,
			accountId: input.accountId,
			fileType: input.fileType,
			version: input.version,
			json: input.json,
			isActive: Boolean(input.isActive),
			createdAt: now,
			updatedAt: now
		});
		return _id;
	});
}

export async function enqueueJob(
	doc: Omit<JobDoc, '_id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	return mutateStore((store) => {
		const now = new Date().toISOString();
		const _id = id('job');
		store.jobs.push({
			...doc,
			_id,
			status: 'queued',
			createdAt: now,
			updatedAt: now
		});
		return _id;
	});
}

export async function listJobs(limit = 50): Promise<JobDoc[]> {
	const store = await readStore();
	return store.jobs
		.slice()
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
		.slice(0, limit);
}

export async function getDemoSummary() {
	const store = await readStore();
	const activeMappings = store.mappings.filter((row) => row.isActive).length;
	const queuedJobs = store.jobs.filter((row) => row.status === 'queued').length;
	const latestUpload = store.upload_sessions
		.slice()
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

	return {
		uploadCount: store.upload_sessions.length,
		mappingCount: store.mappings.length,
		activeMappings,
		queuedJobs,
		latestUpload,
		storePath
	};
}
