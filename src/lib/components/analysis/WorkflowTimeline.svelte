<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import type { AnalysisManifest, ReportSectionsArtifact } from '$lib/analysis/types';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';

	export let run: AnalysisManifest;
	export let reportSections: ReportSectionsArtifact = null;

	$: steps = [
		{ label: 'Raw upload', done: run.files.length > 0 },
		{ label: 'Mapping', done: Boolean(run.mapping?.fields) },
		{ label: 'Canonical cleaning', done: Boolean(reportSections?.cleanedArtifacts && Object.keys(reportSections.cleanedArtifacts).length) },
		{ label: 'Python analysis', done: run.python.status === 'ready' },
		{ label: 'BI dashboard', done: Boolean(run.report) },
		{ label: 'Trace workbook', done: Boolean(run.artifacts?.reportXlsx || reportSections?.xlsxReportPath) }
	];
</script>

<div class="rounded-lg border bg-card p-4">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h3 class="font-semibold">Analysis pipeline</h3>
			<p class="text-sm text-muted-foreground">Raw claims to dashboard artifact status.</p>
		</div>
		<Badge variant={run.status === 'ready_for_bi' ? 'secondary' : 'outline'}>{run.status.replaceAll('_', ' ')}</Badge>
	</div>
	<div class="mt-4 grid gap-2 md:grid-cols-6">
		{#each steps as step}
			<div class="rounded-md border bg-muted/30 px-3 py-2 text-sm">
				<div class="flex items-center justify-between gap-2">
					<span class="font-medium">{step.label}</span>
					{#if step.done}
						<CheckCircle2Icon class="size-4 text-emerald-600" />
					{:else}
						<CircleDashedIcon class="size-4 text-muted-foreground" />
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
