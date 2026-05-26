<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { asNumber, fmtMoney } from '$lib/analysis/format';
	import type { AnalysisReportSummary, ReportCellValue, ReportSectionsArtifact } from '$lib/analysis/types';
	import HorizontalBarList from './HorizontalBarList.svelte';
	import MatrixHeatmap from './MatrixHeatmap.svelte';
	import ProjectionSummary from './ProjectionSummary.svelte';
	import RiskDistribution from './RiskDistribution.svelte';
	import TrendLineChart from './TrendLineChart.svelte';

	type TrendPoint = {
		label: string;
		value: number | null;
		secondaryValue?: number | null;
		changePct?: number | null;
	};

	export let report: AnalysisReportSummary;
	export let reportSections: ReportSectionsArtifact = null;

	function reportYearRows() {
		return report.years ?? [];
	}

	function latestReportSections() {
		const years = reportSections?.years ?? [];
		return years[years.length - 1]?.sections ?? {};
	}

	$: latestYear = report.latestYear;
	$: dashboard = reportSections?.dashboard;
	$: kpis = dashboard?.kpis ?? {};
	$: matrixRows = (dashboard?.matrix?.length ? dashboard.matrix : latestReportSections().get_medical__cc_matrix?.rows ?? []).slice(0, 6);
	$: matrixColumns = matrixRows.length
		? Object.keys(matrixRows[0]).filter((key) => key !== 'condition_group').slice(0, 6)
		: [];
	$: warnings = reportSections?.validation?.warnings ?? reportSections?.warnings ?? [];
	$: trendPoints = ((dashboard?.trends?.annualMedicalCost ?? []) as Record<string, ReportCellValue>[]).length
		? ((dashboard?.trends?.annualMedicalCost ?? []) as Record<string, ReportCellValue>[]).map(
				(row): TrendPoint => ({
					label: String(row.analysisYear ?? row.sheetName ?? '-'),
					value: asNumber(row.medicalTotalAfterExclusions ?? row.medicalTotal),
					secondaryValue: asNumber(row.medicalPppy),
					changePct: asNumber(row.annualMedicalChangePct)
				})
			)
		: reportYearRows().map(
				(row): TrendPoint => ({
					label: String(row.analysisYear ?? row.sheetName),
					value: row.medicalTotalAfterExclusions ?? row.medicalTotal,
					secondaryValue: row.medicalPppyAfterExclusions ?? row.medicalPppy,
					changePct: null
				})
			);
	$: conditionCosts = dashboard?.rankedLists?.conditionCosts ?? report.conditionCosts;
	$: conditionPrevalence = dashboard?.rankedLists?.conditionPrevalence ?? report.conditionPrevalence;
	$: riskProfile = dashboard?.rankedLists?.riskProfile ?? report.riskProfile;
</script>

<div class="space-y-4">
	<ProjectionSummary kpis={kpis} averageAnnualChangePct={dashboard?.trends?.averageAnnualMedicalChangePct} />

	{#if warnings.length}
		<Card>
			<CardHeader>
				<CardTitle>Analysis completed with warnings</CardTitle>
				<CardDescription>Review before using generated numbers externally.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-2">
					{#each warnings as warning}
						<p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{warning}</p>
					{/each}
				</div>
			</CardContent>
		</Card>
	{/if}

	<div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
		<TrendLineChart
			title="Three-year medical trend"
			description={report.sourceFilename}
			points={trendPoints}
			valueLabel="Medical cost"
			secondaryLabel="PPPY"
		/>
		<HorizontalBarList
			title="Medical costs by condition"
			description="Latest parsed year, after exclusions."
			rows={conditionCosts}
			valueKey="total"
			countKey="claimant_count"
			color="sky"
		/>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<HorizontalBarList
			title="Chronic-condition prevalence"
			description="Top prevalence rows from the latest report year."
			rows={conditionPrevalence}
			valueKey="pct"
			countKey="member_count"
			valueKind="percent"
			color="emerald"
		/>
		<RiskDistribution rows={riskProfile} />
	</div>

	{#if matrixRows.length}
		<MatrixHeatmap rows={matrixRows as Record<string, ReportCellValue>[]} columns={matrixColumns} />
	{/if}

	<Card>
		<CardHeader>
			<CardTitle>Key findings and recommendations</CardTitle>
			<CardDescription>Auto-generated readout from the latest dashboard artifact.</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="grid gap-3 md:grid-cols-3">
				{#each dashboard?.findings ?? [] as finding}
					<div class="rounded-lg border px-3 py-3 text-sm">
						<p class="font-medium">{finding.title}</p>
						<p class="mt-1 text-muted-foreground">{finding.body}</p>
					</div>
				{:else}
					<div class="rounded-lg border px-3 py-3 text-sm">
						<p class="font-medium">Cost baseline</p>
						<p class="mt-1 text-muted-foreground">
							Latest medical cost is {fmtMoney(latestYear?.medicalTotalAfterExclusions ?? latestYear?.medicalTotal)}.
						</p>
					</div>
				{/each}
			</div>
			<div class="mt-4 grid gap-2 text-sm md:grid-cols-3">
				{#each dashboard?.recommendations ?? [] as recommendation}
					<p class="rounded-lg border bg-muted/30 px-3 py-3 text-muted-foreground">{recommendation}</p>
				{/each}
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Yearly report table</CardTitle>
			<CardDescription>Trace values used by the trend chart.</CardDescription>
		</CardHeader>
		<CardContent>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b text-muted-foreground">
						<tr>
							<th class="py-2 pr-4">Year</th>
							<th class="py-2 pr-4">Medical</th>
							<th class="py-2 pr-4">After exclusions</th>
							<th class="py-2 pr-4">PPPY</th>
							<th class="py-2 pr-4">Savings</th>
						</tr>
					</thead>
					<tbody>
						{#each report.years as year}
							<tr class="border-b last:border-0">
								<td class="py-3 pr-4 font-medium">{year.analysisYear ?? year.sheetName}</td>
								<td class="py-3 pr-4">{fmtMoney(year.medicalTotal)}</td>
								<td class="py-3 pr-4">{fmtMoney(year.medicalTotalAfterExclusions)}</td>
								<td class="py-3 pr-4">{fmtMoney(year.medicalPppyAfterExclusions ?? year.medicalPppy)}</td>
								<td class="py-3 pr-4 text-emerald-700">{fmtMoney(year.exclusionSavings)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</CardContent>
	</Card>
</div>
