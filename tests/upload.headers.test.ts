import { describe, it, expect } from 'vitest';
import { actions } from '../src/routes/upload/+page.server';

describe('header peek (CSV & XLSX)', () => {
  it('extracts CSV headers (top 10)', async () => {
    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    const csv = 'colA,colB,colC\n1,2,3\n';
    const file = new File([csv], 'hdr.csv', { type: 'text/csv' });
    form.append('files', file);

    const req = new Request('http://local/upload', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });

    expect(res.preview).toBeTruthy();
    const s = res.preview.stats[0];
    expect(s.headers).toEqual(['colA', 'colB', 'colC']);
  });

  it('extracts XLSX headers (top 10)', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['A','B','C'], ['1','2','3']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const form = new FormData();
    form.append('intent', 'preview');
    form.append('fileType', 'eligibility');
    form.append('accountId', 'clientA');
    const body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const file = new File([body], 'hdr.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    form.append('files', file);

    const req = new Request('http://local/upload', { method: 'POST', body: form });
    const res = await (actions as any).default({ request: req });

    expect(res.preview).toBeTruthy();
    const s = res.preview.stats[0];
    expect(s.headers).toEqual(['A', 'B', 'C']);
  });
});
