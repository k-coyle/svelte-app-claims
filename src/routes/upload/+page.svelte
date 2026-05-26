<script lang="ts">
	import { enhance } from '$app/forms';
	import { buildHistoryHref } from '$lib/url';
	import type { SubmitFunction } from '@sveltejs/kit';

	type Account = { id: string; name: string };
	type FileType = 'eligibility' | 'medical' | 'pharmacy';
	type MappingMode = 'stored' | 'provided' | 'canonical';
	type FileStat = {
		filename: string;
		bytes: number;
		rowCount: number | null;
		mime?: string;
		headers?: string[] | null;
	};
	type FilePreview = FileStat & {
		fileId: string;
		fileType: FileType;
		inferredFileType: FileType;
		mapping: {
			source: 'stored' | 'provided' | 'canonical' | 'none';
			mode: string;
			version?: number;
			fieldCount?: number;
		};
		validation: {
			status: 'ok' | 'warning' | 'blocking';
			blockingWarnings: string[];
			qualityWarnings: string[];
			requiredCoverage: Record<string, { status: string; fields: string[] }>;
		};
	};
	type Preview = {
		uploaderUserId: string;
		accountId: string;
		fileType: string;
		fileTypes: FileType[];
		usedMapping: 'stored' | 'provided' | 'canonical' | 'none';
		mappingVersion?: number;
		mappingFieldCount?: number;
		stats: FileStat[];
		files: FilePreview[];
		validation: {
			productionReady: boolean;
			warnings: Array<{ severity: string; message: string; filename?: string }>;
			session: {
				eligibilityPresent: boolean;
				medicalPresent: boolean;
				pharmacyPresent: boolean;
				claimMembersEligibleAssumptionAccepted: boolean;
			};
		};
	};
	type FileConfig = {
		fileType: FileType;
		mappingMode: MappingMode;
		mappingJson: string;
	};

	export let data: {
		allowedAccounts: Account[];
		defaultAccountId?: string;
		userId: string;
	};

	let files: File[] = [];
	let fileConfigs: FileConfig[] = [];
	let dragging = false;
	let accountId = data.defaultAccountId ?? data.allowedAccounts[0]?.id ?? '';
	let assumeClaimMembersEligible = false;
	let errorMsg = '';
	let successMsg = '';
	let isSubmitting = false;
	let preview: Preview | null = null;

	$: historyHref = buildHistoryHref(accountId || '', '', 10);
	$: totalBytes = preview ? preview.stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0) : 0;
	$: hasEligibilitySelection = fileConfigs.some((config) => config.fileType === 'eligibility');

	function inferFileType(file: File): FileType {
		const name = file.name.toLowerCase();
		if (name.includes('elig')) return 'eligibility';
		if (name.includes('pharm') || name.includes('rx')) return 'pharmacy';
		return 'medical';
	}

	function setFiles(nextFiles: File[]) {
		files = nextFiles;
		fileConfigs = files.map((file, index) => ({
			fileType: fileConfigs[index]?.fileType ?? inferFileType(file),
			mappingMode: fileConfigs[index]?.mappingMode ?? 'stored',
			mappingJson: fileConfigs[index]?.mappingJson ?? ''
		}));
		preview = null;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (!e.dataTransfer) return;
		setFiles(Array.from(e.dataTransfer.files));
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
		setFiles(input.files ? Array.from(input.files) : []);
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
			opts.formData.delete('files');
			for (const file of files) opts.formData.append('files', file);

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
				successMsg = `Upload confirmed and analyzed as session ${responseData.sessionId}.`;
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
			<p class="text-sm font-medium text-muted-foreground">Claims analytics</p>
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
				<span class="text-sm font-medium">Account</span>
				<select name="accountId" bind:value={accountId} class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
					{#each data.allowedAccounts as acct}
						<option value={acct.id}>{acct.name}</option>
					{/each}
				</select>
			</label>
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
			<div class="mt-5 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b text-muted-foreground">
						<tr>
							<th class="py-2 pr-3">File</th>
							<th class="py-2 pr-3">Type</th>
							<th class="py-2 pr-3">Mapping</th>
							<th class="py-2 pr-3">Mapping JSON</th>
						</tr>
					</thead>
					<tbody>
						{#each files as file, index}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-3">
									<p class="font-medium">{file.name}</p>
									<p class="text-xs text-muted-foreground">{fmtMB(file.size)} MB</p>
								</td>
								<td class="py-3 pr-3">
									<select name={`fileType:${index}`} bind:value={fileConfigs[index].fileType} class="h-9 rounded-md border bg-background px-2 text-sm">
										<option value="eligibility">Eligibility</option>
										<option value="medical">Medical</option>
										<option value="pharmacy">Pharmacy</option>
									</select>
								</td>
								<td class="py-3 pr-3">
									<select name={`mappingMode:${index}`} bind:value={fileConfigs[index].mappingMode} class="h-9 rounded-md border bg-background px-2 text-sm">
										<option value="stored">Stored</option>
										<option value="provided">Provided</option>
										<option value="canonical">Canonical</option>
									</select>
								</td>
								<td class="py-3 pr-3">
									{#if fileConfigs[index].mappingMode === 'provided'}
										<textarea
											name={`mappingJson:${index}`}
											rows="3"
											bind:value={fileConfigs[index].mappingJson}
											class="min-w-80 rounded-md border bg-background px-3 py-2 font-mono text-xs"
											placeholder={'{"fields":{"Source":"member_id"}}'}
										></textarea>
									{:else}
										<span class="text-muted-foreground">-</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if !hasEligibilitySelection}
				<label class="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
					<input type="checkbox" name="assumeClaimMembersEligible" bind:checked={assumeClaimMembersEligible} class="mt-0.5 size-4 rounded border" />
					<span>
						Eligibility is missing. I understand this session is not production-ready for full analytics and all individuals in the claims files may be treated as eligible for preview only.
					</span>
				</label>
			{/if}
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
					Confirm and analyze
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
					Production ready:
					<span class="font-medium">{preview.validation.productionReady ? 'yes' : 'no'}</span>
				</div>
			</div>

			{#if preview.validation.warnings.length}
				<div class="mt-4 grid gap-2">
					{#each preview.validation.warnings as warning}
						<p class="rounded-md border px-3 py-2 text-sm text-muted-foreground">
							<span class="font-medium">{warning.severity}:</span> {warning.filename ? `${warning.filename} - ` : ''}{warning.message}
						</p>
					{/each}
				</div>
			{/if}

			<div class="mt-4 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b text-muted-foreground">
						<tr>
							<th class="py-2 pr-3">File</th>
							<th class="py-2 pr-3">Type</th>
							<th class="py-2 pr-3">Mapping</th>
							<th class="py-2 pr-3">Rows</th>
							<th class="py-2 pr-3">Validation</th>
							<th class="py-2 pr-3">Headers</th>
						</tr>
					</thead>
					<tbody>
						{#each preview.files as file}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-3 font-medium">{file.filename}</td>
								<td class="py-3 pr-3">{file.fileType}</td>
								<td class="py-3 pr-3">
									{file.mapping.source}
									{#if file.mapping.version}
										<span class="text-muted-foreground">v{file.mapping.version}</span>
									{/if}
								</td>
								<td class="py-3 pr-3">{typeof file.rowCount === 'number' ? file.rowCount : '-'}</td>
								<td class="py-3 pr-3">{file.validation.status}</td>
								<td class="py-3 pr-3">
									{#if file.headers?.length}
										<span class="text-muted-foreground">{file.headers.join(', ')}</span>
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
