<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import UploadIcon from '@lucide/svelte/icons/upload';

	type Summary = {
		uploadCount: number;
		mappingCount: number;
		activeMappings: number;
		storePath: string;
		latestUpload?: {
			createdAt: string;
			accountId: string;
			fileType: string;
			totalBytes: number;
		};
	};

	type UploadRow = {
		_id?: string;
		createdAt: string;
		accountId: string;
		fileType: string;
		totalBytes: number;
		stats?: Array<{ filename: string }>;
	};

	type MappingRow = {
		_id?: string;
		accountId: string;
		fileType: string;
		version: number;
		isActive: boolean;
	};

	export let data: {
		summary: Summary;
		recentUploads: UploadRow[];
		mappings: MappingRow[];
	};

	const capabilities = [
		{ label: 'Preview row counts and headers', state: 'Ready', icon: FileSpreadsheetIcon },
		{ label: 'Persist sessions locally', state: 'Ready', icon: HistoryIcon },
		{ label: 'Manage mapping versions', state: 'Ready', icon: SettingsIcon },
		{ label: 'Generate BI dashboard artifacts', state: 'Ready', icon: BarChart3Icon }
	];

	function fmtMB(bytes: number) {
		return (Number(bytes) / 1048576).toFixed(2);
	}

	function fmtDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}
</script>

<div class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<div class="flex items-center gap-2">
				<Badge variant="secondary">Local artifact mode</Badge>
				<Badge variant="outline">No DB required</Badge>
			</div>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight">Claims analytics dashboard</h1>
			<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
				A simple path from mapping import and raw claims upload to Python analysis, BI visuals, and trace workbook output.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button href="/upload">
				<UploadIcon class="size-4" />
				New upload
			</Button>
			<Button href="/upload/history" variant="outline">
				<HistoryIcon class="size-4" />
				History
			</Button>
		</div>
	</div>

	<div class="grid gap-4 md:grid-cols-4">
		<Card>
			<CardHeader>
				<CardDescription>Upload sessions</CardDescription>
				<CardTitle class="text-3xl">{data.summary.uploadCount}</CardTitle>
			</CardHeader>
		</Card>
		<Card>
			<CardHeader>
				<CardDescription>Analysis outputs</CardDescription>
				<CardTitle class="text-3xl">{data.summary.uploadCount}</CardTitle>
			</CardHeader>
		</Card>
		<Card>
			<CardHeader>
				<CardDescription>Mappings</CardDescription>
				<CardTitle class="text-3xl">{data.summary.mappingCount}</CardTitle>
			</CardHeader>
		</Card>
		<Card>
			<CardHeader>
				<CardDescription>Active mappings</CardDescription>
				<CardTitle class="text-3xl">{data.summary.activeMappings}</CardTitle>
			</CardHeader>
		</Card>
	</div>

	<div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
		<Card>
			<CardHeader>
				<CardTitle>Stakeholder walkthrough</CardTitle>
				<CardDescription>Primary surfaces for the stakeholder walkthrough.</CardDescription>
			</CardHeader>
			<CardContent class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<a href="/upload" class="rounded-lg border p-4 transition hover:bg-muted/60">
					<div class="flex items-center justify-between gap-2">
						<UploadIcon class="size-5 text-muted-foreground" />
						<ArrowRightIcon class="size-4 text-muted-foreground" />
					</div>
					<p class="mt-4 font-medium">Upload</p>
					<p class="mt-1 text-sm text-muted-foreground">Preview files and create an analysis session.</p>
				</a>
				<a href="/upload/history" class="rounded-lg border p-4 transition hover:bg-muted/60">
					<div class="flex items-center justify-between gap-2">
						<HistoryIcon class="size-5 text-muted-foreground" />
						<ArrowRightIcon class="size-4 text-muted-foreground" />
					</div>
					<p class="mt-4 font-medium">History</p>
					<p class="mt-1 text-sm text-muted-foreground">Review local upload activity.</p>
				</a>
				<a href="/admin/mappings" class="rounded-lg border p-4 transition hover:bg-muted/60">
					<div class="flex items-center justify-between gap-2">
						<SettingsIcon class="size-5 text-muted-foreground" />
						<ArrowRightIcon class="size-4 text-muted-foreground" />
					</div>
					<p class="mt-4 font-medium">Mappings</p>
					<p class="mt-1 text-sm text-muted-foreground">Create stored mapping versions.</p>
				</a>
				<a href="/analysis" class="rounded-lg border p-4 transition hover:bg-muted/60">
					<div class="flex items-center justify-between gap-2">
						<BarChart3Icon class="size-5 text-muted-foreground" />
						<ArrowRightIcon class="size-4 text-muted-foreground" />
					</div>
					<p class="mt-4 font-medium">Analysis</p>
					<p class="mt-1 text-sm text-muted-foreground">Review staged BI artifacts.</p>
				</a>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Current readiness</CardTitle>
				<CardDescription>What is demo-ready in this iteration.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				{#each capabilities as item}
					{@const Icon = item.icon}
					<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
						<div class="flex items-center gap-2">
							<Icon class="size-4 text-muted-foreground" />
							<span class="text-sm font-medium">{item.label}</span>
						</div>
						<Badge variant={item.state === 'Ready' ? 'secondary' : 'outline'}>{item.state}</Badge>
					</div>
				{/each}
			</CardContent>
		</Card>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<Card>
			<CardHeader>
				<CardTitle>Recent uploads</CardTitle>
				<CardDescription>Latest local sessions captured under <code>var/</code>.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.recentUploads.length}
					<div class="space-y-3">
						{#each data.recentUploads as row}
							<div class="rounded-lg border px-3 py-2">
								<div class="flex items-center justify-between gap-3">
									<p class="font-medium">{row.accountId} / {row.fileType}</p>
									<span class="text-sm text-muted-foreground">{fmtMB(row.totalBytes)} MB</span>
								</div>
								<p class="mt-1 text-sm text-muted-foreground">
									{row.stats?.[0]?.filename ?? 'No file name'} - {fmtDate(row.createdAt)}
								</p>
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded-lg border border-dashed p-6 text-center">
						<ListChecksIcon class="mx-auto size-6 text-muted-foreground" />
						<p class="mt-2 text-sm text-muted-foreground">No upload sessions yet.</p>
					</div>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Mappings</CardTitle>
				<CardDescription>Active local mapping versions used by upload and analysis sessions.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.mappings.length}
					<div class="space-y-2">
						{#each data.mappings as mapping}
							<div class="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
								<span>{mapping.accountId} / {mapping.fileType} v{mapping.version}</span>
								<Badge variant={mapping.isActive ? 'secondary' : 'outline'}>
									{mapping.isActive ? 'Active' : 'Inactive'}
								</Badge>
							</div>
						{/each}
					</div>
				{:else}
					<p class="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">No mappings saved.</p>
				{/if}
			</CardContent>
		</Card>
	</div>
</div>
