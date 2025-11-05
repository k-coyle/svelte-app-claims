import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'fhir';

if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const r = await client.db(dbName).command({ ping: 1 });
  console.log('ping ok:', r);
} catch (e) {
  console.error('ping error:', e);
  process.exit(1);
} finally {
  await client.close();
}
