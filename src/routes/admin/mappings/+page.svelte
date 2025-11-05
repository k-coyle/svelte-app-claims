<script lang="ts">
  export let data;
  let errorMsg = '';
  let successMsg = '';
</script>

<h1 class="text-xl font-semibold mb-4">Admin • Mappings</h1>

{#if data?.error}
  <div class="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
    {data.error}
  </div>
{/if}

<form method="POST" class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
  <label class="block">
    <span class="block text-sm text-gray-700">Account ID</span>
    <input name="accountId" class="mt-1 block w-full rounded border p-2" placeholder="clientA" required />
  </label>

  <label class="block">
    <span class="block text-sm text-gray-700">File Type</span>
    <select name="fileType" class="mt-1 block w-full rounded border p-2" required>
      <option value="eligibility">Eligibility</option>
      <option value="medical">Medical Claims</option>
      <option value="pharmacy">Pharmacy Claims</option>
      <option value="vision">Vision Claims</option>
      <option value="dental">Dental Claims</option>
    </select>
  </label>

  <label class="block">
    <span class="block text-sm text-gray-700">Version</span>
    <input name="version" type="number" min="1" step="1" class="mt-1 block w-full rounded border p-2" required />
  </label>

  <label class="block md:col-span-2">
    <span class="block text-sm text-gray-700">Mapping JSON</span>
    <textarea name="json" rows="4" class="mt-1 block w-full rounded border p-2" placeholder={'{"columnA":"canonical.fieldA"}'} required></textarea>

  </label>

  <label class="inline-flex items-center gap-2">
    <input type="checkbox" name="isActive" />
    <span>Set as active for this (accountId, fileType)</span>
  </label>

  <button type="submit" class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">Upsert</button>
</form>

{#if successMsg}
  <div class="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{successMsg}</div>
{/if}
{#if errorMsg}
  <div class="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{errorMsg}</div>
{/if}

<!-- Filters for listing -->
<form method="GET" class="mb-3 flex flex-wrap items-end gap-3">
  <label class="block">
    <span class="block text-sm text-gray-700">Account</span>
    <input name="accountId" value={data?.filters?.accountId || ''} class="mt-1 block rounded border p-2" />
  </label>
  <label class="block">
    <span class="block text-sm text-gray-700">File Type</span>
    <select name="fileType" class="mt-1 block rounded border p-2">
      <option value="" selected={!data?.filters?.fileType}>All</option>
      <option value="eligibility" selected={data?.filters?.fileType === 'eligibility'}>Eligibility</option>
      <option value="medical" selected={data?.filters?.fileType === 'medical'}>Medical</option>
      <option value="pharmacy" selected={data?.filters?.fileType === 'pharmacy'}>Pharmacy</option>
      <option value="vision" selected={data?.filters?.fileType === 'vision'}>Vision</option>
      <option value="dental" selected={data?.filters?.fileType === 'dental'}>Dental</option>
    </select>
  </label>
  <button class="rounded border px-3 py-2 hover:bg-gray-50">Apply</button>
</form>

<div class="overflow-x-auto">
  <table class="w-full table-auto text-sm md:text-base">
    <thead class="border-b">
      <tr class="text-center">
        <th class="py-3 px-3">Account</th>
        <th class="py-3 px-3">File Type</th>
        <th class="py-3 px-3">Version</th>
        <th class="py-3 px-3">Active</th>
        <th class="py-3 px-3">Updated</th>
        <th class="py-3 px-3">Created</th>
      </tr>
    </thead>
    <tbody>
      {#each data?.rows || [] as r}
        <tr class="border-b border-gray-200 last:border-0 text-center">
          <td class="py-3 px-3">{r.accountId}</td>
          <td class="py-3 px-3">{r.fileType}</td>
          <td class="py-3 px-3">{r.version}</td>
          <td class="py-3 px-3">{r.isActive ? 'Yes' : 'No'}</td>
          <td class="py-3 px-3">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
          <td class="py-3 px-3">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
