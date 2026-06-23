<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-background">
	<header class="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
		<div class="mx-auto flex max-w-7xl items-center justify-between gap-3">
			<div>
				<p class="text-sm font-semibold">USPM Claims Engine</p>
			</div>
		</div>
	</header>

	<main class="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
		<slot />
	</main>
</div>
