// src/routes/upload/+page.server.ts
import type { Actions, PageServerLoad } from './$types';
import { insertUploadSession, getActiveMapping } from '$lib/server/db';

// -------------------- Config --------------------
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 20;
const ALLOWED_EXTS = new Set(['.csv', '.tsv', '.txt', '.psv', '.xls', '.xlsx']);
const HEADER_PEEK_MAX = 10;

// -------------------- Mocked auth (replace later) --------------------
type User = { id: string; role: 'client' | 'client_manager'; accountId?: string };
function getUser(): User {
  return { id: 'user_123', role: 'client_manager' };
}
function getAllowedAccounts(user: User) {
  return user.role === 'client'
    ? [{ id: user.accountId!, name: 'My Account' }]
    : [
        { id: 'clientA', name: 'Client A' },
        { id: 'clientB', name: 'Client B' },
        { id: 'clientC', name: 'Client C' }
      ];
}
function canSelectAccount(user: User, accountId: string) {
  return user.role === 'client' ? user.accountId === accountId : true;
}

// -------------------- Helpers: files & parse --------------------
function getExt(name: string): string {
  const m = name.toLowerCase().match(/\.[^.]+$/);
  return m ? m[0] : '';
}
function isTextLike(name: string, mime?: string) {
  const ext = getExt(name);
  return ['.csv', '.tsv', '.txt', '.psv'].includes(ext) || (mime?.startsWith('text/') ?? false);
}
function countLinesFast(buf: Buffer): number {
  return buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}
async function countRowsSmart(name: string, mime: string | undefined, buf: Buffer): Promise<number | null> {
  const ext = getExt(name);
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx'); // lazy load only for Excel
    const wb = XLSX.read(buf, { type: 'buffer' });
    const first = wb.SheetNames[0];
    if (!first) return 0;
    const sheet = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[];
    return rows.length; // includes header if present
  }
  if (isTextLike(name, mime)) return countLinesFast(buf);
  return countLinesFast(buf); // fallback for unknown “flat” files
}
function stripBOM(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function splitHeaderLine(line: string): string[] {
  const l = line.trim();
  const delim = l.includes(',') ? ',' : l.includes('\t') ? '\t' : l.includes('|') ? '|' : ',';
  return l.split(delim).map((t) => {
    let v = t.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  });
}
async function extractHeadersSmart(name: string, mime: string | undefined, buf: Buffer): Promise<string[] | null> {
  const ext = getExt(name);
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const first = wb.SheetNames[0];
    if (!first) return null;
    const sheet = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown as any[][];
    const hdr = Array.isArray(rows?.[0]) ? rows[0] : null;
    return hdr ? hdr.slice(0, HEADER_PEEK_MAX).map((x) => (x == null ? '' : String(x).trim())) : null;
  }
  // text-like
  const text = stripBOM(buf.toString('utf8'));
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  return splitHeaderLine(lines[0]).slice(0, HEADER_PEEK_MAX);
}
function validateAllowedFiles(files: { name: string }[]): string | null {
  const bad: string[] = [];
  for (const f of files) {
    const ext = getExt(f.name);
    if (!ALLOWED_EXTS.has(ext)) bad.push(f.name);
  }
  if (files.length > MAX_FILES) return `Too many files. Maximum allowed is ${MAX_FILES}.`;
  if (bad.length) {
    return `These file types are not allowed: ${bad.join(', ')}. Allowed: ${Array.from(ALLOWED_EXTS).join(', ')}`;
  }
  return null;
}
async function readFilesFromForm(form: FormData) {
  const list = form.getAll('files');
  const out: { name: string; type?: string; buf: Buffer }[] = [];
  let total = 0;
  for (const item of list) {
    if (!(item instanceof File)) continue;
    const ab = await item.arrayBuffer();
    const buf = Buffer.from(ab);
    total += buf.byteLength;
    if (total > MAX_UPLOAD_BYTES) throw new Error('Total upload too large (200MB limit).');
    out.push({ name: item.name, type: item.type, buf });
  }
  return out;
}

// -------------------- Audit --------------------
function auditLog(event: string, payload: Record<string, unknown>) {
  try {
    console.info(JSON.stringify({ ts: new Date().toISOString(), event, ...payload }));
  } catch {
    console.info(`[audit] ${event}`);
  }
}

// -------------------- Load --------------------
export const load: PageServerLoad = async () => {
  const user = getUser();
  const allowedAccounts = getAllowedAccounts(user);
  return {
    allowedAccounts,
    defaultAccountId: user.role === 'client' ? user.accountId : allowedAccounts[0]?.id,
    userId: user.id
  };
};

// -------------------- Actions --------------------
async function safeGetActiveMapping(accountId: string, fileType: string) {
  try {
    return await getActiveMapping(accountId, fileType);
  } catch (e) {
    // Don’t break preview on DB hiccups (tests/dev)
    console.warn('mapping lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export const actions: Actions = {
  default: async (evt) => {
    try {
      const request = (evt as any).request as Request;
      const getClientAddress = (evt as any).getClientAddress as (() => string) | undefined;
      const ip = typeof getClientAddress === 'function' ? getClientAddress() : undefined;

      const form = await request.formData();
      const user = getUser();

      // --- fields ---
      const intent = String(form.get('intent') ?? 'preview');
      const fileType = String(form.get('fileType') ?? '');
      const accountId = String(form.get('accountId') ?? '');
      const useStoredMapping = form.get('useStoredMapping') === 'on';
      const mappingJson = (form.get('mappingJson') as string) || '';
      const eligibilityStartDateRaw = form.get('eligibilityStartDate') as string | null;

      if (!fileType) return { error: 'File type is required.' };
      if (!accountId) return { error: 'Account is required.' };
      if (!canSelectAccount(user, accountId)) return { error: 'Not allowed for this account.' };

      // --- files & validation ---
      const files = await readFilesFromForm(form);
      if (!files.length) return { error: 'Please attach at least one file.' };

      {
      const validationError = validateAllowedFiles(files);
      if (validationError) return { error: validationError };
     }

      // --- eligibility date (if provided) ---
      let eligibilityStartDate: string | undefined;
      if (fileType === 'eligibility' && eligibilityStartDateRaw) {
        const d = new Date(eligibilityStartDateRaw);
        if (isNaN(d.getTime())) return { error: 'Invalid eligibility start date.' };
        eligibilityStartDate = d.toISOString();
      }

      // --- resolve mapping: stored / provided / none ---
      let mappingSource: 'stored' | 'provided' | 'none' = 'none';
      let mappingVersion: number | undefined;
      let mappingPayload: Record<string, unknown> | undefined;

      if (useStoredMapping) {
        const m = await safeGetActiveMapping(accountId, fileType);
        if (!m) return { error: 'No stored mapping found for this account & file type.' };
        mappingSource = 'stored';
        mappingVersion = m.version;
        mappingPayload = m.json;
        } else if (mappingJson.trim()) {
        try {
            mappingPayload = JSON.parse(mappingJson);
            mappingSource = 'provided';
        } catch {
            return { error: 'Mapping JSON is invalid.' };
        }
        } else {
        // Fallback to stored if available, but don’t hard-fail if DB has issues
        const m = await safeGetActiveMapping(accountId, fileType);
        if (m) {
            mappingSource = 'stored';
            mappingVersion = m.version;
            mappingPayload = m.json;
        } else {
            mappingSource = 'none';
        }
      }


      // --- stats (rows + headers) ---
      const stats = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          bytes: f.buf.byteLength,
          rowCount: await countRowsSmart(f.name, f.type, f.buf),
          mime: f.type,
          headers: await extractHeadersSmart(f.name, f.type, f.buf)
        }))
      );
      const totalBytes = stats.reduce((n, s) => n + Number(s.bytes ?? 0), 0);

      if (intent === 'preview') {
        // Audit preview
        auditLog('upload.preview', {
          uploaderUserId: user.id,
          accountId,
          fileType,
          ip,
          files: stats.map((s) => ({ filename: s.filename, bytes: s.bytes, mime: s.mime })),
          totalBytes
        });

        return {
          preview: {
            uploaderUserId: user.id,
            accountId,
            fileType,
            eligibilityStartDate,
            usedMapping: mappingSource,
            mappingVersion,
            mappingFieldCount: mappingPayload ? Object.keys(mappingPayload).length : undefined,
            stats
          }
        };
      }

      if (intent === 'confirm') {
        // Audit confirm
        auditLog('upload.confirm', {
          uploaderUserId: user.id,
          accountId,
          fileType,
          ip,
          files: stats.map((s) => ({ filename: s.filename, bytes: s.bytes, mime: s.mime })),
          totalBytes
        });

        // Persist metadata only (no file bodies)
        const sessionId = await insertUploadSession({
          uploaderUserId: user.id,
          accountId,
          fileType,
          eligibilityStartDate,
          usedMapping: mappingSource,
          mappingVersion,
          stats,
          createdAt: new Date().toISOString(),
          totalBytes,
          audit: { confirmAt: new Date().toISOString() }
        });

        return { confirmed: true, sessionId };
      }

      return { error: 'Unknown intent.' };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unexpected error';
      console.error('Upload error:', e);
      return { error: msg };
    }
  }
};
