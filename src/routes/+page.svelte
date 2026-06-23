<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import type { AnalysisManifest } from '$lib/analysis/types';
	import { workspaceActionUrl } from '$lib/workspace/actionUrl';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	type Account = { id: string; name: string };
	type ClientOption = Account & {
		mappingCount: number;
		fileTypes: string[];
	};
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
	type UploadActionResult = {
		error?: string;
		preview?: Preview;
		confirmed?: boolean;
		sessionId?: string;
		accountId?: string;
	};
	type UploadRow = {
		_id?: string;
		createdAt: string;
		accountId: string;
		fileType: string;
		fileTypes?: string[];
		totalBytes: number;
		stats?: Array<{ filename: string; rowCount?: number | null }>;
		validation?: { productionReady?: boolean };
		rawUploadRetention?: { retained?: boolean; cleanupStatus?: string };
	};
	type MappingRow = {
		_id?: string;
		accountId: string;
		fileType: string;
		name?: string;
		originalFilename?: string;
		version: number;
		isActive: boolean;
		json?: Record<string, unknown>;
		updatedAt?: string;
	};
	type MappingSummary = {
		fileType: FileType;
		defaultReason: 'latest_confirmed_upload' | 'newest_added' | null;
		defaultMapping: {
			id?: string;
			name: string;
			version: number;
			fieldCount: number;
			updatedAt?: string;
			originalFilename?: string;
		} | null;
		versions: Array<{
			id?: string;
			name: string;
			version: number;
			fieldCount: number;
			updatedAt?: string;
			originalFilename?: string;
			fields: Array<{
				sourceColumn: string;
				targetColumn: string;
				dtype: string;
				parseDate: boolean;
			}>;
			isDefault: boolean;
		}>;
	};
	type QaMetric = {
		key: string;
		label: string;
		value: string | number;
		tone: 'default' | 'good' | 'warning';
	};
	type QaWarning = { code: string; message: string; severity: 'blocking' | 'quality' };
	type CuratedArtifact = {
		key: string;
		label: string;
		href: string;
		format: 'json' | 'csv' | 'xlsx';
	};
	type WorkspaceQa = {
		source: 'empty' | 'validation' | 'etl';
		analyticsReady: boolean;
		productionReady: boolean;
		metrics: QaMetric[];
		warnings: { blocking: QaWarning[]; quality: QaWarning[] };
		artifacts: CuratedArtifact[];
	};

	export let data: {
		allowedAccounts: Account[];
		clientOptions: ClientOption[];
		selectedClientId: string;
		defaultAccountId?: string;
		userId: string;
		summary: {
			uploadCount: number;
			mappingCount: number;
			activeMappings: number;
			storePath: string;
			storageRoot: string;
		};
		recentUploads: UploadRow[];
		mappings: MappingRow[];
		mappingSummaries: MappingSummary[];
		runs: AnalysisManifest[];
		latest: AnalysisManifest | null;
		qa: WorkspaceQa;
	};

	const claimsFileTypes: FileType[] = ['eligibility', 'medical', 'pharmacy'];

	let files: File[] = [];
	let fileConfigs: FileConfig[] = [];
	let dragging = false;
	let accountId = data.selectedClientId ?? data.defaultAccountId ?? data.clientOptions[0]?.id ?? '';
	let loadedClientId = data.selectedClientId;
	let newClientId = '';
	let showAddClientModal = false;
	let showAddMappingModal = false;
	let assumeClaimMembersEligible = false;
	let errorMsg = '';
	let successMsg = '';
	let isSubmitting = false;
	let preview: Preview | null = null;

	$: if (data.selectedClientId !== loadedClientId) {
		accountId = data.selectedClientId;
		loadedClientId = data.selectedClientId;
	}
	$: selectedClient = data.clientOptions.find((client) => client.id === accountId) ?? null;
	$: totalBytes = preview
		? preview.stats.reduce((sum, stat) => sum + Number(stat.bytes ?? 0), 0)
		: 0;
	$: hasEligibilitySelection = fileConfigs.some((config) => config.fileType === 'eligibility');
	$: visibleWarnings = [...data.qa.warnings.blocking, ...data.qa.warnings.quality].slice(0, 5);

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

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (!event.dataTransfer) return;
		setFiles(Array.from(event.dataTransfer.files));
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		dragging = true;
	}

	function onDragLeave() {
		dragging = false;
	}

	function onFilePick(event: Event) {
		const input = event.target as HTMLInputElement;
		setFiles(input.files ? Array.from(input.files) : []);
	}

	function onClientChange(event: Event) {
		const nextAccountId = (event.target as HTMLSelectElement).value;
		accountId = nextAccountId;
		preview = null;
		void goto(nextAccountId ? `/?client=${encodeURIComponent(nextAccountId)}` : '/', {
			keepFocus: true,
			noScroll: true
		});
	}

	function fmtMB(bytes: number) {
		return (Number(bytes) / 1048576).toFixed(2);
	}

	function fmtDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	function formatFileType(value: string) {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	function defaultReasonLabel(reason: MappingSummary['defaultReason']) {
		if (reason === 'latest_confirmed_upload') return 'Latest confirmed upload';
		if (reason === 'newest_added') return 'Newest added';
		return 'No stored mapping';
	}

	function actionData(payload: unknown): UploadActionResult {
		if (payload && typeof payload === 'object' && 'type' in payload && 'data' in payload) {
			return actionData((payload as { data: unknown }).data);
		}
		if (typeof payload === 'string') {
			return { error: payload };
		}
		return payload && typeof payload === 'object' ? (payload as UploadActionResult) : {};
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
			let responseData = actionData(payload);

			if (
				payload &&
				typeof payload === 'object' &&
				'data' in payload &&
				typeof payload.data === 'string'
			) {
				const { parse } = await import('devalue');
				responseData = actionData(parse(payload.data));
			}

			if (responseData.error) {
				errorMsg = responseData.error;
				preview = null;
			} else if (responseData.preview) {
				preview = responseData.preview;
			} else if (responseData.confirmed) {
				preview = null;
				files = [];
				fileConfigs = [];
				successMsg = `Session ${responseData.sessionId} is ready for review.`;
				const confirmedAccountId = responseData.accountId ?? accountId;
				await goto(
					confirmedAccountId ? `/?client=${encodeURIComponent(confirmedAccountId)}` : '/',
					{
						keepFocus: true,
						noScroll: true,
						invalidateAll: true
					}
				);
			} else {
				errorMsg = 'Unknown server response.';
				preview = null;
			}
		} catch (error) {
			errorMsg = error instanceof Error ? error.message : 'Unexpected upload error.';
			preview = null;
		} finally {
			isSubmitting = false;
		}
	};
</script>

<div class="space-y-5">
	<div class="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
		<Card>
			<CardHeader>
				<CardTitle>Storage</CardTitle>
				<CardDescription>Current workspace persistence</CardDescription>
			</CardHeader>
			<CardContent class="space-y-2 text-sm">
				<div class="flex items-center justify-between gap-2">
					<span class="text-muted-foreground">Stored mappings</span>
					<span class="font-medium">{data.summary.mappingCount}</span>
				</div>
				<div class="flex items-center justify-between gap-2">
					<span class="text-muted-foreground">Local sessions</span>
					<span class="font-medium">{data.summary.uploadCount}</span>
				</div>
				<div class="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
					<DatabaseIcon class="mb-1 size-4" />
					{data.summary.storageRoot}
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Recent runs</CardTitle>
				<CardDescription>{data.recentUploads.length} latest local sessions</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.recentUploads.length}
					<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						{#each data.recentUploads as row (row._id ?? row.createdAt)}
							<div class="rounded-md border p-3">
								<div class="flex items-start justify-between gap-2">
									<div>
										<p class="text-sm font-medium">{row.accountId}</p>
										<p class="text-xs text-muted-foreground">
											{row.fileTypes?.join(', ') ?? row.fileType}
										</p>
									</div>
									<Badge variant={row.validation?.productionReady ? 'secondary' : 'outline'}>
										{row.validation?.productionReady ? 'Ready' : 'Review'}
									</Badge>
								</div>
								<p class="mt-2 text-xs text-muted-foreground">
									{row.stats?.[0]?.filename ?? 'No file'} - {fmtDate(row.createdAt)}
								</p>
								<div class="mt-3 flex items-center justify-between gap-2">
									<span class="text-xs text-muted-foreground">{fmtMB(row.totalBytes)} MB</span>
									{#if row._id}
										<form method="POST" action={workspaceActionUrl('deleteSession', accountId)}>
											<input type="hidden" name="sessionId" value={row._id} />
											<Button type="submit" size="sm" variant="ghost">
												<TrashIcon class="size-3.5" />
												Delete
											</Button>
										</form>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded-md border border-dashed p-5 text-center">
						<ListChecksIcon class="mx-auto size-5 text-muted-foreground" />
						<p class="mt-2 text-sm text-muted-foreground">No sessions yet.</p>
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>

	<div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
		<h1 class="text-3xl font-semibold tracking-tight">USPM Claims Engine</h1>
		<form method="POST" action={workspaceActionUrl('clearSessions', accountId)}>
			<Button type="submit" variant="outline">
				<TrashIcon class="size-4" />
				Clear demo sessions
			</Button>
		</form>
	</div>

	<Card>
		<CardHeader>
			<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Building2Icon class="size-5 text-muted-foreground" />
						Client workspace
					</CardTitle>
					<CardDescription>
						Select a client with stored mappings, or create one by importing its first mapping CSV.
					</CardDescription>
				</div>
				{#if selectedClient}
					<Badge variant="secondary">{selectedClient.mappingCount} mappings</Badge>
				{/if}
			</div>
		</CardHeader>
		<CardContent class="space-y-5">
			<div class="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
				<div class="space-y-3">
					<label class="block max-w-xl">
						<span class="text-sm font-medium">Working client</span>
						{#if data.clientOptions.length}
							<select
								name="workspaceClient"
								bind:value={accountId}
								on:change={onClientChange}
								class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
							>
								{#each data.clientOptions as client (client.id)}
									<option value={client.id}>
										{client.name} ({client.mappingCount} mappings)
									</option>
								{/each}
							</select>
						{:else}
							<div class="mt-1 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
								No clients have stored mappings yet. Import a first mapping CSV to create one.
							</div>
						{/if}
					</label>
					<Button type="button" variant="secondary" onclick={() => (showAddClientModal = true)}>
						<PlusIcon class="size-4" />
						Add client
					</Button>

					{#if selectedClient}
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-md border p-3">
								<p class="text-xs text-muted-foreground">Client ID</p>
								<p class="mt-1 truncate text-sm font-medium">{selectedClient.id}</p>
							</div>
							<div class="rounded-md border p-3">
								<p class="text-xs text-muted-foreground">Mappings</p>
								<p class="mt-1 text-sm font-medium">{selectedClient.mappingCount}</p>
							</div>
							<div class="rounded-md border p-3">
								<p class="text-xs text-muted-foreground">File types</p>
								<p class="mt-1 truncate text-sm font-medium">
									{selectedClient.fileTypes.join(', ') || 'None'}
								</p>
							</div>
						</div>
					{/if}
				</div>

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<div>
							<p class="text-sm font-medium">Upload mapping defaults</p>
							<p class="text-xs text-muted-foreground">
								Stored mappings selected for eligibility, medical, and pharmacy uploads.
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							disabled={!accountId}
							onclick={() => (showAddMappingModal = true)}
						>
							<PlusIcon class="size-4" />
							Add mapping
						</Button>
					</div>
					<div class="grid gap-3">
						{#each data.mappingSummaries as summary (summary.fileType)}
							<div class="rounded-md border p-3">
								<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
									<div>
										<p class="text-sm font-medium">{formatFileType(summary.fileType)}</p>
										{#if summary.defaultMapping}
											<p class="mt-1 text-sm">
												{summary.defaultMapping.name}
												<span class="text-muted-foreground">v{summary.defaultMapping.version}</span>
											</p>
											<p class="text-xs text-muted-foreground">
												{summary.defaultMapping.fieldCount} fields -
												{defaultReasonLabel(summary.defaultReason)}
											</p>
										{:else}
											<p class="mt-1 text-sm text-muted-foreground">No mapping loaded</p>
										{/if}
									</div>
									<Badge variant={summary.defaultMapping ? 'secondary' : 'outline'}>
										{summary.defaultMapping ? 'Default' : 'Missing'}
									</Badge>
								</div>
								<details class="mt-3">
									<summary class="cursor-pointer text-sm font-medium text-muted-foreground">
										Inspect loaded mappings
									</summary>
									{#if summary.versions.length}
										<div class="mt-3 space-y-3">
											{#each summary.versions as mapping (mapping.id ?? `${summary.fileType}-${mapping.version}`)}
												<div class="rounded-md border bg-muted/20 p-3">
													<div class="flex flex-wrap items-center justify-between gap-2">
														<p class="text-sm font-medium">
															{mapping.name}
															<span class="text-muted-foreground">v{mapping.version}</span>
														</p>
														{#if mapping.isDefault}
															<Badge variant="secondary">Default</Badge>
														{/if}
													</div>
													{#if mapping.fields.length}
														<div class="mt-3 overflow-x-auto rounded-md border bg-background">
															<table class="w-full text-left text-xs">
																<thead class="border-b bg-muted/40 text-muted-foreground">
																	<tr>
																		<th class="px-2 py-1.5">Source</th>
																		<th class="px-2 py-1.5">Canonical</th>
																		<th class="px-2 py-1.5">Type</th>
																		<th class="px-2 py-1.5">Date</th>
																	</tr>
																</thead>
																<tbody>
																	{#each mapping.fields as field (`${field.sourceColumn}-${field.targetColumn}`)}
																		<tr class="border-b last:border-0">
																			<td class="px-2 py-1.5">{field.sourceColumn}</td>
																			<td class="px-2 py-1.5">{field.targetColumn}</td>
																			<td class="px-2 py-1.5">{field.dtype || '-'}</td>
																			<td class="px-2 py-1.5">{field.parseDate ? 'Yes' : 'No'}</td>
																		</tr>
																	{/each}
																</tbody>
															</table>
														</div>
													{/if}
												</div>
											{/each}
										</div>
									{:else}
										<p
											class="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground"
										>
											No {summary.fileType} mappings are stored for this client.
										</p>
									{/if}
								</details>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</CardContent>
	</Card>

	<div class="space-y-5">
		<form
			method="POST"
			action={workspaceActionUrl('upload', accountId)}
			enctype="multipart/form-data"
			use:enhance={submitHandler}
			class="space-y-5"
		>
			<Card>
				<CardHeader>
					<CardTitle>Upload</CardTitle>
					<CardDescription>Eligibility, medical, and pharmacy files in one session.</CardDescription
					>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if errorMsg}
						<div
							class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
							role="alert"
						>
							{errorMsg}
						</div>
					{/if}

					{#if successMsg}
						<div
							class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
							role="status"
						>
							{successMsg}
						</div>
					{/if}

					<input type="hidden" name="accountId" value={accountId} />
					<div class="max-w-xl rounded-md border bg-muted/30 px-3 py-2 text-sm">
						<span class="text-muted-foreground">Uploading for</span>
						<span class="ml-2 font-medium">
							{(selectedClient?.name ?? accountId) || 'No client selected'}
						</span>
					</div>

					<div
						role="button"
						tabindex="0"
						class={`rounded-md border-2 border-dashed p-6 text-center transition ${
							dragging ? 'border-primary bg-muted' : 'border-border hover:bg-muted/60'
						}`}
						on:dragover={onDragOver}
						on:dragleave={onDragLeave}
						on:drop={onDrop}
						aria-label="Drag and drop claims files"
					>
						<FileSpreadsheetIcon class="mx-auto size-7 text-muted-foreground" />
						<p class="mt-2 font-medium">Drop claims files</p>
						<p class="mt-1 text-sm text-muted-foreground">CSV, TSV, TXT, PSV, XLS, or XLSX</p>
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
						<div class="overflow-x-auto rounded-md border">
							<table class="w-full text-left text-sm">
								<thead class="border-b bg-muted/40 text-muted-foreground">
									<tr>
										<th class="px-3 py-2">File</th>
										<th class="px-3 py-2">Type</th>
										<th class="px-3 py-2">Mapping</th>
										<th class="px-3 py-2">Provided mapping</th>
									</tr>
								</thead>
								<tbody>
									{#each files as file, index (`${file.name}-${index}`)}
										<tr class="border-b last:border-0">
											<td class="px-3 py-3">
												<p class="font-medium">{file.name}</p>
												<p class="text-xs text-muted-foreground">{fmtMB(file.size)} MB</p>
											</td>
											<td class="px-3 py-3">
												<select
													name={`fileType:${index}`}
													bind:value={fileConfigs[index].fileType}
													class="h-9 rounded-md border bg-background px-2 text-sm"
												>
													<option value="eligibility">Eligibility</option>
													<option value="medical">Medical</option>
													<option value="pharmacy">Pharmacy</option>
												</select>
											</td>
											<td class="px-3 py-3">
												<select
													name={`mappingMode:${index}`}
													bind:value={fileConfigs[index].mappingMode}
													class="h-9 rounded-md border bg-background px-2 text-sm"
												>
													<option value="stored">Stored</option>
													<option value="provided">Provided</option>
													<option value="canonical">Canonical</option>
												</select>
											</td>
											<td class="px-3 py-3">
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
							<label
								class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
							>
								<input
									type="checkbox"
									name="assumeClaimMembersEligible"
									bind:checked={assumeClaimMembersEligible}
									class="mt-0.5 size-4 rounded border"
								/>
								<span>
									Eligibility is missing. Treat all claim members as eligible for preview only and
									mark this session as not production-ready.
								</span>
							</label>
						{/if}
					{/if}

					<div class="flex flex-wrap gap-2">
						<Button
							name="intent"
							value="preview"
							type="submit"
							disabled={isSubmitting || !accountId}
						>
							{isSubmitting ? 'Working...' : 'Preview'}
						</Button>
						{#if preview}
							<Button
								name="intent"
								value="confirm"
								type="submit"
								variant="secondary"
								disabled={isSubmitting}
							>
								Confirm
							</Button>
						{/if}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Validate</CardTitle>
					<CardDescription>Production readiness and file-level coverage.</CardDescription>
				</CardHeader>
				<CardContent>
					{#if preview}
						<div class="mb-4 flex flex-wrap items-center gap-2">
							<Badge variant={preview.validation.productionReady ? 'secondary' : 'outline'}>
								{preview.validation.productionReady ? 'Production-ready' : 'Preview-only'}
							</Badge>
							<Badge variant="outline">{preview.stats.length} files</Badge>
							<Badge variant="outline">{fmtMB(totalBytes)} MB</Badge>
						</div>

						{#if preview.validation.warnings.length}
							<div class="mb-4 grid gap-2">
								{#each preview.validation.warnings as warning, index (`${warning.severity}-${index}`)}
									<p class="rounded-md border px-3 py-2 text-sm text-muted-foreground">
										<span class="font-medium">{warning.severity}:</span>
										{warning.filename ? `${warning.filename} - ` : ''}{warning.message}
									</p>
								{/each}
							</div>
						{/if}

						<div class="overflow-x-auto rounded-md border">
							<table class="w-full text-left text-sm">
								<thead class="border-b bg-muted/40 text-muted-foreground">
									<tr>
										<th class="px-3 py-2">File</th>
										<th class="px-3 py-2">Type</th>
										<th class="px-3 py-2">Rows</th>
										<th class="px-3 py-2">Mapping</th>
										<th class="px-3 py-2">Status</th>
										<th class="px-3 py-2">Headers</th>
									</tr>
								</thead>
								<tbody>
									{#each preview.files as file (file.fileId)}
										<tr class="border-b last:border-0">
											<td class="px-3 py-3 font-medium">{file.filename}</td>
											<td class="px-3 py-3">{file.fileType}</td>
											<td class="px-3 py-3"
												>{typeof file.rowCount === 'number' ? file.rowCount : '-'}</td
											>
											<td class="px-3 py-3">
												{file.mapping.source}
												{#if file.mapping.version}
													<span class="text-muted-foreground">v{file.mapping.version}</span>
												{/if}
											</td>
											<td class="px-3 py-3">{file.validation.status}</td>
											<td class="max-w-xs truncate px-3 py-3 text-muted-foreground">
												{file.headers?.join(', ') ?? '-'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<div
							class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
						>
							Upload preview results appear here before confirmation.
						</div>
					{/if}
				</CardContent>
			</Card>
		</form>

		<div class="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
			<Card>
				<CardHeader>
					<CardTitle>Run</CardTitle>
					<CardDescription>Python artifact status for the selected/latest session.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if data.latest}
						<div class="rounded-md border p-3">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium">{data.latest.sessionId}</p>
									<p class="text-xs text-muted-foreground">{fmtDate(data.latest.createdAt)}</p>
								</div>
								<Badge variant={data.latest.python.status === 'ready' ? 'secondary' : 'outline'}>
									{data.latest.python.status}
								</Badge>
							</div>
						</div>
						<form method="POST" action={workspaceActionUrl('runSession', accountId)}>
							<input type="hidden" name="sessionId" value={data.latest.sessionId} />
							<Button type="submit">
								<PlayIcon class="size-4" />
								Run QA pipeline
							</Button>
						</form>
						<div class="grid gap-2 text-sm">
							<div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
								<span class="text-muted-foreground">ETL status</span>
								<span class="font-medium">{data.latest.etlStatus ?? 'pending'}</span>
							</div>
							<div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
								<span class="text-muted-foreground">QA source</span>
								<span class="font-medium">{data.qa.source}</span>
							</div>
							<div class="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
								<span class="text-muted-foreground">Raw retention</span>
								<span class="font-medium"
									>{data.latest.rawUploadRetention?.cleanupStatus ?? 'unknown'}</span
								>
							</div>
						</div>
					{:else}
						<div
							class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
						>
							No Python run has been created yet.
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Review</CardTitle>
					<CardDescription>Core analytics QA metrics from ETL artifacts first.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if data.qa.metrics.length}
						<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{#each data.qa.metrics as metric (metric.key)}
								<div class="rounded-md border p-3">
									<p class="text-xs text-muted-foreground">{metric.label}</p>
									<p class="mt-1 text-xl font-semibold">{metric.value}</p>
								</div>
							{/each}
						</div>
					{:else}
						<div
							class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
						>
							QA metrics appear after the first upload session.
						</div>
					{/if}

					{#if visibleWarnings.length}
						<div class="space-y-2">
							<p class="text-sm font-medium">Warnings</p>
							{#each visibleWarnings as warning (`${warning.severity}-${warning.code}`)}
								<p class="rounded-md border px-3 py-2 text-sm text-muted-foreground">
									<span class="font-medium">{warning.severity}:</span>
									{warning.message}
								</p>
							{/each}
						</div>
					{/if}

					{#if data.qa.artifacts.length}
						<div class="space-y-2">
							<p class="text-sm font-medium">Downloads</p>
							<div class="flex flex-wrap gap-2">
								{#each data.qa.artifacts as artifact (artifact.key)}
									<a
										class="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
										href={artifact.href}
									>
										<DownloadIcon class="size-4" />
										{artifact.label}
									</a>
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Mappings</CardTitle>
				<CardDescription
					>Stored mappings for {(selectedClient?.name ?? accountId) ||
						'the selected client'}.</CardDescription
				>
			</CardHeader>
			<CardContent class="grid gap-5 xl:grid-cols-2">
				<form method="POST" action={workspaceActionUrl('saveMapping', accountId)} class="space-y-3">
					<input type="hidden" name="accountId" value={accountId} />
					<div class="rounded-md border bg-muted/30 px-3 py-2 text-sm">
						<span class="text-muted-foreground">Editing client</span>
						<span class="ml-2 font-medium">
							{(selectedClient?.name ?? accountId) || 'No client selected'}
						</span>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="block">
							<span class="text-sm font-medium">Type</span>
							<select
								name="fileType"
								class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
							>
								<option value="eligibility">Eligibility</option>
								<option value="medical">Medical</option>
								<option value="pharmacy">Pharmacy</option>
							</select>
						</label>
						<label class="block">
							<span class="text-sm font-medium">Name</span>
							<input
								name="name"
								placeholder="Manual medical mapping"
								class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
							/>
						</label>
						<label class="block">
							<span class="text-sm font-medium">Version</span>
							<input
								name="version"
								value="1"
								inputmode="numeric"
								class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
							/>
						</label>
					</div>
					<textarea
						name="json"
						rows="5"
						class="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
						placeholder={'{"fields":{"MemberID":"member_id"}}'}
					></textarea>
					<Button type="submit" variant="secondary" disabled={!accountId}>
						<SettingsIcon class="size-4" />
						Save mapping
					</Button>
				</form>

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm font-medium">Stored mapping versions</p>
						<Button
							type="button"
							variant="outline"
							disabled={!accountId}
							onclick={() => (showAddMappingModal = true)}
						>
							<PlusIcon class="size-4" />
							Add mapping
						</Button>
					</div>
					<div class="max-h-56 overflow-auto rounded-md border">
						{#if data.mappings.length}
							{#each data.mappings as mapping (mapping._id ?? `${mapping.accountId}-${mapping.fileType}-${mapping.version}`)}
								<div
									class="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0"
								>
									<span
										>{mapping.name ?? mapping.originalFilename ?? mapping.fileType} v{mapping.version}</span
									>
									<Badge variant="outline">{formatFileType(mapping.fileType)}</Badge>
								</div>
							{/each}
						{:else}
							<p class="p-4 text-sm text-muted-foreground">No mappings saved.</p>
						{/if}
					</div>
				</div>
			</CardContent>
		</Card>
	</div>

	{#if showAddClientModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				class="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-md border bg-background shadow-lg"
			>
				<form
					method="POST"
					action={workspaceActionUrl('importMappingCsv', newClientId || accountId)}
					enctype="multipart/form-data"
				>
					<div class="border-b p-4">
						<h2 class="text-lg font-semibold">Add client</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							Create a client by attaching at least one mapping CSV.
						</p>
					</div>
					<div class="space-y-4 p-4">
						<label class="block max-w-sm">
							<span class="text-sm font-medium">Client</span>
							<input
								name="accountId"
								bind:value={newClientId}
								required
								placeholder="Mock"
								class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
							/>
						</label>
						<div class="grid gap-3">
							{#each claimsFileTypes as fileType (fileType)}
								<div class="rounded-md border p-3">
									<p class="text-sm font-medium">{formatFileType(fileType)}</p>
									<div class="mt-3 grid gap-3 lg:grid-cols-[1fr_120px]">
										<label class="block">
											<span class="text-xs font-medium text-muted-foreground">Mapping name</span>
											<input
												name={`name:${fileType}`}
												placeholder={`${formatFileType(fileType)} mapping`}
												class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
											/>
										</label>
										<label class="block">
											<span class="text-xs font-medium text-muted-foreground">Version</span>
											<input
												name={`version:${fileType}`}
												value="1"
												inputmode="numeric"
												class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
											/>
										</label>
									</div>
									<div class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
										<input
											name={`mappingFile:${fileType}`}
											type="file"
											accept=".csv,text/csv"
											class="block w-full rounded-md border bg-background p-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
										/>
										<div
											class="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
										>
											Optional CSV for {formatFileType(fileType)}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
					<div class="flex justify-end gap-2 border-t p-4">
						<Button type="button" variant="outline" onclick={() => (showAddClientModal = false)}>
							Cancel
						</Button>
						<Button type="submit">Add client</Button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if showAddMappingModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				class="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-md border bg-background shadow-lg"
			>
				<form
					method="POST"
					action={workspaceActionUrl('importMappingCsv', accountId)}
					enctype="multipart/form-data"
				>
					<input type="hidden" name="accountId" value={accountId} />
					<div class="border-b p-4">
						<h2 class="text-lg font-semibold">Add mapping</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							Import one or more mapping CSVs for {(selectedClient?.name ?? accountId) ||
								'the selected client'}.
						</p>
					</div>
					<div class="grid gap-3 p-4">
						{#each claimsFileTypes as fileType (fileType)}
							<div class="rounded-md border p-3">
								<p class="text-sm font-medium">{formatFileType(fileType)}</p>
								<div class="mt-3 grid gap-3 lg:grid-cols-[1fr_120px]">
									<label class="block">
										<span class="text-xs font-medium text-muted-foreground">Mapping name</span>
										<input
											name={`name:${fileType}`}
											placeholder={`${formatFileType(fileType)} mapping`}
											class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
										/>
									</label>
									<label class="block">
										<span class="text-xs font-medium text-muted-foreground">Version</span>
										<input
											name={`version:${fileType}`}
											value="1"
											inputmode="numeric"
											class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
										/>
									</label>
								</div>
								<div class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
									<input
										name={`mappingFile:${fileType}`}
										type="file"
										accept=".csv,text/csv"
										class="block w-full rounded-md border bg-background p-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
									/>
									<div
										class="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
									>
										Optional CSV for {formatFileType(fileType)}
									</div>
								</div>
							</div>
						{/each}
					</div>
					<div class="flex justify-end gap-2 border-t p-4">
						<Button type="button" variant="outline" onclick={() => (showAddMappingModal = false)}>
							Cancel
						</Button>
						<Button type="submit">Import mappings</Button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
