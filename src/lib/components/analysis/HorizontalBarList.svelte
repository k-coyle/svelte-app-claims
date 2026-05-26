<script lang="ts">
	import { conditionName, fmtMoney, fmtNumber } from '$lib/analysis/format';
	import type { ReportCellValue } from '$lib/analysis/types';

	export let title = '';
	export let description = '';
	export let rows: Record<string, ReportCellValue>[] = [];
	export let valueKey = 'total';
	export let countKey = 'claimant_count';
	export let valueKind: 'money' | 'number' | 'percent' = 'money';
	export let limit = 8;
	export let color: 'sky' | 'emerald' | 'amber' | 'rose' = 'sky';

	function numeric(value: ReportCellValue | undefined) {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && value.trim()) {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		return 0;
	}

	function displayValue(value: number) {
		if (valueKind === 'money') return fmtMoney(value);
		if (valueKind === 'percent') return `${fmtNumber(value * 100)}%`;
		return fmtNumber(value);
	}

	function barClass() {
		if (color === 'emerald') return 'bg-emerald-600';
		if (color === 'amber') return 'bg-amber-500';
		if (color === 'rose') return 'bg-rose-500';
		return 'bg-sky-600';
	}

	$: normalizedRows = rows
		.slice(0, limit)
		.map((row) => ({ row, value: numeric(row[valueKey]) }))
		.sort((a, b) => b.value - a.value);
	$: maxValue = Math.max(...normalizedRows.map((row) => row.value), 1);
</script>

<div class="rounded-lg border bg-card p-4">
	<div>
		<h3 class="font-semibold">{title}</h3>
		<p class="text-sm text-muted-foreground">{description}</p>
	</div>

	<div class="mt-4 space-y-3">
		{#each normalizedRows as item}
			<div class="grid gap-1">
				<div class="flex items-center justify-between gap-3 text-sm">
					<div>
						<p class="font-medium">{conditionName(item.row)}</p>
						<p class="text-xs text-muted-foreground">{fmtNumber(item.row[countKey] ?? item.row.member_count ?? item.row.count)} members</p>
					</div>
					<p class="font-semibold">{displayValue(item.value)}</p>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-muted">
					<div class={`h-full rounded-full ${barClass()}`} style={`width: ${Math.max((item.value / maxValue) * 100, 2)}%`}></div>
				</div>
			</div>
		{:else}
			<p class="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No rows available.</p>
		{/each}
	</div>
</div>
