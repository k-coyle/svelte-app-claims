<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
</script>

<Card>
	<CardHeader>
		<CardTitle>Reference workbook import</CardTitle>
		<CardDescription>
			Optional comparison path for checking generated dashboard output against a source Excel report.
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
