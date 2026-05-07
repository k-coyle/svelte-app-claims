import { describe, it, expect } from 'vitest';
import { actions } from '../src/routes/upload/+page.server';

async function makeXlsxBuffer(rows: string[][]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('upload action - xlsx preview', () => {
  it('counts rows (including header) for .xlsx', async () => {
    const buf = await makeXlsxBuffer([['a','b'], ['1','2'], ['3','4']]); // 3 rows total
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const file = new File([body], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    form.append('files', file);

    const req = new Request('http://local/upload', { method: 'POST', body: form });
    const result = await (actions as any).default({ request: req });

    expect(result.preview).toBeTruthy();
    const stat = result.preview.stats[0];
    expect(stat.filename).toBe('test.xlsx');
    expect(stat.rowCount).toBe(3);
    expect(stat.bytes).toBeGreaterThan(0);
  });
});
