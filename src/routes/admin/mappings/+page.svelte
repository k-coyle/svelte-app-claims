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
	import SettingsIcon from '@lucide/svelte/icons/settings-2';

	type MappingRow = {
		_id?: string;
		accountId: string;
		fileType: string;
		version: number;
		isActive: boolean;
		createdAt?: string;
		updatedAt?: string;
	};

	export let data: {
		error?: string;
		rows?: MappingRow[];
		filters?: { accountId: string; fileType: string };
	};

	export let form: { ok?: boolean; id?: string; importedFieldCount?: number; error?: string } | null = null;

	const rows = data.rows ?? [];
</script>

<div class="space-y-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-sm font-medium text-muted-foreground">Claims ingestion</p>
			<h1 class="text-2xl font-semibold tracking-tight">Mapping admin</h1>
		</div>
		<Button href="/upload" variant="outline">Back to upload</Button>
	</div>

	{#if data.error}
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			{data.error}
		</div>
	{/if}

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
			{form.error}
		</div>
	{/if}

	{#if form?.ok}
		<div class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
			Mapping saved as {form.id}{form.importedFieldCount ? ` with ${form.importedFieldCount} imported fields` : ''}.
		</div>
	{/if}

	<div class="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
		<Card>
			<CardHeader>
				<CardTitle>Upsert mapping</CardTitle>
				<CardDescription>Stored mappings can be required during upload preview.</CardDescription>
			</CardHeader>
			<CardContent>
				<form method="POST" action="?/save" class="grid gap-4">
					<div class="grid gap-3 md:grid-cols-3">
						<label class="block">
							<span class="text-sm font-medium">Account ID</span>
							<input
								name="accountId"
								class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
								placeholder="clientA"
								required
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium">File type</span>
							<select name="fileType" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required>
								<option value="eligibility">Eligibility</option>
								<option value="medical">Medical Claims</option>
								<option value="pharmacy">Pharmacy Claims</option>
								<option value="vision">Vision Claims</option>
								<option value="dental">Dental Claims</option>
							</select>
						</label>

						<label class="block">
							<span class="text-sm font-medium">Version</span>
							<input
								name="version"
								type="number"
								min="1"
								step="1"
								class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
								required
							/>
						</label>
					</div>

					<label class="block">
						<span class="text-sm font-medium">Mapping JSON</span>
						<textarea
							name="json"
							rows="7"
							class="mt-1 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
							placeholder={'{"MemberID":"member_id","EligibilityStart":"medical_eligibility_start_date"}'}
							required
						></textarea>
					</label>

					<div class="flex flex-wrap items-center justify-between gap-3">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="isActive" class="size-4 rounded border" />
							<span>Set as active for this account and file type</span>
						</label>
						<Button type="submit">Save mapping</Button>
					</div>
				</form>
			</CardContent>
		</Card>

		<div class="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Import CSV mapping</CardTitle>
					<CardDescription>Historical column mapping CSV.</CardDescription>
				</CardHeader>
				<CardContent>
					<form method="POST" action="?/importCsv" enctype="multipart/form-data" class="grid gap-3">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="block">
								<span class="text-sm font-medium">Account ID</span>
								<input
									name="accountId"
									class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
									placeholder="clientB"
									required
								/>
							</label>
							<label class="block">
								<span class="text-sm font-medium">Version</span>
								<input
									name="version"
									type="number"
									min="1"
									step="1"
									class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
									required
								/>
							</label>
						</div>

						<label class="block">
							<span class="text-sm font-medium">File type</span>
							<select name="fileType" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required>
								<option value="medical">Medical Claims</option>
								<option value="pharmacy">Pharmacy Claims</option>
								<option value="eligibility">Eligibility</option>
								<option value="vision">Vision Claims</option>
								<option value="dental">Dental Claims</option>
							</select>
						</label>

						<label class="block">
							<span class="text-sm font-medium">Mapping file</span>
							<input
								name="mappingFile"
								type="file"
								accept=".csv,text/csv"
								class="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
								required
							/>
						</label>

						<div class="flex flex-wrap items-center justify-between gap-3">
							<label class="flex items-center gap-2 text-sm">
								<input type="checkbox" name="isActive" class="size-4 rounded border" checked />
								<span>Set as active</span>
							</label>
							<Button type="submit">Import mapping</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>Limit the local mapping list.</CardDescription>
				</CardHeader>
				<CardContent>
					<form method="GET" class="grid gap-3">
						<label class="block">
							<span class="text-sm font-medium">Account</span>
							<input
								name="accountId"
								value={data.filters?.accountId || ''}
								class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
							/>
						</label>
						<label class="block">
							<span class="text-sm font-medium">File type</span>
							<select name="fileType" class="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
								<option value="" selected={!data.filters?.fileType}>All</option>
								<option value="eligibility" selected={data.filters?.fileType === 'eligibility'}>Eligibility</option>
								<option value="medical" selected={data.filters?.fileType === 'medical'}>Medical</option>
								<option value="pharmacy" selected={data.filters?.fileType === 'pharmacy'}>Pharmacy</option>
								<option value="vision" selected={data.filters?.fileType === 'vision'}>Vision</option>
								<option value="dental" selected={data.filters?.fileType === 'dental'}>Dental</option>
							</select>
						</label>
						<Button type="submit" variant="outline">Apply filters</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Stored mappings</CardTitle>
			<CardDescription>{rows.length} local mapping records.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if rows.length === 0}
				<div class="rounded-lg border border-dashed p-8 text-center">
					<SettingsIcon class="mx-auto size-7 text-muted-foreground" />
					<p class="mt-2 text-sm text-muted-foreground">No mappings saved yet.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-b text-muted-foreground">
							<tr>
								<th class="py-2 pr-4">Account</th>
								<th class="py-2 pr-4">File type</th>
								<th class="py-2 pr-4">Version</th>
								<th class="py-2 pr-4">Status</th>
								<th class="py-2 pr-4">Updated</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row}
								<tr class="border-b last:border-0">
									<td class="py-3 pr-4 font-medium">{row.accountId}</td>
									<td class="py-3 pr-4">{row.fileType}</td>
									<td class="py-3 pr-4">v{row.version}</td>
									<td class="py-3 pr-4">
										<Badge variant={row.isActive ? 'secondary' : 'outline'}>
											{row.isActive ? 'Active' : 'Inactive'}
										</Badge>
									</td>
									<td class="py-3 pr-4">
										{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
