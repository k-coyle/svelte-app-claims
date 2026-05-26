<script lang="ts">
	import { fmtNumber } from '$lib/analysis/format';
	import type { ReportCellValue } from '$lib/analysis/types';

	export let rows: Record<string, ReportCellValue>[] = [];

	function label(row: Record<string, ReportCellValue>) {
		return String(row.risk_group ?? row.disease_risk_acuity_profile ?? row.profile ?? 'Unknown');
	}

	function count(row: Record<string, ReportCellValue>) {
		const value = row.counts ?? row.claimant_count ?? row.members ?? row.count;
		return typeof value === 'number' ? value : Number(value ?? 0);
	}

	function color(value: string) {
		const lowered = value.toLowerCase();
		if (lowered.includes('high')) return 'bg-rose-500';
		if (lowered.includes('moderate')) return 'bg-amber-500';
		return 'bg-emerald-600';
	}

	$: visibleRows = rows.slice(0, 6);
	$: total = Math.max(visibleRows.reduce((sum, row) => sum + count(row), 0), 1);
</script>

<div class="rounded-lg border bg-card p-4">
	<div>
		<h3 class="font-semibold">Risk acuity profile</h3>
		<p class="text-sm text-muted-foreground">Clinical distribution from generated report data.</p>
	</div>

	<div class="mt-4 flex h-5 overflow-hidden rounded-full bg-muted">
		{#each visibleRows as row}
			<div class={color(label(row))} style={`width: ${(count(row) / total) * 100}%`}></div>
		{/each}
	</div>

	<div class="mt-4 grid gap-2">
		{#each visibleRows as row}
			<div class="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
				<span class="inline-flex items-center gap-2 font-medium">
					<span class={`size-2 rounded-full ${color(label(row))}`}></span>
					{label(row)}
				</span>
				<span class="text-muted-foreground">{fmtNumber(count(row))} / {fmtNumber(count(row) / total * 100)}%</span>
			</div>
		{:else}
			<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No risk profile rows available.</p>
		{/each}
	</div>
</div>
