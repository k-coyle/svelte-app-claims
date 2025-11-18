// scripts/worker.mjs
import { MongoClient, ObjectId } from 'mongodb';
import { spawn } from 'node:child_process';

const ETL_ROOT  = process.env.LEGACY_ETL_ROOT || '../claims-analysis';
const PY_BIN    = process.env.PYTHON_BIN || 'python';      // set to 'py' on Windows if needed
const PY_ENTRY  = process.env.PYTHON_ENTRY || 'stream_cleaner.py'; // legacy script name

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error('Missing MONGODB_URI / MONGODB_DB'); process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
const POLL_MS = 2000;

async function claimJob(db) {
  const res = await db.collection('jobs').findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'processing', updatedAt: new Date().toISOString() } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
  return res.value;
}

function deriveYear(job) {
  const iso = job.eligibilityStartDate;
  if (typeof iso === 'string' && iso.length >= 4) return Number(iso.slice(0, 4));
  return new Date().getFullYear();
}

async function processEligibilityJob(db, job) {
  // inside processEligibilityJob(db, job)
const opts = {
  reader_type: 'eligibility',
  file_paths: job.files.map((f) => f.path),
  chunk_size: 100000,
  rename_map: job.mapping?.fields ?? null, // <— mapping JSON: { source_col: canonical_col }
  clean_args: {
    year: (() => {
      const iso = job.eligibilityStartDate;
      return (typeof iso === 'string' && iso.length >= 4) ? Number(iso.slice(0,4)) : new Date().getFullYear();
    })(),
    start_col: 'medical_eligibility_start_date',
    end_col: 'medical_eligibility_end_date',
    id_col: 'member_id',
    relationship_col: 'member_relationship',
    fill_missing_end_date: true,
    filter_relationship: ['SELF'],
    monthly_columns: true,
    drop_duplicates: true,
    duplicate_subset: null,
    as_of_col: null,
    expand_prior_months: 0
  }
  };
  child.stdin.write(JSON.stringify(opts) + '\n');
  const child = spawn(PY_BIN, [PY_SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: process.cwd() },
    stdio: ['pipe', 'pipe', 'inherit'] // stdin, stdout, stderr→inherit
  });

  // Send options JSON as the first line
  child.stdin.write(JSON.stringify(opts) + '\n');
  child.stdin.end();

  const col = db.collection('records_eligibility');
  let buffer = '';
  let batch = [];
  let total = 0;

  async function flush() {
    if (batch.length) {
      await col.insertMany(batch, { ordered: false });
      total += batch.length;
      batch = [];
    }
  }

  await new Promise((resolve, reject) => {
    child.stdout.on('data', async (data) => {
      buffer += data.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          obj._sessionId  = job.sessionId;
          obj._source     = 'eligibility';
          obj._ingestedAt = new Date().toISOString();
          batch.push(obj);
          if (batch.length >= 1000) await flush();
        } catch (e) {
          reject(new Error('Bad JSON from Python: ' + e.message));
          return;
        }
      }
    });
    child.on('close', async (code) => {
      try {
        await flush();
        if (code !== 0) return reject(new Error('Python exited ' + code));
        await db.collection('jobs').updateOne(
          { _id: new ObjectId(job._id) },
          { $set: { status: 'done', 'stats.processedRows': total, updatedAt: new Date().toISOString() } }
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  await client.connect();
  const db = client.db(dbName);
  console.log('[worker] connected');

  // simple single-consumer loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await claimJob(db);
      if (!job) { await new Promise((r) => setTimeout(r, POLL_MS)); continue; }
      if (job.fileType !== 'eligibility') {
        // mark unsupported (for now)
        await db.collection('jobs').updateOne(
          { _id: new ObjectId(job._id) },
          { $set: { status: 'error', error: `Unsupported fileType ${job.fileType} in MVP`, updatedAt: new Date().toISOString() } }
        );
        continue;
      }
      await processEligibilityJob(db, job);
    } catch (e) {
      console.error('[worker] error', e?.message || e);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
