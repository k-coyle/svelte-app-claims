<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import MetricGrid from '$lib/components/analysis/MetricGrid.svelte';
	import RunOverview from '$lib/components/analysis/RunOverview.svelte';
	import WorkflowTimeline from '$lib/components/analysis/WorkflowTimeline.svelte';
	import ClaimsProfileCards from '$lib/components/analysis/ClaimsProfileCards.svelte';
	import BiReportDashboard from '$lib/components/analysis/BiReportDashboard.svelte';
	import RunArtifacts from '$lib/components/analysis/RunArtifacts.svelte';
	import RunHistory from '$lib/components/analysis/RunHistory.svelte';
	import TargetBiViews from '$lib/components/analysis/TargetBiViews.svelte';
	import ReferenceWorkbookImport from '$lib/components/analysis/ReferenceWorkbookImport.svelte';
	import type { AnalysisManifest, ReportSectionsArtifact } from '$lib/analysis/types';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';

	export let data: {
		runs: AnalysisManifest[];
		latest: AnalysisManifest | null;
		reportSections: ReportSectionsArtifact;
	};

	export let form: { ok?: boolean; sessionId?: string; yearCount?: number; error?: string } | null = null;
</script>

<div class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-sm font-medium text-muted-foreground">Claims analysis</p>
			<h1 class="text-2xl font-semibold tracking-tight">BI dashboard</h1>
			<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
				Local analysis artifacts generated from upload sessions. Raw claims are cleaned into canonical files, analyzed by Python, and rendered as dashboard-ready BI sections.
			</p>
		</div>
		<Button href="/upload">Run another upload</Button>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			{form.error}
		</div>
	{/if}

	{#if form?.ok}
		<div class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
			Imported {form.yearCount} report years into session {form.sessionId}.
		</div>
	{/if}

	{#if data.latest}
		<MetricGrid metrics={data.latest.metrics} />
		<WorkflowTimeline run={data.latest} reportSections={data.reportSections} />
		<RunOverview run={data.latest} reportSections={data.reportSections} />

		{#if data.latest.claims}
			<ClaimsProfileCards claims={data.latest.claims} />
		{/if}

		{#if data.latest.report}
			<BiReportDashboard report={data.latest.report} reportSections={data.reportSections} />
		{/if}

		<RunArtifacts run={data.latest} reportSections={data.reportSections} />
	{:else}
		<Card>
			<CardContent class="py-12 text-center">
				<BarChart3Icon class="mx-auto size-8 text-muted-foreground" />
				<h2 class="mt-3 text-lg font-semibold">No analysis artifacts yet</h2>
				<p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
					Confirm an upload to create the first local analysis manifest under <code>var/analysis/</code>.
				</p>
				<Button href="/upload" class="mt-5">Start upload</Button>
			</CardContent>
		</Card>
	{/if}

	<RunHistory runs={data.runs} />
	<TargetBiViews />
	<ReferenceWorkbookImport />
</div>
