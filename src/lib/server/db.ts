// src/lib/server/db.ts
import { MongoClient, ObjectId } from 'mongodb';
import { env } from '$env/dynamic/private'; // SvelteKit server-side env

// ---- Config (Atlas .env) ----
// .env should have:
//   MONGODB_URI="mongodb+srv://<user>:<pass>@<host>/?retryWrites=true&w=majority"
//   MONGODB_DB="xxx" 
const uri = env.MONGODB_URI;
const dbName = env.MONGODB_DB;
if (!dbName) throw new Error('MONGODB_DB is not set (e.g. "Claims")');


// ---- Safe client cache (only cache after a successful connect) ----
let client: MongoClient | null = null;
let indexesEnsured = false;

async function getClient(): Promise<MongoClient> {
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (client) return client;

  const cli = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    retryWrites: true,
    serverSelectionTimeoutMS: 10_000
  });

  await cli.connect(); // only cache after connect succeeds
  client = cli;
  return client;
}

// ---- Indexes (idempotent; called on first write/list) ----
async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) return;

  const cli = await getClient();

  // upload_sessions: list by account/type + createdAt
  const sessCol = cli.db(dbName).collection('upload_sessions');
  await sessCol.createIndex({ accountId: 1, createdAt: -1 }, { name: 'acct_created_desc' });
  await sessCol.createIndex({ fileType: 1, createdAt: -1 }, { name: 'type_created_desc' });

  // mappings: fast active lookup per (accountId, fileType)
  const mapCol = cli.db(dbName).collection('mappings');
  await mapCol.createIndex(
    { accountId: 1, fileType: 1, isActive: -1, updatedAt: -1, version: -1 },
    { name: 'mappings_lookup' }
  );

  indexesEnsured = true;
}

// ===================== Types =====================
export type UploadStat = {
  filename: string;
  bytes: number;
  rowCount: number | null;
  mime?: string;
  headers?: string[];
};

export type UploadSession = {
  _id?: unknown; // ObjectId
  uploaderUserId: string;
  accountId: string;
  fileType: string; // 'eligibility' | 'medical' | 'pharmacy' | 'vision' | 'dental' | ...
  eligibilityStartDate?: string;
  usedMapping: 'stored' | 'provided' | 'none';
  mappingVersion?: number;
  stats: UploadStat[];
  createdAt: string; // ISO
  totalBytes: number;
  audit?: { previewAt?: string; confirmAt?: string };
};

export type MappingDoc = {
  _id?: unknown;
  accountId: string;
  fileType: string;
  version: number;                 // increment per change: 1,2,3…
  json: Record<string, unknown>;   // canonical mapping payload
  isActive?: boolean;              // optional flag; newest wins otherwise
  createdAt: string;               // ISO
  updatedAt: string;               // ISO
};

// ===================== Write API =====================
export async function insertUploadSession(doc: {
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
}): Promise<string> {
  await ensureIndexes();
  const cli = await getClient();
  const res = await cli.db(dbName).collection<UploadSession>('upload_sessions').insertOne(doc);
  return (res.insertedId as ObjectId).toString();
}

// ===================== Read API =====================
export async function listUploadSessions(params: {
  accountId?: string;
  fileType?: string;
  page?: number;
  pageSize?: number;
  sort?: 'newest' | 'oldest';
}): Promise<UploadSession[]> {
  await ensureIndexes();
  const cli = await getClient();
  const col = cli.db(dbName).collection<UploadSession>('upload_sessions');

  const { accountId, fileType, page = 1, pageSize = 10, sort = 'newest' } = params;
  const q: Record<string, unknown> = {};
  if (accountId) q.accountId = accountId;
  if (fileType) q.fileType = fileType;

  const skip = Math.max(0, (page - 1) * pageSize);
  const sortSpec = sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };

  const cursor = col
    .find(q, {
      projection: {
        uploaderUserId: 1,
        accountId: 1,
        fileType: 1,
        createdAt: 1,
        totalBytes: 1,
        stats: { $slice: 1 } // list view only needs first file quick peek
      }
    })
    .sort(sortSpec)
    .skip(skip)
    .limit(pageSize);

  return await cursor.toArray();
}

export async function countUploadSessions(params: {
  accountId?: string;
  fileType?: string;
}): Promise<number> {
  await ensureIndexes();
  const cli = await getClient();
  const col = cli.db(dbName).collection<UploadSession>('upload_sessions');

  const q: Record<string, unknown> = {};
  if (params.accountId) q.accountId = params.accountId;
  if (params.fileType) q.fileType = params.fileType;

  return await col.countDocuments(q);
}

// Active mapping: pick the most recent/active for (accountId, fileType)
export async function getActiveMapping(accountId: string, fileType: string): Promise<MappingDoc | null> {
  await ensureIndexes();
  const cli = await getClient();
  const col = cli.db(dbName).collection<MappingDoc>('mappings');
  return await col.findOne(
    { accountId, fileType },
    { sort: { isActive: -1, updatedAt: -1, version: -1 } }
  );
}

// Simple health check (used by /debug/db)
export async function ping(): Promise<boolean> {
  const cli = await getClient();
  const r = await cli.db(dbName).command({ ping: 1 });
  return r?.ok === 1;
}

// ----- List mappings (for admin UI) -----
export async function listMappings(params: {
  accountId?: string;
  fileType?: string;
  limit?: number;
}): Promise<MappingDoc[]> {
  await ensureIndexes();
  const cli = await getClient();
  const col = cli.db(dbName).collection<MappingDoc>('mappings');

  const q: Record<string, unknown> = {};
  if (params.accountId) q.accountId = params.accountId;
  if (params.fileType) q.fileType = params.fileType;

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  const cursor = col
    .find(q, {
      projection: { accountId: 1, fileType: 1, version: 1, isActive: 1, updatedAt: 1, createdAt: 1 }
    })
    .sort({ accountId: 1, fileType: 1, version: -1 })
    .limit(limit);

  return await cursor.toArray();
}

// ----- Upsert mapping (admin) -----
export async function upsertMapping(doc: {
  accountId: string;
  fileType: string;
  version: number;
  json: Record<string, unknown>;
  isActive?: boolean;
}): Promise<string> {
  await ensureIndexes();
  const cli = await getClient();
  const col = cli.db(dbName).collection<MappingDoc>('mappings');

  const now = new Date().toISOString();
  const filter = { accountId: doc.accountId, fileType: doc.fileType, version: doc.version };
  const update = {
    $set: {
      accountId: doc.accountId,
      fileType: doc.fileType,
      version: doc.version,
      json: doc.json,
      isActive: !!doc.isActive,
      updatedAt: now
    },
    $setOnInsert: { createdAt: now }
  };

  const res = await col.updateOne(filter, update, { upsert: true });

  // If setting active, demote others for the same (accountId,fileType)
  if (doc.isActive) {
    await col.updateMany(
      { accountId: doc.accountId, fileType: doc.fileType, version: { $ne: doc.version } },
      { $set: { isActive: false, updatedAt: now } }
    );
  }

  // Return the id
  if (res.upsertedId) return String(res.upsertedId);
  const existing = await col.findOne(filter, { projection: { _id: 1 } });
  return existing?._id ? String(existing._id) : '';
}
