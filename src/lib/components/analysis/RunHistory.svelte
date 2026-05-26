<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { fmtDate, statusLabel } from '$lib/analysis/format';
	import type { AnalysisManifest } from '$lib/analysis/types';
	import FileStackIcon from '@lucide/svelte/icons/file-stack';

	export let runs: AnalysisManifest[] = [];
</script>

<Card>
	<CardHeader>
		<CardTitle>Recent analysis runs</CardTitle>
		<CardDescription>Local manifest history for staged ETL and BI integration.</CardDescription>
	</CardHeader>
	<CardContent>
		{#if runs.length}
			<div class="space-y-2">
				{#each runs as run}
					<div class="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
						<div class="flex items-center gap-3">
							<FileStackIcon class="size-4 text-muted-foreground" />
							<div>
								<p class="font-medium">{run.accountId} / {run.sessionId}</p>
								<p class="text-sm text-muted-foreground">{fmtDate(run.createdAt)}</p>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<Badge variant="outline">{run.files.length} files</Badge>
							<Badge variant={run.status === 'ready_for_bi' ? 'secondary' : 'outline'}>
								{statusLabel(run.status)}
							</Badge>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				No analysis runs have been written yet.
			</p>
		{/if}
	</CardContent>
</Card>
