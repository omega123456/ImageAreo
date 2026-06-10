<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";

  interface Props {
    onToggle?: () => void;
  }

  let { onToggle }: Props = $props();

  // Live label shown in the pill.
  const label = $derived.by(() => {
    if (viewer.fitMode === "fit") return "Fit";
    return `${Math.round(viewer.zoom * 100)}%`;
  });

  // Debounced mirror of the label for the aria-live announcement so continuous
  // wheel zoom does not spam screen readers (~300ms).
  let announced = $state("");

  $effect(() => {
    const current = label;
    const timer = setTimeout(() => {
      announced = current;
    }, 300);
    return () => clearTimeout(timer);
  });
</script>

{#if viewer.status === "ready"}
  <button
    type="button"
    class="absolute right-3 bottom-3 z-10 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white/80 backdrop-blur-sm"
    aria-label="Toggle between actual size and fit to screen"
    title="Toggle 100% / Fit"
    onclick={onToggle}
  >
    {label}
  </button>
  <span class="sr-only" aria-live="polite">Zoom {announced}</span>
{/if}
