import { describe, it, expect } from 'vitest';
import { actions } from '../src/routes/upload/+page.server';

// NOTE: +page.server.ts only imports './$types' as `type`, so this import is runtime-safe.

describe('upload page action (preview)', () => {
  it('returns stats for a CSV file', async () => {
    // Build the form as the browser would
    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');

    const csv = 'a,b\n1,2\n3,4\n'; // header + 2 rows => 3 lines total
    const file = new File([csv], 'test.csv', { type: 'text/csv' });
    form.append('files', file);

    const req = new Request('http://local/upload', { method: 'POST', body: form });

    // Call the SvelteKit action directly
    const result = await (actions as any).default({ request: req });

    // Basic shape
    expect(result).toBeTruthy();
    expect(result.preview).toBeTruthy();

    // Top-level preview fields
    expect(result.preview.fileType).toBe('eligibility');
    expect(result.preview.accountId).toBe('clientA');

    // File stats
    const stat = result.preview.stats[0];
    expect(stat.filename).toBe('test.csv');
    expect(stat.mime).toBe('text/csv');
    expect(stat.rowCount).toBe(3);        // includes header
    expect(typeof stat.bytes).toBe('number');
    expect(stat.bytes).toBeGreaterThan(0);
  });

  it('errors when no files are attached', async () => {
    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    const req = new Request('http://local/upload', { method: 'POST', body: form });

    const result = await (actions as any).default({ request: req });

    expect(result.error).toBe('Please attach at least one file.');
  });

  it('errors on invalid mapping JSON (when provided)', async () => {
    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    form.append('useStoredMapping', ''); // unchecked => we will provide mappingJson
    form.append('mappingJson', '{bad json');
    const file = new File(['a,b\n1,2\n'], 'test.csv', { type: 'text/csv' });
    form.append('files', file);
    const req = new Request('http://local/upload', { method: 'POST', body: form });

    const result = await (actions as any).default({ request: req });
    expect(result.error).toBe('Mapping JSON is invalid.');
  });
});
