<script lang="ts">
	import { page } from '$app/stores';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Button } from '$lib/components/ui/button';
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';

	let { children } = $props();

	const navItems = [
		{ label: 'Dashboard', href: '/', icon: LayoutDashboardIcon },
		{ label: 'Upload', href: '/upload', icon: UploadIcon },
		{ label: 'History', href: '/upload/history', icon: HistoryIcon },
		{ label: 'Mappings', href: '/admin/mappings', icon: SettingsIcon }
	];

	function isActive(href: string, pathname: string) {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-background">
	<div class="flex min-h-screen">
		<aside class="hidden w-64 shrink-0 border-r bg-card lg:block">
			<div class="border-b px-5 py-5">
				<p class="text-xs font-medium uppercase text-muted-foreground">Claims Ops</p>
				<p class="mt-1 text-sm font-semibold">Ingestion Demo</p>
			</div>
			<nav class="space-y-1 px-3 py-4">
				{#each navItems as item}
					{@const active = isActive(item.href, $page.url.pathname)}
					{@const Icon = item.icon}
					<Button
						href={item.href}
						variant="ghost"
						class={`w-full justify-start gap-2 ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
					>
						<Icon class="size-4" />
						<span>{item.label}</span>
					</Button>
				{/each}
			</nav>
			<div class="mx-3 mt-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
				Local demo mode is active. Upload sessions, mappings, and queued jobs persist under <code>var/</code>.
			</div>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
				<div class="mx-auto flex max-w-6xl items-center justify-between gap-3">
					<div>
						<p class="text-sm font-semibold">Claims ingestion workspace</p>
						<p class="text-xs text-muted-foreground">Preview, queue, and review files without DB access</p>
					</div>
					<div class="flex gap-2 lg:hidden">
					{#each navItems as item}
						{@const Icon = item.icon}
						<Button href={item.href} variant="outline" size="icon" aria-label={item.label}>
							<Icon class="size-4" />
						</Button>
					{/each}
					</div>
				</div>
			</header>

			<main class="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 lg:px-6">
				{@render children?.()}
			</main>
		</div>
	</div>
</div>
