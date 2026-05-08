<script lang="ts">
	import { enhance } from '$app/forms';
	import { buildHistoryHref } from '$lib/url';
	import type { SubmitFunction } from '@sveltejs/kit';

	type Account = { id: string; name: string };
	type FileStat = {
		filename: string;
		bytes: number;
		rowCount: number | null;
		mime?: string;
		headers?: string[] | null;
	};
	type Preview = {
		uploaderUserId: string;
		accountId: string;
		fileType: string;
		eligibilityStartDate?: string;
		usedMapping: 'stored' | 'provided' | 'none';
		mappingVersion?: number;
		mappingFieldCount?: number;
		stats: FileStat[];
	};

	export let data: {
		allowedAccounts: Account[];
		defaultAccountId?: string;
		userId: string;
	};

	let files: File[] = [];
	let dragging = false;
	let fileType = 'eligibility';
	let accountId = data.defaultAccountId ?? data.allowedAccounts[0]?.id ?? '';
	let eligibilityStartDate = '';
	let useStoredMapping = false;
	let mappingJson = '';
	let errorMsg = '';
	let successMsg = '';
	let isSubmitting = false;
	let preview: Preview | null = null;

	$: eligibilityEnabled = fileType === 'eligibility';
	$: mappingEnabled = !useStoredMapping;
	$: historyHref = buildHistoryHref(accountId || '', fileType || '', 10);
	$: totalBytes = preview ? preview.stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0) : 0;

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (!e.dataTransfer) return;
		files = Array.from(e.dataTransfer.files);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function onDragLeave() {
		dragging = false;
	}

	function onFilePick(e: Event) {
		const input = e.target as HTMLInputElement;
		files = input.files ? Array.from(input.files) : [];
	}

	function fmtMB(bytes: number) {
		return (Number(bytes) / 1048576).toFixed(2);
	}

	const submitHandler: SubmitFunction = async (opts) => {
		opts.cancel();
		errorMsg = '';
		successMsg = '';
		isSubmitting = true;

		try {
			const res = await fetch(opts.action, {
				method: 'POST',
				body: opts.formData,
				headers: {
					accept: 'application/json',
					'x-sveltekit-action': 'true'
				}
			});

			const payload = await res.json();
			let responseData: any =
				payload && typeof payload === 'object' && 'type' in payload ? payload.data : payload;

			if (typeof responseData === 'string') {
				const { parse } = await import('devalue');
				responseData = parse(responseData);
			}

			if (responseData?.error) {
				errorMsg = responseData.error;
				preview = null;
			} else if (responseData?.preview) {
				preview = responseData.preview;
			} else if (responseData?.confirmed) {
				preview = null;
				successMsg = `Upload confirmed and queued as session ${responseData.sessionId}.`;
			} else {
				errorMsg = 'Unknown server response.';
				preview = null;
			}
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Unexpected upload error.';
			preview = null;
		} finally {
			isSubmitting = false;
		}
	};
</script>

<form method="POST" enctype="multipart/form-data" use:enhance={submitHandler} class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<p class="text-sm font-medium text-muted-foreground">Claims ingestion</p>
			<h1 class="text-2xl font-semibold tracking-tight">Upload files</h1>
		</div>
		<a class="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted" href={historyHref}>
			View history
		</a>
	</div>

	{#if errorMsg}
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			<strong>Error:</strong> {errorMsg}
		</div>
	{/if}

	{#if successMsg}
		<div class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
			{successMsg}
			<a href={historyHref} class="ml-3 font-medium underline">View history</a>
			<a href="/analysis" class="ml-3 font-medium underline">View analysis</a>
		</div>
	{/if}

	<section class="rounded-lg border bg-card p-5 shadow-sm">
		<div class="grid gap-4 md:grid-cols-2">
			<label class="block">
				<span class="text-sm font-medium">Type of file</span>
				<select name="fileType" bind:value={fileType} class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
					<option value="eligibility">Eligibility</option>
					<option value="medical">Medical Claims</option>
					<option value="pharmacy">Pharmacy Claims</option>
					<option value="vision">Vision Claims</option>
					<option value="dental">Dental Claims</option>
				</select>
			</label>

			<label class="block">
				<span class="text-sm font-medium">Account</span>
				<select name="accountId" bind:value={accountId} class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
					{#each data.allowedAccounts as acct}
						<option value={acct.id}>{acct.name}</option>
					{/each}
				</select>
			</label>

			{#if eligibilityEnabled}
				<label class="block md:col-span-2">
					<span class="text-sm font-medium">Eligibility start date</span>
					<input
						type="datetime-local"
						name="eligibilityStartDate"
						bind:value={eligibilityStartDate}
						class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
					/>
				</label>
			{/if}
		</div>

		<div class="mt-4 space-y-3">
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="useStoredMapping" bind:checked={useStoredMapping} class="size-4 rounded border" />
				<span>Require stored mapping for this account and file type</span>
			</label>

			{#if mappingEnabled}
				<label class="block">
					<span class="text-sm font-medium">Mapping JSON (optional)</span>
					<textarea
						name="mappingJson"
						rows="5"
						bind:value={mappingJson}
						class="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
						placeholder={'{"columnA":"canonical.fieldA"}'}
					></textarea>
				</label>
			{/if}
		</div>

		<div
			role="button"
			tabindex="0"
			class={`mt-4 rounded-lg border-2 border-dashed p-6 text-center transition ${
				dragging ? 'border-primary bg-muted' : 'border-border hover:bg-muted/60'
			}`}
			on:dragover={onDragOver}
			on:dragleave={onDragLeave}
			on:drop={onDrop}
			aria-label="Drag and drop files here"
		>
			<p class="font-medium">Drag and drop files here</p>
			<p class="mt-1 text-sm text-muted-foreground">CSV, TSV, TXT, PSV, XLS, or XLSX. Up to 20 files.</p>
			<input
				type="file"
				name="files"
				multiple
				accept=".csv,.tsv,.txt,.psv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				on:change={onFilePick}
				class="mx-auto mt-4 block max-w-md text-sm"
			/>
		</div>

		{#if files.length}
			<ul class="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
				{#each files as f}
					<li class="rounded-md border bg-muted/30 px-3 py-2">{f.name} - {fmtMB(f.size)} MB</li>
				{/each}
			</ul>
		{/if}

		<div class="mt-5 flex flex-wrap gap-2">
			<button
				name="intent"
				value="preview"
				type="submit"
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
				disabled={isSubmitting}
			>
				{isSubmitting ? 'Working...' : 'Preview stats'}
			</button>

			{#if preview}
				<button
					name="intent"
					value="confirm"
					type="submit"
					class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
					disabled={isSubmitting}
				>
					Confirm and queue
				</button>
			{/if}
		</div>
	</section>

	{#if preview}
		<section class="rounded-lg border bg-card p-5 shadow-sm">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 class="text-lg font-semibold">Preview</h2>
					<p class="text-sm text-muted-foreground">
						{preview.stats.length} {preview.stats.length === 1 ? 'file' : 'files'}, {fmtMB(totalBytes)} MB total
					</p>
				</div>
				<div class="rounded-md border bg-muted/40 px-3 py-2 text-sm">
					Mapping: <span class="font-medium">{preview.usedMapping}</span>
					{#if preview.mappingVersion}
						<span class="text-muted-foreground">v{preview.mappingVersion}</span>
					{/if}
				</div>
			</div>

			<div class="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
				<div><span class="text-muted-foreground">Uploader:</span> {preview.uploaderUserId}</div>
				<div><span class="text-muted-foreground">Account:</span> {preview.accountId}</div>
				<div><span class="text-muted-foreground">File type:</span> {preview.fileType}</div>
				{#if preview.eligibilityStartDate}
					<div><span class="text-muted-foreground">Eligibility start:</span> {preview.eligibilityStartDate}</div>
				{/if}
			</div>

			<div class="mt-4 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b text-muted-foreground">
						<tr>
							<th class="py-2 pr-3">File</th>
							<th class="py-2 pr-3">Size</th>
							<th class="py-2 pr-3">Rows</th>
							<th class="py-2 pr-3">MIME</th>
							<th class="py-2 pr-3">Headers</th>
						</tr>
					</thead>
					<tbody>
						{#each preview.stats as stat}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-3 font-medium">{stat.filename}</td>
								<td class="py-3 pr-3">{fmtMB(stat.bytes)} MB</td>
								<td class="py-3 pr-3">{typeof stat.rowCount === 'number' ? stat.rowCount : '-'}</td>
								<td class="py-3 pr-3">{stat.mime ?? 'n/a'}</td>
								<td class="py-3 pr-3">
									{#if stat.headers?.length}
										<span class="text-muted-foreground">{stat.headers.join(', ')}</span>
									{:else}
										-
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</form>
