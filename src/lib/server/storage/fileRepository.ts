import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
	AuditEventDoc,
	ClearSessionsResult,
	DeleteSessionResult,
	DocumentRepository,
	MappingDoc,
	MappingFilters,
	UploadSessionDoc,
	UploadSessionFilters
} from './types';

type UploadIndex = { upload_sessions: UploadSessionDoc[] };
type MappingIndex = { mappings: MappingDoc[] };
type AuditIndex = { audit_events: AuditEventDoc[] };

export type FileRepositoryOptions = {
	rootDir?: string;
};

const defaultRoot = () => process.env.CLAIMS_STORAGE_ROOT ?? join(process.cwd(), 'var');

function nowIso() {
	return new Date().toISOString();
}

function id(prefix: string) {
	return `${prefix}_${randomUUID()}`;
}

function assertSafeSegment(value: string) {
	if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
		throw new Error('Invalid session identifier.');
	}
}

function pathInside(base: string, candidate: string) {
	const resolvedBase = resolve(base).toLowerCase();
	const resolvedCandidate = resolve(candidate).toLowerCase();
	return (
		resolvedCandidate === resolvedBase ||
		resolvedCandidate.startsWith(`${resolvedBase}\\`) ||
		resolvedCandidate.startsWith(`${resolvedBase}/`)
	);
}

async function readJsonFile<T>(path: string, fallback: () => T): Promise<T> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback();
		throw error;
	}
}

async function writeJsonFile(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
	await rename(tmp, path);
}

function seedMappings(): MappingDoc[] {
	const ts = nowIso();
	return [
		{
			_id: 'map_clientA_eligibility_v1',
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
			createdAt: ts,
			updatedAt: ts
		}
	];
}

function uploadPredicate(filters: Pick<UploadSessionFilters, 'accountId' | 'fileType'>) {
	return (row: UploadSessionDoc) =>
		(!filters.accountId || row.accountId === filters.accountId) &&
		(!filters.fileType ||
			row.fileType === filters.fileType ||
			(Array.isArray(row.fileTypes) && row.fileTypes.includes(filters.fileType)));
}

function mappingPredicate(filters: Pick<MappingFilters, 'accountId' | 'fileType'>) {
	return (row: MappingDoc) =>
		(!filters.accountId || row.accountId === filters.accountId) &&
		(!filters.fileType || row.fileType === filters.fileType);
}

export function createFileDocumentRepository(
	options: FileRepositoryOptions = {}
): DocumentRepository {
	const rootDir = options.rootDir ?? defaultRoot();
	const uploadIndexPath = join(rootDir, 'indexes', 'upload-sessions.json');
	const mappingIndexPath = join(rootDir, 'indexes', 'mappings.json');
	const auditIndexPath = join(rootDir, 'indexes', 'audit-events.json');

	const sessionDir = (sessionId: string) => {
		assertSafeSegment(sessionId);
		return join(rootDir, 'sessions', sessionId);
	};
	const analysisDir = (sessionId: string) => {
		assertSafeSegment(sessionId);
		return join(rootDir, 'analysis', sessionId);
	};
	const uploadsDir = (sessionId: string) => {
		assertSafeSegment(sessionId);
		return join(rootDir, 'uploads', sessionId);
	};

	async function readUploadIndex() {
		return readJsonFile<UploadIndex>(uploadIndexPath, () => ({ upload_sessions: [] }));
	}

	async function writeUploadIndex(index: UploadIndex) {
		await writeJsonFile(uploadIndexPath, index);
	}

	async function readMappingIndex() {
		return readJsonFile<MappingIndex>(mappingIndexPath, () => ({ mappings: seedMappings() }));
	}

	async function writeMappingIndex(index: MappingIndex) {
		await writeJsonFile(mappingIndexPath, index);
	}

	async function readAuditIndex() {
		return readJsonFile<AuditIndex>(auditIndexPath, () => ({ audit_events: [] }));
	}

	async function writeAuditIndex(index: AuditIndex) {
		await writeJsonFile(auditIndexPath, index);
	}

	async function writeSessionDoc(doc: UploadSessionDoc) {
		if (!doc._id) throw new Error('Session identifier is required.');
		await writeJsonFile(join(sessionDir(doc._id), 'session.json'), doc);
	}

	async function insertUploadSession(doc: UploadSessionDoc) {
		const createdAt = doc.createdAt ?? nowIso();
		const _id = doc._id ?? id('sess');
		assertSafeSegment(_id);
		const stored = { ...doc, _id, createdAt };
		const index = await readUploadIndex();
		const existingIndex = index.upload_sessions.findIndex((row) => row._id === _id);
		if (existingIndex >= 0) index.upload_sessions[existingIndex] = stored;
		else index.upload_sessions.push(stored);
		await writeSessionDoc(stored);
		await writeUploadIndex(index);
		return _id;
	}

	async function listUploadSessions(filtersOrLimit: UploadSessionFilters | number = 50) {
		const filters =
			typeof filtersOrLimit === 'number' ? { page: 1, pageSize: filtersOrLimit } : filtersOrLimit;
		const page = Math.max(1, Number(filters.page ?? 1));
		const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize ?? 50)));
		const index = await readUploadIndex();
		const sorted = index.upload_sessions.filter(uploadPredicate(filters)).sort((a, b) => {
			const delta = Date.parse(b.createdAt) - Date.parse(a.createdAt);
			return filters.sort === 'oldest' ? -delta : delta;
		});

		return sorted.slice((page - 1) * pageSize, page * pageSize);
	}

	async function countUploadSessions(
		filters: Pick<UploadSessionFilters, 'accountId' | 'fileType'> = {}
	) {
		const index = await readUploadIndex();
		return index.upload_sessions.filter(uploadPredicate(filters)).length;
	}

	async function getUploadSession(sessionId: string) {
		assertSafeSegment(sessionId);
		const index = await readUploadIndex();
		return index.upload_sessions.find((row) => row._id === sessionId) ?? null;
	}

	async function deleteUploadSession(sessionId: string): Promise<DeleteSessionResult> {
		assertSafeSegment(sessionId);
		const index = await readUploadIndex();
		const before = index.upload_sessions.length;
		index.upload_sessions = index.upload_sessions.filter((row) => row._id !== sessionId);
		await writeUploadIndex(index);

		const deletedArtifacts: string[] = [];
		for (const path of [sessionDir(sessionId), analysisDir(sessionId), uploadsDir(sessionId)]) {
			if (!pathInside(rootDir, path)) continue;
			await rm(path, { recursive: true, force: true });
			deletedArtifacts.push(path);
		}

		return { deleted: before !== index.upload_sessions.length, deletedArtifacts };
	}

	async function clearDemoSessions(): Promise<ClearSessionsResult> {
		const index = await readUploadIndex();
		const sessionIds = index.upload_sessions
			.map((row) => row._id)
			.filter((sessionId): sessionId is string => Boolean(sessionId));
		const deletedArtifacts: string[] = [];
		for (const sessionId of sessionIds) {
			const result = await deleteUploadSession(sessionId);
			deletedArtifacts.push(...result.deletedArtifacts);
		}
		for (const path of [
			join(rootDir, 'sessions'),
			join(rootDir, 'analysis'),
			join(rootDir, 'uploads')
		]) {
			if (!pathInside(rootDir, path)) continue;
			await rm(path, { recursive: true, force: true });
			deletedArtifacts.push(path);
		}
		await writeUploadIndex({ upload_sessions: [] });
		return { deletedSessions: sessionIds.length, deletedArtifacts };
	}

	async function getActiveMapping(accountId: string, fileType: string) {
		const index = await readMappingIndex();
		return (
			index.mappings
				.filter((row) => row.accountId === accountId && row.fileType === fileType && row.isActive)
				.sort((a, b) => {
					const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
					return byUpdated || b.version - a.version;
				})[0] ?? null
		);
	}

	async function listMappings(filters: MappingFilters = {}) {
		const index = await readMappingIndex();
		const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100)));
		return index.mappings
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

	async function upsertMapping(input: {
		accountId: string;
		fileType: string;
		version: number;
		json: Record<string, unknown>;
		isActive?: boolean;
	}) {
		const index = await readMappingIndex();
		const ts = nowIso();
		const existing = index.mappings.find(
			(row) =>
				row.accountId === input.accountId &&
				row.fileType === input.fileType &&
				row.version === input.version
		);

		if (input.isActive) {
			for (const row of index.mappings) {
				if (row.accountId === input.accountId && row.fileType === input.fileType) {
					row.isActive = false;
					row.updatedAt = ts;
				}
			}
		}

		if (existing) {
			existing.json = input.json;
			existing.isActive = Boolean(input.isActive);
			existing.updatedAt = ts;
			await writeMappingIndex(index);
			return existing._id ?? '';
		}

		const _id = id('map');
		index.mappings.push({
			_id,
			accountId: input.accountId,
			fileType: input.fileType,
			version: input.version,
			json: input.json,
			isActive: Boolean(input.isActive),
			createdAt: ts,
			updatedAt: ts
		});
		await writeMappingIndex(index);
		return _id;
	}

	async function recordAuditEvent(event: string, payload: Record<string, unknown>) {
		const auditIndex = await readAuditIndex();
		const _id = id('audit');
		auditIndex.audit_events.push({ _id, event, ts: nowIso(), payload });
		await writeAuditIndex(auditIndex);
		return _id;
	}

	async function getWorkspaceSummary() {
		const [uploadIndex, mappingIndex] = await Promise.all([readUploadIndex(), readMappingIndex()]);
		const latestUpload = uploadIndex.upload_sessions
			.slice()
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
		return {
			uploadCount: uploadIndex.upload_sessions.length,
			mappingCount: mappingIndex.mappings.length,
			activeMappings: mappingIndex.mappings.filter((row) => row.isActive).length,
			latestUpload,
			storePath: join(rootDir, 'indexes'),
			storageRoot: rootDir
		};
	}

	return {
		insertUploadSession,
		listUploadSessions,
		countUploadSessions,
		getUploadSession,
		deleteUploadSession,
		clearDemoSessions,
		getActiveMapping,
		listMappings,
		upsertMapping,
		recordAuditEvent,
		getWorkspaceSummary
	};
}

export const fileDocumentRepository = createFileDocumentRepository();
