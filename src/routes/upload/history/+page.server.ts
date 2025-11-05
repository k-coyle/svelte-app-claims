// src/routes/upload/history/+page.server.ts
import type { PageServerLoad } from './$types';
import { listUploadSessions, countUploadSessions } from '$lib/server/db';

// Mock RBAC (same as upload route). Replace with your real auth later.
type User = { id: string; role: 'client' | 'client_manager'; accountId?: string };
function getUser(): User { return { id: 'user_123', role: 'client_manager' }; }
function getAllowedAccounts(user: User) {
  return user.role === 'client'
    ? [{ id: user.accountId!, name: 'My Account' }]
    : [
        { id: 'clientA', name: 'Client A' },
        { id: 'clientB', name: 'Client B' },
        { id: 'clientC', name: 'Client C' }
      ];
}

export const load: PageServerLoad = async ({ url }) => {
  const user = getUser();
  const allowedAccounts = getAllowedAccounts(user);

  const accountId = url.searchParams.get('accountId') ?? '';
  const fileType = url.searchParams.get('fileType') ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '10')));

  // If user is a client, force their accountId
  const effectiveAccountId =
    user.role === 'client' ? user.accountId ?? '' : accountId;

  const [rows, total] = await Promise.all([
    listUploadSessions({
      accountId: effectiveAccountId || undefined,
      fileType: fileType || undefined,
      page,
      pageSize,
      sort: 'newest'
    }),
    countUploadSessions({
      accountId: effectiveAccountId || undefined,
      fileType: fileType || undefined
    })
  ]);

  return {
    filters: {
      accountId: effectiveAccountId,
      fileType
    },
    paging: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize))
    },
    allowedAccounts,
    rows
  };
};
