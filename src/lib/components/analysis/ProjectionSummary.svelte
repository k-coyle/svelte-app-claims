<script lang="ts">
	import { fmtMoney, fmtNumber } from '$lib/analysis/format';
	import type { ReportCellValue } from '$lib/analysis/types';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import WalletCardsIcon from '@lucide/svelte/icons/wallet-cards';

	export let kpis: Record<string, ReportCellValue> = {};
	export let averageAnnualChangePct: number | undefined;

	function moneyValue(key: string) {
		const value = kpis[key];
		return typeof value === 'number' ? value : null;
	}

	function pctValue(key: string) {
		const value = kpis[key];
		return typeof value === 'number' ? value : null;
	}
</script>

<div class="grid gap-3 md:grid-cols-3">
	<div class="rounded-lg border bg-card p-4">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm text-muted-foreground">Latest medical baseline</p>
				<p class="mt-1 text-2xl font-semibold">{fmtMoney(moneyValue('latestMedicalTotal'))}</p>
			</div>
			<WalletCardsIcon class="size-5 text-sky-700" />
		</div>
	</div>
	<div class="rounded-lg border bg-card p-4">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm text-muted-foreground">Projected next year</p>
				<p class="mt-1 text-2xl font-semibold">{fmtMoney(moneyValue('projectedNextYearMedicalTotal'))}</p>
			</div>
			<TrendingUpIcon class="size-5 text-amber-600" />
		</div>
		<p class="mt-2 text-sm text-muted-foreground">
			Avg trend {typeof averageAnnualChangePct === 'number' ? `${fmtNumber(averageAnnualChangePct)}%` : '-'}
		</p>
	</div>
	<div class="rounded-lg border bg-card p-4">
		<p class="text-sm text-muted-foreground">Illustrative ROI opportunity</p>
		<p class="mt-1 text-2xl font-semibold text-emerald-700">{fmtMoney(moneyValue('illustrativeRoiOpportunity'))}</p>
		<p class="mt-2 text-sm text-muted-foreground">
			YoY {typeof pctValue('annualMedicalChangePct') === 'number' ? `${fmtNumber(pctValue('annualMedicalChangePct'))}%` : '-'}
		</p>
	</div>
</div>
