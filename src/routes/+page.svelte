<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
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
	import type { SubmitFunction } from '@sveltejs/kit';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import DatabaseIcon from '@lucide/svelte/icons/database';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';

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
	type UploadActionResult = {
		error?: string;
		preview?: Preview;
		confirmed?: boolean;
		sessionId?: string;
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
		version: number;
		isActive: boolean;
		updatedAt?: string;
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
		runs: AnalysisManifest[];
		latest: AnalysisManifest | null;
		qa: WorkspaceQa;
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

	const steps = [
		{ label: 'Upload', icon: UploadIcon },
		{ label: 'Validate', icon: ShieldCheckIcon },
		{ label: 'Run', icon: PlayIcon },
		{ label: 'Review', icon: BarChart3Icon }
	];

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

	function fmtMB(bytes: number) {
		return (Number(bytes) / 1048576).toFixed(2);
	}

	function fmtDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
				successMsg = `Session ${responseData.sessionId} is ready for QA review.`;
				await invalidateAll();
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
	<div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<Badge variant="secondary">MVP demo workspace</Badge>
				<Badge variant="outline">Flat-file storage</Badge>
				<Badge variant={data.qa.analyticsReady ? 'secondary' : 'outline'}>
					{data.qa.analyticsReady ? 'Analytics ready' : 'QA review'}
				</Badge>
			</div>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">Claims QA console</h1>
			<p class="mt-2 max-w-3xl text-sm text-muted-foreground">
				Ingest claims files, validate readiness, run the Python artifact flow, and review ETL QA
				metrics in one workspace.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<form method="POST" action="?/clearSessions">
				<Button type="submit" variant="outline">
					<TrashIcon class="size-4" />
					Clear demo sessions
				</Button>
			</form>
		</div>
	</div>

	<div class="grid gap-2 md:grid-cols-4">
		{#each steps as step, index (step.label)}
			{@const Icon = step.icon}
			<div class="rounded-md border bg-card px-4 py-3">
				<div class="flex items-center gap-2">
					<Icon class="size-4 text-muted-foreground" />
					<span class="text-sm font-medium">{index + 1}. {step.label}</span>
				</div>
			</div>
		{/each}
	</div>

	<div class="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
		<aside class="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Recent runs</CardTitle>
					<CardDescription>{data.summary.uploadCount} local sessions</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if data.recentUploads.length}
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
										<form method="POST" action="?/deleteSession">
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
					{:else}
						<div class="rounded-md border border-dashed p-5 text-center">
							<ListChecksIcon class="mx-auto size-5 text-muted-foreground" />
							<p class="mt-2 text-sm text-muted-foreground">No sessions yet.</p>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Storage</CardTitle>
					<CardDescription>Current MVP persistence</CardDescription>
				</CardHeader>
				<CardContent class="space-y-2 text-sm">
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Mappings</span>
						<span class="font-medium">{data.summary.mappingCount}</span>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Active</span>
						<span class="font-medium">{data.summary.activeMappings}</span>
					</div>
					<div class="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
						<DatabaseIcon class="mb-1 size-4" />
						{data.summary.storageRoot}
					</div>
				</CardContent>
			</Card>
		</aside>

		<div class="space-y-5">
			<form
				method="POST"
				action="?/upload"
				enctype="multipart/form-data"
				use:enhance={submitHandler}
				class="space-y-5"
			>
				<Card>
					<CardHeader>
						<CardTitle>Upload</CardTitle>
						<CardDescription
							>Eligibility, medical, and pharmacy files in one session.</CardDescription
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

						<label class="block max-w-md">
							<span class="text-sm font-medium">Account</span>
							<select
								name="accountId"
								bind:value={accountId}
								class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
							>
								{#each data.allowedAccounts as acct (acct.id)}
									<option value={acct.id}>{acct.name}</option>
								{/each}
							</select>
						</label>

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
							<Button name="intent" value="preview" type="submit" disabled={isSubmitting}>
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
						<CardDescription
							>Python artifact status for the selected/latest session.</CardDescription
						>
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
							<form method="POST" action="?/runSession">
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
						>Inline import, selection, and edit surface for file-level mappings.</CardDescription
					>
				</CardHeader>
				<CardContent class="grid gap-5 xl:grid-cols-2">
					<form method="POST" action="?/saveMapping" class="space-y-3">
						<div class="grid gap-3 sm:grid-cols-3">
							<label class="block">
								<span class="text-sm font-medium">Account</span>
								<input
									name="accountId"
									value={accountId}
									class="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
								/>
							</label>
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
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="isActive" checked class="size-4 rounded border" />
							Active
						</label>
						<Button type="submit" variant="secondary">
							<SettingsIcon class="size-4" />
							Save mapping
						</Button>
					</form>

					<div class="space-y-3">
						<form
							method="POST"
							action="?/importMappingCsv"
							enctype="multipart/form-data"
							class="space-y-3 rounded-md border p-3"
						>
							<div class="grid gap-3 sm:grid-cols-3">
								<input
									name="accountId"
									value={accountId}
									class="h-9 rounded-md border bg-background px-3 text-sm"
									aria-label="Mapping account"
								/>
								<select
									name="fileType"
									class="h-9 rounded-md border bg-background px-3 text-sm"
									aria-label="Mapping file type"
								>
									<option value="eligibility">Eligibility</option>
									<option value="medical">Medical</option>
									<option value="pharmacy">Pharmacy</option>
								</select>
								<input
									name="version"
									value="1"
									inputmode="numeric"
									class="h-9 rounded-md border bg-background px-3 text-sm"
									aria-label="Mapping version"
								/>
							</div>
							<input
								name="mappingFile"
								type="file"
								accept=".csv,text/csv"
								class="block w-full text-sm"
							/>
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" name="isActive" checked class="size-4 rounded border" />
								Active
							</label>
							<Button type="submit" variant="outline">Import CSV</Button>
						</form>

						<div class="max-h-56 overflow-auto rounded-md border">
							{#if data.mappings.length}
								{#each data.mappings as mapping (mapping._id ?? `${mapping.accountId}-${mapping.fileType}-${mapping.version}`)}
									<div
										class="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0"
									>
										<span>{mapping.accountId} / {mapping.fileType} v{mapping.version}</span>
										<Badge variant={mapping.isActive ? 'secondary' : 'outline'}>
											{mapping.isActive ? 'Active' : 'Inactive'}
										</Badge>
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
	</div>
</div>
