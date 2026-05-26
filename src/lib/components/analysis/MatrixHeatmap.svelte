<script lang="ts">
	import { conditionName, fmtNumber } from '$lib/analysis/format';
	import type { ReportCellValue } from '$lib/analysis/types';

	export let rows: Record<string, ReportCellValue>[] = [];
	export let columns: string[] = [];

	function numeric(value: ReportCellValue | undefined) {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string' && value.trim()) {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		return 0;
	}

	function intensity(value: number) {
		if (maxValue <= 0) return 0;
		return Math.max(value / maxValue, 0);
	}

	function cellStyle(value: number) {
		const alpha = 0.08 + intensity(value) * 0.62;
		return `background-color: rgba(14, 116, 144, ${alpha.toFixed(3)});`;
	}

	$: visibleRows = rows.slice(0, 7);
	$: visibleColumns = columns.slice(0, 7);
	$: maxValue = Math.max(...visibleRows.flatMap((row) => visibleColumns.map((column) => numeric(row[column]))), 1);
</script>

<div class="rounded-lg border bg-card p-4">
	<div>
		<h3 class="font-semibold">Chronic-condition hierarchy matrix</h3>
		<p class="text-sm text-muted-foreground">Member overlap between top detected condition groups.</p>
	</div>

	{#if visibleRows.length && visibleColumns.length}
		<div class="mt-4 overflow-x-auto">
			<table class="w-full min-w-[640px] text-left text-sm">
				<thead class="border-b text-muted-foreground">
					<tr>
						<th class="py-2 pr-4">Condition</th>
						{#each visibleColumns as column}
							<th class="max-w-28 truncate py-2 pr-2" title={column}>{column}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each visibleRows as row}
						<tr class="border-b last:border-0">
							<td class="max-w-48 truncate py-2 pr-4 font-medium" title={conditionName(row)}>{conditionName(row)}</td>
							{#each visibleColumns as column}
								{@const value = numeric(row[column])}
								<td class="py-2 pr-2">
									<div class="rounded px-2 py-1 text-center font-medium text-slate-950" style={cellStyle(value)}>
										{fmtNumber(value)}
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="mt-4 rounded-md border border-dashed p-4 text-sm text-muted-foreground">No matrix rows available.</p>
	{/if}
</div>
