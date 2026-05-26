<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { AnalysisManifest, ReportSectionsArtifact } from '$lib/analysis/types';

	export let run: AnalysisManifest;
	export let reportSections: ReportSectionsArtifact = null;

	$: cleanedArtifacts = Object.entries(reportSections?.cleanedArtifacts ?? {});
	$: traceWorkbookPath = run.artifacts?.reportXlsx ?? reportSections?.xlsxReportPath;
</script>

<div class="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
	<Card>
		<CardHeader>
			<CardTitle>Python analytics status</CardTitle>
			<CardDescription>App-owned copy of the source-of-truth ETL and BI engine is present.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-3 text-sm">
			<div class="rounded-lg border bg-muted/30 p-3">
				<p class="font-medium">Runtime</p>
				<p class="mt-1 text-muted-foreground">Status: {run.python.status}</p>
				<p class="mt-1 text-muted-foreground">Mode: {reportSections?.analysisMode ?? 'unknown'}</p>
				<p class="mt-1 break-all text-muted-foreground">Requirements: {run.python.requirementsFile}</p>
			</div>
			{#each run.python.notes as note}
				<p class="rounded-md border px-3 py-2 text-muted-foreground">{note}</p>
			{/each}
			{#if traceWorkbookPath}
				<div class="rounded-md border px-3 py-2">
					<p class="font-medium">Trace workbook</p>
					<p class="mt-1 break-all text-muted-foreground">{traceWorkbookPath}</p>
					<a class="mt-3 inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted" href={`/analysis/${run.sessionId}/report.xlsx`}>
						Open workbook
					</a>
				</div>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Files and canonical artifacts</CardTitle>
			<CardDescription>{run.files.length} source files captured for this run.</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b text-muted-foreground">
						<tr>
							<th class="py-2 pr-4">File</th>
							<th class="py-2 pr-4">Type</th>
							<th class="py-2 pr-4">Rows</th>
							<th class="py-2 pr-4">Headers</th>
						</tr>
					</thead>
					<tbody>
						{#each run.files as file}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-4 font-medium">{file.filename}</td>
								<td class="py-3 pr-4"><Badge variant="secondary">{file.fileType}</Badge></td>
								<td class="py-3 pr-4">{file.rowCount ?? '-'}</td>
								<td class="py-3 pr-4 text-muted-foreground">{file.headers?.slice(0, 6).join(', ') || '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if cleanedArtifacts.length}
				<div class="grid gap-2 text-sm sm:grid-cols-2">
					{#each cleanedArtifacts as [name, path]}
						<div class="rounded-lg border bg-muted/30 px-3 py-2">
							<p class="font-medium capitalize">{name}</p>
							<p class="mt-1 break-all text-muted-foreground">{path}</p>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
