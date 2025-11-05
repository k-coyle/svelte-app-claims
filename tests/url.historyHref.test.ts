import { describe, it, expect } from 'vitest';
import { buildHistoryHref } from '../src/lib/url';

describe('buildHistoryHref', () => {
  it('includes both filters when present', () => {
    expect(buildHistoryHref('clientA', 'eligibility'))
      .toBe('/upload/history?accountId=clientA&fileType=eligibility');
  });

  it('omits empty params', () => {
    expect(buildHistoryHref('', '')).toBe('/upload/history');
  });

  it('includes pageSize when non-default', () => {
    expect(buildHistoryHref(undefined, 'pharmacy', 20))
      .toBe('/upload/history?fileType=pharmacy&pageSize=20');
  });
});
