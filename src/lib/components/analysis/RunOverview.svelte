<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { statusLabel } from '$lib/analysis/format';
	import type { AnalysisManifest, ReportSectionsArtifact } from '$lib/analysis/types';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	export let run: AnalysisManifest;
	export let reportSections: ReportSectionsArtifact = null;

	$: validationChecks = reportSections?.validation?.checks ?? [];
</script>

<div class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle>Latest run</CardTitle>
					<CardDescription>Session {run.sessionId} for {run.accountId}</CardDescription>
				</div>
				<Badge variant={run.status === 'ready_for_bi' ? 'secondary' : 'outline'}>
					{statusLabel(run.status)}
				</Badge>
			</div>
		</CardHeader>
		<CardContent>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each run.requirements as requirement}
					<div class="rounded-lg border px-3 py-3">
						<div class="flex items-center justify-between gap-2">
							<p class="font-medium">{requirement.label}</p>
							{#if requirement.status === 'met'}
								<CheckCircle2Icon class="size-4 text-emerald-600" />
							{:else}
								<TriangleAlertIcon class="size-4 text-amber-600" />
							{/if}
						</div>
						<p class="mt-1 text-sm text-muted-foreground">{requirement.description}</p>
						<Badge class="mt-3" variant={requirement.status === 'met' ? 'secondary' : 'outline'}>
							{requirement.status}
						</Badge>
					</div>
				{/each}
			</div>
		</CardContent>
	</Card>

	<div class="space-y-4">
		<Card>
			<CardHeader>
				<CardTitle>Pipeline status</CardTitle>
				<CardDescription>Raw upload to dashboard artifact flow.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="grid gap-2 text-sm sm:grid-cols-2">
					<Badge variant="secondary">Raw upload</Badge>
					<Badge variant={run.mapping?.fields ? 'secondary' : 'outline'}>Mapping</Badge>
					<Badge variant={run.claims ? 'secondary' : 'outline'}>Claims profile</Badge>
					<Badge variant={run.python.status === 'ready' ? 'secondary' : 'outline'}>Python analysis</Badge>
					<Badge variant={run.report ? 'secondary' : 'outline'}>Dashboard data</Badge>
					<Badge variant={run.artifacts?.reportXlsx ? 'secondary' : 'outline'}>Trace XLSX</Badge>
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Data validation</CardTitle>
				<CardDescription>Minimum fields needed for stakeholder BI views.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if validationChecks.length}
					<div class="space-y-2">
						{#each validationChecks as check}
							<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
								<span class="font-medium">{check.label}</span>
								<Badge variant={check.status === 'met' ? 'secondary' : 'outline'}>
									{Math.round(check.coverage * 100)}%
								</Badge>
							</div>
						{/each}
					</div>
				{:else}
					<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
						Validation details will appear after the Python runner completes.
					</p>
				{/if}
			</CardContent>
		</Card>
	</div>
</div>
