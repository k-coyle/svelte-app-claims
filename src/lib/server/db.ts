// src/lib/server/db.ts
import { MongoClient, type Db } from 'mongodb';

/** --- Config (env) --- */
const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB ?? 'Claims';

/** --- Lazy client --- */
let _client: MongoClient | null = null;
export async function getClient(): Promise<MongoClient> {
  if (_client) return _client;
  _client = new MongoClient(uri, { ignoreUndefined: true });
  // Do not connect on import; connect only when a function is called:
  return _client;
}

async function getDb(): Promise<Db> {
  const cli = await getClient();
  if (!cli.topology || (cli as any).topology?.s.state !== 'connected') {
    await cli.connect();
  }
  return cli.db(dbName);
}

/** --- Types --- */
export type UploadStat = {
  filename: string;
  bytes: number;
  rowCount: number | null;
  mime?: string;
  headers?: string[] | null;
  path?: string; // optional, only after saving to disk
};

export type UploadSessionDoc = {
  _id?: unknown;
  uploaderUserId: string;
  accountId: string;
  fileType: string;
  eligibilityStartDate?: string;
  usedMapping: 'stored' | 'provided' | 'none';
  mappingVersion?: number;
  stats: UploadStat[];
  createdAt: string;
  totalBytes: number;
  audit?: { previewAt?: string; confirmAt?: string };
};

export type MappingDoc = {
  _id?: unknown;
  accountId: string;
  fileType: string;
  isActive: boolean;
  version: number;
  json: Record<string, unknown>;
  updatedAt: string;
};

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';
export type JobDoc = {
  _id?: unknown;
  sessionId: string;
  accountId: string;
  fileType: string;
  mappingVersion?: number;
  files: Array<{ path: string; filename: string; bytes: number }>;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  stats?: { processedRows?: number };
  // Eligibility MVP extras:
  eligibilityStartDate?: string | null;
  mapping?: { fields: Record<string, string> } | null;
};

/** --- Index bootstrap (idempotent) --- */
let _indexed = false;
export async function ensureIndexes(): Promise<void> {
  if (_indexed) return;
  const db = await getDb();

  const sessions = db.collection<UploadSessionDoc>('upload_sessions');
  await sessions.createIndex({ accountId: 1, createdAt: -1 }, { name: 'sessions_account_created' });
  await sessions.createIndex({ fileType: 1, createdAt: -1 }, { name: 'sessions_type_created' });

  const mappings = db.collection<MappingDoc>('mappings');
  await mappings.createIndex(
    { accountId: 1, fileType: 1, isActive: -1, updatedAt: -1, version: -1 },
    { name: 'mappings_lookup' }
  );

  const jobs = db.collection<JobDoc>('jobs');
  await jobs.createIndex({ status: 1, createdAt: 1 }, { name: 'jobs_status_created' });
  await jobs.createIndex({ sessionId: 1 }, { name: 'jobs_session' });

  _indexed = true;
}

/** --- Upload sessions --- */
export async function insertUploadSession(doc: UploadSessionDoc): Promise<string> {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date().toISOString();
  const res = await db.collection<UploadSessionDoc>('upload_sessions').insertOne({
    ...doc,
    createdAt: doc.createdAt ?? now
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String((res as any).insertedId);
}

export async function listUploadSessions(limit = 50) {
  await ensureIndexes();
  const db = await getDb();
  return db
    .collection<UploadSessionDoc>('upload_sessions')
    .find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** --- Mappings --- */
export async function getActiveMapping(accountId: string, fileType: string): Promise<MappingDoc | null> {
  await ensureIndexes();
  const db = await getDb();
  return db
    .collection<MappingDoc>('mappings')
    .find({ accountId, fileType, isActive: true })
    .sort({ updatedAt: -1, version: -1 })
    .limit(1)
    .next();
}

/** --- Jobs (✅ this is what the test checks is exported) --- */
export async function enqueueJob(
  doc: Omit<JobDoc, '_id' | 'status' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  await ensureIndexes();
  const db = await getDb();
  const now = new Date().toISOString();
  const res = await db.collection<JobDoc>('jobs').insertOne({
    ...doc,
    status: 'queued',
    createdAt: now,
    updatedAt: now
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String((res as any).insertedId);
}
