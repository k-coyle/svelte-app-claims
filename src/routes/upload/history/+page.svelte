<script lang="ts">
  export let data;
  const { filters, paging, allowedAccounts, rows } = data;

  function fmtMB(bytes: number) {
    return (Number(bytes) / 1048576).toFixed(2);
  }

  function toQuery(nextPage: number) {
    const params = new URLSearchParams();
    if (filters.accountId) params.set('accountId', filters.accountId);
    if (filters.fileType) params.set('fileType', filters.fileType);
    params.set('page', String(nextPage));
    params.set('pageSize', String(paging.pageSize));
    return `?${params.toString()}`;
  }
</script>

<h1 class="text-xl font-semibold mb-4">Upload History</h1>

<form method="GET" class="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
  <label class="block">
    <span class="block text-sm text-gray-700">Account</span>
    <select name="accountId" class="mt-1 block w-full rounded border p-2">
      <option value="">All</option>
      {#each allowedAccounts as a}
        <option value={a.id} selected={filters.accountId === a.id}>{a.name}</option>
      {/each}
    </select>
  </label>

  <label class="block">
    <span class="block text-sm text-gray-700">File Type</span>
    <select name="fileType" class="mt-1 block w-full rounded border p-2">
      <option value="">All</option>
      <option value="eligibility" selected={filters.fileType === 'eligibility'}>Eligibility</option>
      <option value="medical" selected={filters.fileType === 'medical'}>Medical Claims</option>
      <option value="pharmacy" selected={filters.fileType === 'pharmacy'}>Pharmacy Claims</option>
      <option value="vision" selected={filters.fileType === 'vision'}>Vision Claims</option>
      <option value="dental" selected={filters.fileType === 'dental'}>Dental Claims</option>
    </select>
  </label>

  <label class="block">
    <span class="block text-sm text-gray-700">Page Size</span>
    <select name="pageSize" class="mt-1 block w-full rounded border p-2">
      {#each [10,20,50,100] as s}
        <option value={s} selected={paging.pageSize === s}>{s}</option>
      {/each}
    </select>
  </label>

  <button type="submit" class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
    Apply
  </button>
</form>

{#if rows.length === 0}
  <div class="rounded border border-gray-200 bg-gray-50 p-4 text-gray-700">
    No uploads found for the selected filters.
  </div>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full table-auto text-sm md:text-base">
      <thead class="border-b">
        <tr class="text-center">
          <th class="py-3 px-3">Created</th>
          <th class="py-3 px-3">Account</th>
          <th class="py-3 px-3">File Type</th>
          <th class="py-3 px-3">Uploader</th>
          <th class="py-3 px-3">Files</th>
          <th class="py-3 px-3">Total (MB)</th>
          <th class="py-3 px-3">First File</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r}
          <tr class="border-b border-gray-200 last:border-0 text-center">
            <td class="py-3 px-3">{new Date(r.createdAt).toLocaleString()}</td>
            <td class="py-3 px-3">{r.accountId}</td>
            <td class="py-3 px-3">{r.fileType}</td>
            <td class="py-3 px-3">{r.uploaderUserId}</td>
            <td class="py-3 px-3">{Array.isArray(r.stats) ? r.stats.length : 0}</td>
            <td class="py-3 px-3">{fmtMB(r.totalBytes)}</td>
            <td class="py-3 px-3">
              {#if r.stats && r.stats[0]}
                {r.stats[0].filename}
              {:else} —
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="mt-4 flex items-center justify-between">
    <div class="text-sm text-gray-600">
      Page <span class="font-medium">{paging.page}</span> of <span class="font-medium">{paging.pages}</span> —
      <span class="font-medium">{paging.total}</span> total uploads
    </div>
    <div class="flex gap-2">
      <a class="rounded border px-3 py-2 hover:bg-gray-50 {paging.page <= 1 ? 'pointer-events-none opacity-50' : ''}"
         href={toQuery(Math.max(1, paging.page - 1))}>Previous</a>
      <a class="rounded border px-3 py-2 hover:bg-gray-50 {paging.page >= paging.pages ? 'pointer-events-none opacity-50' : ''}"
         href={toQuery(Math.min(paging.pages, paging.page + 1))}>Next</a>
    </div>
  </div>
{/if}
