<script lang="ts">
	import { Card, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { AnalysisMetric } from '$lib/analysis/types';

	export let metrics: AnalysisMetric[] = [];
</script>

<div class="grid gap-4 md:grid-cols-4">
	{#each metrics.slice(0, 4) as metric}
		<Card>
			<CardHeader>
				<CardDescription>{metric.label}</CardDescription>
				<CardTitle class="text-2xl capitalize">{metric.value}</CardTitle>
			</CardHeader>
		</Card>
	{/each}
</div>
