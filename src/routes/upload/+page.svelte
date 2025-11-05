<script lang="ts">
  import { buildHistoryHref } from '$lib/url';
  import { enhance } from '$app/forms';
  import { parse as devalueParse } from 'devalue'; // ✅ official parser
  function inflateKitActionData(str) {
    // SvelteKit encodes action data as a de-duplicated array; values point by index.
    // Example: ["{preview:1}",{...},"user_123", ...]
    const arr = JSON.parse(str);
    const seen = new WeakMap();
    function resolve(v) {
        if (typeof v === 'number') {
        if (v === -1) return undefined; // sentinel used by Kit for undefined
        return resolve(arr[v]);
        }
        if (Array.isArray(v)) return v.map(resolve);
        if (v && typeof v === 'object') {
        if (seen.has(v)) return seen.get(v);
        const out = {};
        seen.set(v, out);
        for (const k in v) out[k] = resolve(v[k]);
        return out;
        }
        return v;
    }
    return resolve(arr[0]);
    }


  // Mocked auth + allowed accounts will be provided by load()
  export let data: {
    allowedAccounts: { id: string; name: string }[];
    defaultAccountId?: string;
    userId: string;
  };
  $: totalBytes = preview ? preview.stats.reduce((sum, s) => sum + Number(s.bytes ?? 0), 0) : 0;
  let files: File[] = [];
  let dragging = false;

  let fileType = 'eligibility';
  let accountId = data.defaultAccountId ?? (data.allowedAccounts[0]?.id ?? '');
  let eligibilityStartDate = ''; // datetime-local value
  let useStoredMapping = true;
  let mappingJson = '';

  let errorMsg = '';
  let successMsg = '';
  let isSubmitting = false;

  let preview: null | {
    uploaderUserId: string;
    accountId: string;
    fileType: string;
    eligibilityStartDate?: string;
    usedMapping: 'stored' | 'provided' | 'none';
    stats: { filename: string; bytes: number; rowCount: number | null; mime?: string }[];
  } = null;

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (!e.dataTransfer) return;
    files = Array.from(e.dataTransfer.files);
  }
  function onDragOver(e: DragEvent) { e.preventDefault(); dragging = true; }
  function onDragLeave() { dragging = false; }
  function onFilePick(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) files = Array.from(input.files);
  }

  $: eligibilityEnabled = fileType === 'eligibility';
  $: mappingEnabled = !useStoredMapping;
  $: historyHref = buildHistoryHref(accountId || '', fileType || '', 10);
</script>

<form
  method="POST"
  enctype="multipart/form-data"
  use:enhance={async (opts) => {
    const formData = (opts as any).formData ?? (opts as any).data;
    const action = (opts as any).action;
    opts.cancel?.();

    // reset messages, set loading
    errorMsg = '';
    successMsg = '';
    isSubmitting = true;

    try {
        const res = await fetch(action, {
        method: 'POST',
        body: formData,
        headers: {
            accept: 'application/json',
            'x-sveltekit-action': 'true'
        }
        });

        let payload: any;
        try {
        payload = await res.json();
        } catch {
        errorMsg = 'Unexpected server response (not JSON).';
        preview = null;
        return;
        }

        // unwrap SvelteKit envelope
        let data: any = (payload && typeof payload === 'object' && 'type' in payload) ? payload.data : payload;

        // devalue string → object
        if (typeof data === 'string') {
        const { parse: devalueParse } = await import('devalue');
        try { data = devalueParse(data); }
        catch {
            errorMsg = 'Failed to decode action data.';
            preview = null;
            return;
        }
        }

        if (data?.error) {
        errorMsg = data.error;
        preview = null;
        return;
        }
        if (data?.preview) {
        preview = data.preview;
        errorMsg = '';
        return;
        }
        if (data?.confirmed) {
        preview = null;
        errorMsg = '';
        successMsg = 'Upload confirmed and queued for ETL (stub).';
        // Optional: clear selected files shown under dropzone
        // files = [];
        return;
        }

        errorMsg = 'Unknown server response.';
        preview = null;
    } finally {
        isSubmitting = false;
    }
    }}




  class="mx-auto max-w-3xl p-4"
>
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-xl font-semibold">Upload Claims / Eligibility Files</h1>
    <a href={historyHref}
      class="rounded border px-3 py-2 text-sm hover:bg-gray-50"
      aria-label="View upload history">
      View history
    </a>
  </div>

  {#if errorMsg}
    <div role="alert" aria-live="polite"
        class="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <strong class="mr-1">Error:</strong> {errorMsg}
    </div>
  {/if}

  {#if successMsg}
    <div role="status" aria-live="polite"
        class="mb-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      {successMsg}
      <a href={historyHref} class="ml-3 underline">View history</a>
    </div>
  {/if}


  <div class="grid gap-4">
    <label class="block">
      <span class="block text-sm font-medium">Type of file</span>
      <select name="fileType" bind:value={fileType} class="mt-1 block w-full rounded border p-2">
        <option value="eligibility">Eligibility</option>
        <option value="medical">Medical Claims</option>
        <option value="pharmacy">Pharmacy Claims</option>
        <option value="vision">Vision Claims</option>
        <option value="dental">Dental Claims</option>
      </select>
    </label>

    <label class="block">
      <span class="block text-sm font-medium">Account</span>
      <select name="accountId" bind:value={accountId} class="mt-1 block w-full rounded border p-2">
        {#each data.allowedAccounts as acct}
          <option value={acct.id}>{acct.name}</option>
        {/each}
      </select>
    </label>

    {#if eligibilityEnabled}
      <label class="block">
        <span class="block text-sm font-medium">Eligibility start date</span>
        <input type="datetime-local" name="eligibilityStartDate" bind:value={eligibilityStartDate}
               class="mt-1 block w-full rounded border p-2" />
      </label>
    {/if}

    <label class="flex items-center gap-2">
      <input type="checkbox" name="useStoredMapping" bind:checked={useStoredMapping} class="h-4 w-4" />
      <span class="text-sm">Use stored mapping for this account & file type</span>
    </label>

    {#if mappingEnabled}
      <label class="block">
        <span class="block text-sm font-medium">Provide mapping JSON (optional)</span>
        <textarea>
            name="mappingJson"
            rows="6"
            bind:value={mappingJson}
            class="mt-1 block w-full rounded border p-2"
            placeholder="&#123;&quot;columnA&quot;:&quot;canonical.fieldA&quot;&#125;"
            </textarea>
      </label>
    {/if}

    <div
        role="button"
        tabindex="0"
        class="rounded border-2 border-dashed border-gray-300 p-6 text-center transition hover:bg-gray-50"
        class:bg-gray-100={dragging}
        on:dragover={onDragOver}
        on:dragleave={onDragLeave}
        on:drop={onDrop}
        aria-label="Drag and drop files here"
    >

      <p class="mb-2">Drag & drop files here</p>
      <p class="mb-2 text-sm text-gray-600">or</p>
      <input
        type="file"
        name="files"
        multiple
        accept=".csv,.tsv,.txt,.psv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        on:change={onFilePick}
        class="block w-full text-sm"
      />

    </div>

    {#if files.length}
      <ul class="list-disc pl-5 text-sm text-gray-700">
        {#each files as f}
          <li>{f.name} — {(f.size/1024/1024).toFixed(2)} MB</li>
        {/each}
      </ul>
    {/if}

    <div class="flex gap-2">
        <button
            name="intent"
            value="preview"
            type="submit"
            class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={isSubmitting}
        >
            {#if isSubmitting}<span class="mr-2 inline-block h-4 w-4 animate-spin border-2 border-white border-t-transparent rounded-full"></span>{/if}
            Preview stats
        </button>

        {#if preview}
            <button
            name="intent"
            value="confirm"
            type="submit"
            class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-60"
            disabled={isSubmitting}
            >
            {#if isSubmitting}<span class="mr-2 inline-block h-4 w-4 animate-spin border-2 border-white border-t-transparent rounded-full"></span>{/if}
            Confirm & queue
            </button>
        {/if}
            </div>


        {#if preview}
        <div class="mt-4 rounded border p-4">
            <h2 class="text-lg font-semibold mb-2">Preview</h2>
            <div class="mb-2 text-sm text-gray-700">
              <span class="font-medium">{preview.stats.length}</span> {preview.stats.length === 1 ? 'file' : 'files'},total <span class="font-medium">{(totalBytes / 1048576).toFixed(2)} MB</span>.
            </div>

            <div class="text-sm mb-2">
            <div><span class="font-medium">Uploader:</span> {preview.uploaderUserId}</div>
            <div><span class="font-medium">Account:</span> {preview.accountId}</div>
            <div><span class="font-medium">File Type:</span> {preview.fileType}</div>
            {#if preview.eligibilityStartDate}
                <div><span class="font-medium">Eligibility Start:</span> {preview.eligibilityStartDate}</div>
            {/if}
            <div><span class="font-medium">Mapping:</span> {preview.usedMapping}</div>
            </div>

            <div class="overflow-x-auto mt-2">
                <table class="w-full table-auto text-sm md:text-base">
                    <thead class="border-b">
                    <tr class="text-center">
                        <th class="py-3 px-3">File</th>
                        <th class="py-3 px-3">Size (MB)</th>
                        <th class="py-3 px-3">Rows</th>
                        <th class="py-3 px-3">MIME</th>
                        <th class="py-3 px-3">Headers (top 10)</th>
                    </tr>
                    </thead>
                    <tbody>
                    {#each preview.stats as s}
                        <tr class="border-b border-gray-200 last:border-0 text-center">
                        <td class="py-3 px-3">{s.filename}</td>
                        <td class="py-3 px-3">{(Number(s.bytes) / 1048576).toFixed(2)}</td>
                        <td class="py-3 px-3">
                            {typeof s.rowCount === 'number' ? s.rowCount : (s.rowCount === null ? '—' : String(s.rowCount))}
                        </td>
                        <td class="py-3 px-3">{s.mime ?? 'n/a'}</td>
                        <td class="py-3 px-3">
                            {#if Array.isArray(s.headers) && s.headers.length}
                            <!-- Join with newlines and preserve them -->
                            <div class="whitespace-pre-wrap leading-6">
                                {s.headers.join('\n')}
                            </div>
                            {:else}
                            —
                            {/if}
                        </td>
                        </tr>
                    {/each}
                    </tbody>
                </table>
            </div>
        </div>
        {/if}

        {#if errorMsg}
        <p class="text-sm text-red-700">{errorMsg}</p>
        {/if}
    </div>

  <!-- hidden mirrors for non-JS submit -->
  <input type="hidden" name="__mirror_fileType" value={fileType} />
  <input type="hidden" name="__mirror_accountId" value={accountId} />
  <input type="hidden" name="__mirror_useStoredMapping" value={useStoredMapping ? 'on' : ''} />
  <input type="hidden" name="__mirror_eligibilityStartDate" value={eligibilityStartDate} />
  <input type="hidden" name="__mirror_mappingJson" value={mappingJson} />
</form>
