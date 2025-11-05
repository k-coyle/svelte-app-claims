// src/lib/url.ts
export function buildHistoryHref(
  accountId?: string,
  fileType?: string,
  pageSize = 10,
  page = 1
): string {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  if (fileType) params.set('fileType', fileType);
  if (page !== 1) params.set('page', String(page));           // omit default
  if (pageSize !== 10) params.set('pageSize', String(pageSize));
  const qs = params.toString();
  return `/upload/history${qs ? `?${qs}` : ''}`;
}
