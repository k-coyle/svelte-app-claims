<script lang="ts">
	import { fmtMoney, fmtNumber } from '$lib/analysis/format';

	type TrendPoint = {
		label: string;
		value: number | null;
		secondaryValue?: number | null;
		changePct?: number | null;
	};

	export let title = '';
	export let description = '';
	export let points: TrendPoint[] = [];
	export let valueLabel = 'Medical cost';
	export let secondaryLabel = 'PPPY';

	const width = 720;
	const height = 250;
	const padding = { top: 24, right: 24, bottom: 44, left: 62 };

	function finiteValues(values: Array<number | null | undefined>) {
		return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	}

	function pathFor(values: Array<number | null | undefined>, min: number, max: number) {
		const drawableWidth = width - padding.left - padding.right;
		const drawableHeight = height - padding.top - padding.bottom;
		const spread = Math.max(max - min, 1);
		return values
			.map((value, index) => {
				if (typeof value !== 'number' || !Number.isFinite(value)) return null;
				const x = padding.left + (drawableWidth * index) / Math.max(values.length - 1, 1);
				const y = padding.top + drawableHeight - ((value - min) / spread) * drawableHeight;
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.filter(Boolean)
			.join(' ');
	}

	function pointFor(value: number | null | undefined, index: number, min: number, max: number) {
		const drawableWidth = width - padding.left - padding.right;
		const drawableHeight = height - padding.top - padding.bottom;
		const spread = Math.max(max - min, 1);
		if (typeof value !== 'number' || !Number.isFinite(value)) return null;
		return {
			x: padding.left + (drawableWidth * index) / Math.max(points.length - 1, 1),
			y: padding.top + drawableHeight - ((value - min) / spread) * drawableHeight
		};
	}

	$: values = points.map((point) => point.value);
	$: secondaryValues = points.map((point) => point.secondaryValue);
	$: allValues = finiteValues([...values, ...secondaryValues]);
	$: maxValue = Math.max(...allValues, 1);
	$: minValue = Math.min(...allValues, 0);
	$: primaryPath = pathFor(values, minValue, maxValue);
	$: secondaryPath = pathFor(secondaryValues, minValue, maxValue);
</script>

<div class="rounded-lg border bg-card p-4">
	<div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
		<div>
			<h3 class="font-semibold">{title}</h3>
			<p class="text-sm text-muted-foreground">{description}</p>
		</div>
		<div class="flex gap-3 text-xs text-muted-foreground">
			<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-sky-600"></span>{valueLabel}</span>
			<span class="inline-flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-600"></span>{secondaryLabel}</span>
		</div>
	</div>

	<div class="mt-4 overflow-hidden rounded-md border bg-background">
		<svg viewBox={`0 0 ${width} ${height}`} class="h-[260px] w-full" role="img" aria-label={title}>
			{#each [0, 1, 2, 3] as grid}
				{@const y = padding.top + ((height - padding.top - padding.bottom) * grid) / 3}
				<line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="currentColor" class="text-border" />
			{/each}
			<path d={secondaryPath} fill="none" stroke="currentColor" stroke-width="3" class="text-emerald-600" stroke-linecap="round" stroke-linejoin="round" />
			<path d={primaryPath} fill="none" stroke="currentColor" stroke-width="3" class="text-sky-600" stroke-linecap="round" stroke-linejoin="round" />

			{#each points as point, index}
				{@const primary = pointFor(point.value, index, minValue, maxValue)}
				{@const secondary = pointFor(point.secondaryValue, index, minValue, maxValue)}
				{#if secondary}
					<circle cx={secondary.x} cy={secondary.y} r="4" fill="currentColor" class="text-emerald-600" />
				{/if}
				{#if primary}
					<circle cx={primary.x} cy={primary.y} r="4" fill="currentColor" class="text-sky-600" />
				{/if}
				<text x={padding.left + ((width - padding.left - padding.right) * index) / Math.max(points.length - 1, 1)} y={height - 17} text-anchor="middle" class="fill-muted-foreground text-[12px]">
					{point.label}
				</text>
			{/each}
		</svg>
	</div>

	<div class="mt-3 grid gap-2 sm:grid-cols-3">
		{#each points as point}
			<div class="rounded-md border bg-muted/30 px-3 py-2 text-sm">
				<p class="font-medium">{point.label}</p>
				<p class="mt-1 text-muted-foreground">{fmtMoney(point.value)} / {fmtMoney(point.secondaryValue)}</p>
				<p class="text-muted-foreground">YoY {typeof point.changePct === 'number' ? `${fmtNumber(point.changePct)}%` : '-'}</p>
			</div>
		{/each}
	</div>
</div>
