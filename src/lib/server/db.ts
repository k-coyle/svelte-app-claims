import { fileDocumentRepository } from './storage/fileRepository';
import type {
	FileType,
	DefaultMappingDoc,
	MappingDoc,
	MappingFilters,
	UploadRawRetention,
	UploadSessionDoc,
	UploadSessionFilters,
	UploadStat
} from './storage/types';

export type {
	FileType,
	DefaultMappingDoc,
	MappingDoc,
	MappingFilters,
	UploadRawRetention,
	UploadSessionDoc,
	UploadSessionFilters,
	UploadStat
};

export async function insertUploadSession(doc: UploadSessionDoc): Promise<string> {
	return fileDocumentRepository.insertUploadSession(doc);
}

export async function listUploadSessions(filtersOrLimit: UploadSessionFilters | number = 50) {
	return fileDocumentRepository.listUploadSessions(filtersOrLimit);
}

export async function countUploadSessions(
	filters: Pick<UploadSessionFilters, 'accountId' | 'fileType'> = {}
) {
	return fileDocumentRepository.countUploadSessions(filters);
}

export async function getUploadSession(sessionId: string): Promise<UploadSessionDoc | null> {
	return fileDocumentRepository.getUploadSession(sessionId);
}

export async function deleteUploadSession(sessionId: string) {
	return fileDocumentRepository.deleteUploadSession(sessionId);
}

export async function clearDemoSessions() {
	return fileDocumentRepository.clearDemoSessions();
}

export async function getActiveMapping(
	accountId: string,
	fileType: string
): Promise<MappingDoc | null> {
	return fileDocumentRepository.getActiveMapping(accountId, fileType);
}

export async function getDefaultMapping(
	accountId: string,
	fileType: string
): Promise<DefaultMappingDoc | null> {
	return fileDocumentRepository.getDefaultMapping(accountId, fileType);
}

export async function listMappings(filters: MappingFilters = {}) {
	return fileDocumentRepository.listMappings(filters);
}

export async function upsertMapping(input: {
	accountId: string;
	fileType: string;
	version: number;
	name?: string;
	originalFilename?: string;
	json: Record<string, unknown>;
	isActive?: boolean;
}): Promise<string> {
	return fileDocumentRepository.upsertMapping(input);
}

export async function recordAuditEvent(event: string, payload: Record<string, unknown>) {
	return fileDocumentRepository.recordAuditEvent(event, payload);
}

export async function getWorkspaceSummary() {
	return fileDocumentRepository.getWorkspaceSummary();
}
