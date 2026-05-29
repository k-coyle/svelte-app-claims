<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import DatabaseIcon from '@lucide/svelte/icons/database';
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-background">
	<header class="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
		<div class="mx-auto flex max-w-7xl items-center justify-between gap-3">
			<div>
				<p class="text-sm font-semibold">Claims QA console</p>
				<p class="text-xs text-muted-foreground">Upload, validate, run, review</p>
			</div>
			<div
				class="hidden items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground sm:flex"
			>
				<DatabaseIcon class="size-4" />
				Local artifact mode
			</div>
		</div>
	</header>

	<main class="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
		<slot />
	</main>
</div>
