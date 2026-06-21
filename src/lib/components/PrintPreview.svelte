<script lang="ts">
  import { print } from "../stores/print.svelte";
  import { viewer } from "../stores/viewer.svelte";
  import { gridDescriptor, paperDimensions } from "../utils/print-geometry";
  import { TEMPLATES } from "../utils/print-presets";

  // Fallback available box (px) for headless/initial render before measurement.
  const FALLBACK_AVAIL_W = 480;
  const FALLBACK_AVAIL_H = 600;
  // Inset so the card never touches the column edges.
  const AVAIL_INSET = 48;

  let frameEl = $state<HTMLDivElement | null>(null);
  let availW = $state(FALLBACK_AVAIL_W);
  let availH = $state(FALLBACK_AVAIL_H);

  $effect(() => {
    const el = frameEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      availW = Math.max(1, r.width - AVAIL_INSET);
      availH = Math.max(1, r.height - AVAIL_INSET);
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  const paper = $derived(paperDimensions(print.paperSize, print.orientation));
  const grid = $derived(
    gridDescriptor(print.template, print.paperSize, print.orientation, print.margins),
  );

  // Scale the physical page to fit the available box, preserving aspect ratio.
  const cardSize = $derived.by(() => {
    const ratio = Math.min(availW / paper.widthMm, availH / paper.heightMm);
    return {
      width: paper.widthMm * ratio,
      height: paper.heightMm * ratio,
    };
  });

  const cells = $derived(Array.from({ length: grid.count }, (_, i) => i));
  const objectFitClass = $derived(print.fit === "fill" ? "object-cover" : "object-contain");
  const showFillHelper = $derived(print.fit === "fill" && grid.count > 1);

  // Pages equals copies (each page is the same full layout).
  const pages = $derived(print.copies);

  // Debounced mirror of the page count for the aria-live announcement so a
  // rapidly-changing copies value does not spam screen readers (~300ms).
  let announced = $state("");
  $effect(() => {
    const current = `Page 1 of ${pages}`;
    const timer = setTimeout(() => {
      announced = current;
    }, 300);
    return () => clearTimeout(timer);
  });
</script>

<div
  bind:this={frameEl}
  class="flex h-full min-h-96 w-full flex-col items-center justify-center gap-3 bg-canvas-surround p-6"
  data-testid="print-preview"
>
  <div
    class="bg-white shadow-xl border border-separator rounded-sm overflow-hidden"
    style="width: {cardSize.width}px; height: {cardSize.height}px;"
    data-testid="print-page-card"
    aria-label={`${TEMPLATES[print.template].label} preview`}
  >
    <div
      class="grid h-full w-full"
      style="grid-template-columns: repeat({grid.cols}, 1fr); grid-template-rows: repeat({grid.rows}, 1fr);"
      data-testid="print-cell-grid"
    >
      {#each cells as cell (cell)}
        <div class="flex items-center justify-center overflow-hidden" data-testid="print-cell">
          <!-- Image placed once in the top-left cell only; the rest stay empty. -->
          {#if cell === 0 && viewer.status === "ready" && viewer.source}
            <img
              src={viewer.source}
              alt=""
              class="h-full w-full {objectFitClass}"
              style="transform: rotate({viewer.rotation}deg);"
            />
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if showFillHelper}
    <p class="text-xs text-surface-500" data-testid="print-fill-helper">
      Fill crops to fit cell
    </p>
  {/if}

  <span class="sr-only" aria-live="polite" data-testid="print-page-count">{announced}</span>
</div>
