<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';

	const targetViews = [
		'Full medical costs and exclusions by group',
		'Three-year PPPY actual vs projected costs',
		'Annual medical cost trend',
		'Chronic-condition comorbidity counts',
		'Chronic-condition hierarchy matrix',
		'Medical costs by condition',
		'Chronic-condition prevalence rates',
		'Clinical disease risk acuity profile',
		'ROI and medical cost projections',
		'Key findings and recommendations'
	];
</script>

<Card>
	<CardHeader>
		<CardTitle>Target BI views</CardTitle>
		<CardDescription>Views identified from the support workbook and stakeholder presentation.</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each targetViews as view}
				<div class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
					<BarChart3Icon class="size-4 text-muted-foreground" />
					<span>{view}</span>
				</div>
			{/each}
		</div>
	</CardContent>
</Card>
