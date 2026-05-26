<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { coverageLabel, fmtMoney } from '$lib/analysis/format';
	import type { ClaimsProfile } from '$lib/analysis/types';
	import ActivityIcon from '@lucide/svelte/icons/activity';

	export let claims: ClaimsProfile;
</script>

<div class="space-y-4">
	<div class="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
		<Card>
			<CardHeader>
				<div class="flex items-start justify-between gap-3">
					<div>
						<CardTitle>Uploaded claims profile</CardTitle>
						<CardDescription>
							Scanned up to {claims.maxRowsPerFile.toLocaleString()} rows per file from the latest upload.
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
							{#each claims.files as file}
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
					{#each claims.files as file}
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
					{#each claims.summary.serviceYears as row}
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
					{#each claims.summary.topDiagnoses as row}
						<div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
							<span class="font-medium">{row.code}</span>
							<span class="text-muted-foreground">{row.count.toLocaleString()} hits / {fmtMoney(row.amount)}</span>
						</div>
					{:else}
						<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
							No diagnosis codes were detected in the profiled rows.
						</p>
					{/each}
				</div>
			</CardContent>
		</Card>
	</div>
</div>
