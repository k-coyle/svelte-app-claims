<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import FileStackIcon from '@lucide/svelte/icons/file-stack';
	import Table2Icon from '@lucide/svelte/icons/table-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	type ReportCellValue = string | number | boolean | null;

	type AnalysisManifest = {
		sessionId: string;
		accountId: string;
		createdAt: string;
		status: string;
		files: Array<{
			filename: string;
			fileType: string;
			rowCount?: number | null;
			headers?: string[] | null;
		}>;
		requirements: Array<{
			key: string;
			label: string;
			status: 'met' | 'needed' | 'optional';
			description: string;
		}>;
		metrics: Array<{
			label: string;
			value: string | number;
			tone?: 'default' | 'good' | 'warning';
		}>;
		python: {
			vendoredRoot: string;
			requirementsFile: string;
			runner: string;
			status: string;
			notes: string[];
		};
		artifacts?: {
			reportSections?: string;
			claimsProfile?: string;
			dashboard?: string;
			manifest?: string;
		};
		mapping?: {
			source: 'stored' | 'provided' | 'none';
			version?: number;
			fields?: Record<string, string>;
		};
		claims?: {
			source: 'uploaded_claims';
			profiledAt: string;
			maxRowsPerFile: number;
			summary: {
				fileCount: number;
				profiledRows: number;
				uniqueMembers: number;
				totalAmount: number | null;
				serviceYears: Array<{ year: string; count: number; amount: number | null }>;
				topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
			};
			files: Array<{
				filename: string;
				fileType: string;
				profiledRows: number;
				totalRows?: number | null;
				mappedFieldCount: number;
				coverage: {
					hasMemberId: boolean;
					hasServiceDate: boolean;
					hasAmount: boolean;
					hasDiagnosis: boolean;
				};
				metrics: {
					uniqueMembers: number;
					totalAmount: number | null;
					averageAmount: number | null;
					minServiceDate: string | null;
					maxServiceDate: string | null;
				};
				serviceYears: Array<{ year: string; count: number; amount: number | null }>;
				topDiagnoses: Array<{ code: string; count: number; amount: number | null }>;
				topPlacesOfService: Array<{ code: string; count: number; amount: number | null }>;
				topRelationships: Array<{ value: string; count: number; amount: number | null }>;
			}>;
		};
		report?: {
			sourceFilename: string;
			yearCount: number;
			sectionCount: number;
			years: Array<{
				sheetName: string;
				analysisYear: number | null;
				medicalTotal: number | null;
				medicalTotalAfterExclusions: number | null;
				pharmacyTotal: number | null;
				fte: number | null;
				medicalPppy: number | null;
				medicalPppyAfterExclusions: number | null;
				exclusionSavings: number | null;
			}>;
			latestYear: {
				analysisYear: number | null;
				medicalTotal: number | null;
				medicalTotalAfterExclusions: number | null;
				medicalPppy: number | null;
				medicalPppyAfterExclusions: number | null;
				exclusionSavings: number | null;
			} | null;
			conditionCosts: Record<string, ReportCellValue>[];
			conditionPrevalence: Record<string, ReportCellValue>[];
			riskProfile: Record<string, ReportCellValue>[];
			availableSections: string[];
		};
	};

	export let data: {
		runs: AnalysisManifest[];
		latest: AnalysisManifest | null;
		reportSections: {
			years?: Array<{
				analysisYear: number;
				sections: Record<string, { rows: Record<string, ReportCellValue>[]; properties?: Record<string, ReportCellValue> }>;
			}>;
			warnings?: string[];
		} | null;
	};

	export let form: { ok?: boolean; sessionId?: string; yearCount?: number; error?: string } | null = null;

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

	function statusLabel(value: string) {
		return value.replaceAll('_', ' ');
	}

	function fmtDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	const money = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});

	const number = new Intl.NumberFormat('en-US', {
		maximumFractionDigits: 1
	});

	function fmtMoney(value: number | null | undefined) {
		return typeof value === 'number' && Number.isFinite(value) ? money.format(value) : '-';
	}

	function fmtNumber(value: ReportCellValue | undefined) {
		if (typeof value === 'number' && Number.isFinite(value)) return number.format(value);
		if (typeof value === 'string' && value.trim()) return value;
		if (typeof value === 'boolean') return value ? 'Yes' : 'No';
		return '-';
	}

	function conditionName(row: Record<string, ReportCellValue>) {
		return String(row.condition_group ?? row.condition ?? row.label ?? '-');
	}

	function coverageLabel(value: boolean) {
		return value ? 'Present' : 'Missing';
	}

	function pctChange(current: number | null | undefined, previous: number | null | undefined) {
		if (typeof current !== 'number' || typeof previous !== 'number' || previous === 0) return '-';
		return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
	}

	function reportYearRows() {
		return data.latest?.report?.years ?? [];
	}

	function latestReportSections() {
		const years = data.reportSections?.years ?? [];
		return years[years.length - 1]?.sections ?? {};
	}

	$: matrixRows = latestReportSections().get_medical__cc_matrix?.rows?.slice(0, 6) ?? [];
	$: matrixColumns = matrixRows.length
		? Object.keys(matrixRows[0]).filter((key) => key !== 'condition_group').slice(0, 6)
		: [];
	$: latestYear = data.latest?.report?.latestYear;
	$: projectedSavings =
		typeof latestYear?.medicalTotalAfterExclusions === 'number'
			? latestYear.medicalTotalAfterExclusions * 0.03
			: null;
</script>

<div class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-sm font-medium text-muted-foreground">Claims analysis</p>
			<h1 class="text-2xl font-semibold tracking-tight">BI dashboard</h1>
			<p class="mt-2 max-w-2xl text-sm text-muted-foreground">
				Local analysis artifacts generated from upload sessions. Deep ETL and BI execution is staged behind the vendored Python adapter.
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
		<div class="grid gap-4 md:grid-cols-4">
			{#each data.latest.metrics.slice(0, 4) as metric}
				<Card>
					<CardHeader>
						<CardDescription>{metric.label}</CardDescription>
						<CardTitle class="text-2xl capitalize">{metric.value}</CardTitle>
					</CardHeader>
				</Card>
			{/each}
		</div>

		<div class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
			<Card>
				<CardHeader>
					<div class="flex items-start justify-between gap-3">
						<div>
							<CardTitle>Latest run</CardTitle>
							<CardDescription>
								Session {data.latest.sessionId} for {data.latest.accountId}
							</CardDescription>
						</div>
						<Badge variant={data.latest.status === 'ready_for_bi' ? 'secondary' : 'outline'}>
							{statusLabel(data.latest.status)}
						</Badge>
					</div>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="grid gap-3 sm:grid-cols-2">
						{#each data.latest.requirements as requirement}
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

		<Card>
				<CardHeader>
					<CardTitle>Pipeline status</CardTitle>
					<CardDescription>Raw upload to dashboard artifact flow.</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="grid gap-2 text-sm sm:grid-cols-5">
						<Badge variant="secondary">Raw upload</Badge>
						<Badge variant={data.latest.mapping?.fields ? 'secondary' : 'outline'}>Mapping</Badge>
						<Badge variant={data.latest.claims ? 'secondary' : 'outline'}>Claims profile</Badge>
						<Badge variant={data.latest.python.status === 'ready' ? 'secondary' : 'outline'}>Python analysis</Badge>
						<Badge variant={data.latest.report ? 'secondary' : 'outline'}>Dashboard data</Badge>
					</div>
				</CardContent>
			</Card>

		{#if data.latest.claims}
			<div class="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div>
								<CardTitle>Uploaded claims profile</CardTitle>
								<CardDescription>
									Scanned up to {data.latest.claims.maxRowsPerFile.toLocaleString()} rows per file from the latest upload.
								</CardDescription>
							</div>
							<ActivityIcon class="size-5 text-muted-foreground" />
						</div>
					</CardHeader>
					<CardContent>
						<div class="overflow-x-auto">
							<table class="w-full text-left text-sm">
								<thead class="border-b text-muted-foreground">
									<tr>
										<th class="py-2 pr-4">File</th>
										<th class="py-2 pr-4">Rows scanned</th>
										<th class="py-2 pr-4">Members</th>
										<th class="py-2 pr-4">Amount</th>
										<th class="py-2 pr-4">Service range</th>
									</tr>
								</thead>
								<tbody>
									{#each data.latest.claims.files as file}
										<tr class="border-b last:border-0">
											<td class="py-3 pr-4 font-medium">{file.filename}</td>
											<td class="py-3 pr-4">{file.profiledRows.toLocaleString()}</td>
											<td class="py-3 pr-4">{file.metrics.uniqueMembers.toLocaleString()}</td>
											<td class="py-3 pr-4">{fmtMoney(file.metrics.totalAmount)}</td>
											<td class="py-3 pr-4 text-muted-foreground">
												{file.metrics.minServiceDate ?? '-'} to {file.metrics.maxServiceDate ?? '-'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Claims readiness</CardTitle>
						<CardDescription>Mapped field coverage from the uploaded claims file.</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each data.latest.claims.files as file}
								<div class="rounded-lg border px-3 py-3 text-sm">
									<p class="font-medium">{file.fileType}</p>
									<p class="mt-1 text-muted-foreground">{file.mappedFieldCount} mapped fields</p>
									<div class="mt-3 grid gap-2">
										<Badge variant={file.coverage.hasMemberId ? 'secondary' : 'outline'}>Member ID {coverageLabel(file.coverage.hasMemberId)}</Badge>
										<Badge variant={file.coverage.hasServiceDate ? 'secondary' : 'outline'}>Service date {coverageLabel(file.coverage.hasServiceDate)}</Badge>
										<Badge variant={file.coverage.hasAmount ? 'secondary' : 'outline'}>Amount {coverageLabel(file.coverage.hasAmount)}</Badge>
										<Badge variant={file.coverage.hasDiagnosis ? 'secondary' : 'outline'}>Diagnosis {coverageLabel(file.coverage.hasDiagnosis)}</Badge>
									</div>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Service-year distribution</CardTitle>
						<CardDescription>Claim volume and amount from uploaded claims.</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-2">
							{#each data.latest.claims.summary.serviceYears as row}
								<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
									<span class="font-medium">{row.year}</span>
									<span class="text-muted-foreground">{row.count.toLocaleString()} claims / {fmtMoney(row.amount)}</span>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Top diagnosis codes</CardTitle>
						<CardDescription>Early clinical signal from mapped ICD columns.</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-2">
							{#each data.latest.claims.summary.topDiagnoses as row}
								<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
									<span class="font-medium">{row.code}</span>
									<span class="text-muted-foreground">{row.count.toLocaleString()} hits / {fmtMoney(row.amount)}</span>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			</div>
		{/if}

		{#if data.latest.report}
			<div class="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardDescription>Annual medical trend</CardDescription>
						<CardTitle>
							{#if reportYearRows().length > 1}
								{pctChange(
									reportYearRows()[reportYearRows().length - 1]?.medicalTotalAfterExclusions,
									reportYearRows()[reportYearRows().length - 2]?.medicalTotalAfterExclusions
								)}
							{:else}
								-
							{/if}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Members with chronic signals</CardDescription>
						<CardTitle>{data.latest.report.conditionPrevalence.length}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Illustrative ROI opportunity</CardDescription>
						<CardTitle>{fmtMoney(projectedSavings)}</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<div class="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div>
								<CardTitle>Three-year medical trend</CardTitle>
								<CardDescription>{data.latest.report.sourceFilename}</CardDescription>
							</div>
							<Table2Icon class="size-5 text-muted-foreground" />
						</div>
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
									{#each data.latest.report.years as year}
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

				<Card>
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div>
								<CardTitle>Medical costs by condition</CardTitle>
								<CardDescription>Latest parsed year, after exclusions.</CardDescription>
							</div>
							<BarChart3Icon class="size-5 text-muted-foreground" />
						</div>
					</CardHeader>
					<CardContent>
						<div class="space-y-2">
							{#each data.latest.report.conditionCosts.slice(0, 6) as row}
								<div class="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 text-sm">
									<div>
										<p class="font-medium">{conditionName(row)}</p>
										<p class="text-muted-foreground">{fmtNumber(row.claimant_count)} claimants</p>
									</div>
									<p class="font-semibold">{fmtMoney(typeof row.total === 'number' ? row.total : Number(row.total))}</p>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			</div>

			<div class="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Chronic-condition prevalence</CardTitle>
						<CardDescription>Top prevalence rows from the latest report year.</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-2">
							{#each data.latest.report.conditionPrevalence.slice(0, 6) as row}
								<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
									<span class="font-medium">{conditionName(row)}</span>
									<span class="text-muted-foreground">{fmtNumber(row.claimant_count ?? row.count)}</span>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div>
								<CardTitle>Risk acuity profile</CardTitle>
								<CardDescription>Clinical grouping rows parsed from the report workbook.</CardDescription>
							</div>
							<ActivityIcon class="size-5 text-muted-foreground" />
						</div>
					</CardHeader>
					<CardContent>
						<div class="space-y-2">
							{#each data.latest.report.riskProfile.slice(0, 6) as row}
								<div class="rounded-lg border px-3 py-2 text-sm">
									<p class="font-medium">{String(row.risk_group ?? row.disease_risk_acuity_profile ?? row.condition_group ?? row.profile ?? '-')}</p>
									<p class="mt-1 text-muted-foreground">
										Claimants {fmtNumber(row.claimant_count ?? row.members ?? row.counts ?? row.count)}
									</p>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			</div>

			{#if matrixRows.length}
				<Card>
					<CardHeader>
						<CardTitle>Chronic-condition hierarchy matrix</CardTitle>
						<CardDescription>Member overlap between top detected condition groups.</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="overflow-x-auto">
							<table class="w-full text-left text-sm">
								<thead class="border-b text-muted-foreground">
									<tr>
										<th class="py-2 pr-4">Condition</th>
										{#each matrixColumns as column}
											<th class="py-2 pr-4">{column}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each matrixRows as row}
										<tr class="border-b last:border-0">
											<td class="py-3 pr-4 font-medium">{conditionName(row)}</td>
											{#each matrixColumns as column}
												<td class="py-3 pr-4">{fmtNumber(row[column])}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</CardContent>
				</Card>
			{/if}

			<Card>
				<CardHeader>
					<CardTitle>Key findings</CardTitle>
					<CardDescription>Auto-generated readout from the latest dashboard artifact.</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="grid gap-2 text-sm md:grid-cols-3">
						<div class="rounded-lg border px-3 py-3">
							<p class="font-medium">Cost baseline</p>
							<p class="mt-1 text-muted-foreground">
								Latest medical cost is {fmtMoney(latestYear?.medicalTotalAfterExclusions ?? latestYear?.medicalTotal)}.
							</p>
						</div>
						<div class="rounded-lg border px-3 py-3">
							<p class="font-medium">Clinical concentration</p>
							<p class="mt-1 text-muted-foreground">
								Top condition rows and diagnosis codes identify where the next care-management review should focus.
							</p>
						</div>
						<div class="rounded-lg border px-3 py-3">
							<p class="font-medium">Demo eligibility</p>
							<p class="mt-1 text-muted-foreground">
								When eligibility is absent, the runner uses claim members as full-year demo eligibility for denominators.
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
		{/if}

		<Card>
				<CardHeader>
					<CardTitle>Vendored Python status</CardTitle>
					<CardDescription>App-owned copy of ETL and BI source is present.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-3 text-sm">
					<div class="rounded-lg border bg-muted/30 p-3">
						<p class="font-medium">Runtime</p>
						<p class="mt-1 text-muted-foreground">Status: {data.latest.python.status}</p>
						<p class="mt-1 text-muted-foreground">Requirements: {data.latest.python.requirementsFile}</p>
					</div>
					{#each data.latest.python.notes as note}
						<p class="rounded-md border px-3 py-2 text-muted-foreground">{note}</p>
					{/each}
				</CardContent>
			</Card>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Files in latest run</CardTitle>
				<CardDescription>{data.latest.files.length} file artifacts captured.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b text-muted-foreground">
							<tr>
								<th class="py-2 pr-4">File</th>
								<th class="py-2 pr-4">Type</th>
								<th class="py-2 pr-4">Rows</th>
								<th class="py-2 pr-4">Headers</th>
							</tr>
						</thead>
						<tbody>
							{#each data.latest.files as file}
								<tr class="border-b last:border-0">
									<td class="py-3 pr-4 font-medium">{file.filename}</td>
									<td class="py-3 pr-4"><Badge variant="secondary">{file.fileType}</Badge></td>
									<td class="py-3 pr-4">{file.rowCount ?? '-'}</td>
									<td class="py-3 pr-4 text-muted-foreground">{file.headers?.slice(0, 6).join(', ') || '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
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

	<Card>
		<CardHeader>
			<CardTitle>Recent analysis runs</CardTitle>
			<CardDescription>Local manifest history for staged ETL and BI integration.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if data.runs.length}
				<div class="space-y-2">
					{#each data.runs as run}
						<div class="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="flex items-center gap-3">
								<FileStackIcon class="size-4 text-muted-foreground" />
								<div>
									<p class="font-medium">{run.accountId} / {run.sessionId}</p>
									<p class="text-sm text-muted-foreground">{fmtDate(run.createdAt)}</p>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Badge variant="outline">{run.files.length} files</Badge>
								<Badge variant={run.status === 'ready_for_bi' ? 'secondary' : 'outline'}>
									{statusLabel(run.status)}
								</Badge>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No analysis runs have been written yet.
				</p>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Target BI views</CardTitle>
			<CardDescription>
				Views identified from the support workbook and stakeholder presentation.
			</CardDescription>
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

	<Card>
		<CardHeader>
			<CardTitle>Reference workbook import</CardTitle>
			<CardDescription>
				Optional legacy-output import for comparing the future BI dashboard against the historical Excel report.
			</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="POST" action="?/importWorkbook" enctype="multipart/form-data" class="grid gap-3 md:grid-cols-[0.55fr_1fr_auto] md:items-end">
				<label class="block">
					<span class="text-sm font-medium">Account ID</span>
					<input
						name="accountId"
						value="clientB"
						class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
						required
					/>
				</label>
				<label class="block">
					<span class="text-sm font-medium">Workbook</span>
					<input
						name="workbook"
						type="file"
						accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
						class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
						required
					/>
				</label>
				<Button type="submit" variant="outline">Import reference</Button>
			</form>
		</CardContent>
	</Card>
</div>
