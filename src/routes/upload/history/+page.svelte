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
	import HistoryIcon from '@lucide/svelte/icons/history';

	type UploadRow = {
		createdAt: string;
		accountId: string;
		fileType: string;
		uploaderUserId: string;
		totalBytes: number;
		usedMapping?: string;
		stats?: Array<{ filename: string; bytes: number; rowCount: number | null; mime?: string }>;
	};

	export let data: {
		filters: { accountId: string; fileType: string };
		paging: { page: number; pageSize: number; total: number; pages: number };
		allowedAccounts: Array<{ id: string; name: string }>;
		rows: UploadRow[];
	};

	function fmtMB(bytes: number) {
		return (Number(bytes) / 1048576).toFixed(2);
	}

	function toQuery(nextPage: number) {
		const params = new URLSearchParams();
		if (data.filters.accountId) params.set('accountId', data.filters.accountId);
		if (data.filters.fileType) params.set('fileType', data.filters.fileType);
		params.set('page', String(nextPage));
		params.set('pageSize', String(data.paging.pageSize));
		return `?${params.toString()}`;
	}
</script>

<div class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-sm font-medium text-muted-foreground">Claims ingestion</p>
			<h1 class="text-2xl font-semibold tracking-tight">Upload history</h1>
		</div>
		<Button href="/upload">New upload</Button>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Filters</CardTitle>
			<CardDescription>Search local upload sessions by account and file type.</CardDescription>
		</CardHeader>
		<CardContent>
			<form method="GET" class="grid gap-3 md:grid-cols-4 md:items-end">
				<label class="block">
					<span class="text-sm font-medium">Account</span>
					<select name="accountId" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
						<option value="">All</option>
						{#each data.allowedAccounts as account}
							<option value={account.id} selected={data.filters.accountId === account.id}>{account.name}</option>
						{/each}
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">File type</span>
					<select name="fileType" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
						<option value="">All</option>
						<option value="eligibility" selected={data.filters.fileType === 'eligibility'}>Eligibility</option>
						<option value="medical" selected={data.filters.fileType === 'medical'}>Medical Claims</option>
						<option value="pharmacy" selected={data.filters.fileType === 'pharmacy'}>Pharmacy Claims</option>
						<option value="vision" selected={data.filters.fileType === 'vision'}>Vision Claims</option>
						<option value="dental" selected={data.filters.fileType === 'dental'}>Dental Claims</option>
					</select>
				</label>

				<label class="block">
					<span class="text-sm font-medium">Page size</span>
					<select name="pageSize" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
						{#each [10, 20, 50, 100] as size}
							<option value={size} selected={data.paging.pageSize === size}>{size}</option>
						{/each}
					</select>
				</label>

				<Button type="submit">Apply</Button>
			</form>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between gap-3">
				<div>
					<CardTitle>Sessions</CardTitle>
					<CardDescription>{data.paging.total} total uploads captured locally.</CardDescription>
				</div>
				<Badge variant="outline">Page {data.paging.page} of {data.paging.pages}</Badge>
			</div>
		</CardHeader>
		<CardContent>
			{#if data.rows.length === 0}
				<div class="rounded-lg border border-dashed p-8 text-center">
					<HistoryIcon class="mx-auto size-7 text-muted-foreground" />
					<p class="mt-2 text-sm text-muted-foreground">No uploads found for the selected filters.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b text-muted-foreground">
							<tr>
								<th class="py-2 pr-4">Created</th>
								<th class="py-2 pr-4">Account</th>
								<th class="py-2 pr-4">File type</th>
								<th class="py-2 pr-4">Uploader</th>
								<th class="py-2 pr-4">Files</th>
								<th class="py-2 pr-4">Total</th>
								<th class="py-2 pr-4">First file</th>
							</tr>
						</thead>
						<tbody>
							{#each data.rows as row}
								<tr class="border-b last:border-0">
									<td class="py-3 pr-4">{new Date(row.createdAt).toLocaleString()}</td>
									<td class="py-3 pr-4 font-medium">{row.accountId}</td>
									<td class="py-3 pr-4">
										<Badge variant="secondary">{row.fileType}</Badge>
									</td>
									<td class="py-3 pr-4">{row.uploaderUserId}</td>
									<td class="py-3 pr-4">{Array.isArray(row.stats) ? row.stats.length : 0}</td>
									<td class="py-3 pr-4">{fmtMB(row.totalBytes)} MB</td>
									<td class="py-3 pr-4">{row.stats?.[0]?.filename ?? '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<div class="mt-4 flex items-center justify-between gap-3">
					<p class="text-sm text-muted-foreground">{data.paging.total} total uploads</p>
					<div class="flex gap-2">
						<Button
							href={toQuery(Math.max(1, data.paging.page - 1))}
							variant="outline"
							disabled={data.paging.page <= 1}
						>
							Previous
						</Button>
						<Button
							href={toQuery(Math.min(data.paging.pages, data.paging.page + 1))}
							variant="outline"
							disabled={data.paging.page >= data.paging.pages}
						>
							Next
						</Button>
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
