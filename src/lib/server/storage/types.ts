export type FileType = 'eligibility' | 'medical' | 'pharmacy' | 'vision' | 'dental' | string;

export type UploadStat = {
	filename: string;
	bytes: number;
	rowCount: number | null;
	mime?: string;
	headers?: string[] | null;
	path?: string;
};

export type UploadRawRetention = {
	retained: boolean;
	reason: string;
	cleanupStatus: 'not_started' | 'deleted' | 'retained' | 'failed';
	rawUploadDir?: string;
};

export type UploadSessionDoc = {
	_id?: string;
	uploaderUserId: string;
	accountId: string;
	fileType: FileType;
	fileTypes?: FileType[];
	eligibilityStartDate?: string;
	usedMapping: 'stored' | 'provided' | 'canonical' | 'none';
	mappingVersion?: number;
	stats: UploadStat[];
	files?: Array<Record<string, unknown>>;
	validation?: Record<string, unknown>;
	rawUploadRetention?: UploadRawRetention;
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

export type AuditEventDoc = {
	_id?: string;
	event: string;
	ts: string;
	payload: Record<string, unknown>;
};

export type WorkspaceSummary = {
	uploadCount: number;
	mappingCount: number;
	activeMappings: number;
	latestUpload?: UploadSessionDoc;
	storePath: string;
	storageRoot: string;
};

export type DeleteSessionResult = {
	deleted: boolean;
	deletedArtifacts: string[];
};

export type ClearSessionsResult = {
	deletedSessions: number;
	deletedArtifacts: string[];
};

export type DocumentRepository = {
	insertUploadSession(doc: UploadSessionDoc): Promise<string>;
	listUploadSessions(filtersOrLimit?: UploadSessionFilters | number): Promise<UploadSessionDoc[]>;
	countUploadSessions(
		filters?: Pick<UploadSessionFilters, 'accountId' | 'fileType'>
	): Promise<number>;
	getUploadSession(sessionId: string): Promise<UploadSessionDoc | null>;
	deleteUploadSession(sessionId: string): Promise<DeleteSessionResult>;
	clearDemoSessions(): Promise<ClearSessionsResult>;
	getActiveMapping(accountId: string, fileType: string): Promise<MappingDoc | null>;
	listMappings(filters?: MappingFilters): Promise<MappingDoc[]>;
	upsertMapping(input: {
		accountId: string;
		fileType: string;
		version: number;
		json: Record<string, unknown>;
		isActive?: boolean;
	}): Promise<string>;
	recordAuditEvent(event: string, payload: Record<string, unknown>): Promise<string>;
	getWorkspaceSummary(): Promise<WorkspaceSummary>;
};
