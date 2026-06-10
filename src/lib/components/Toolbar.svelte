<script lang="ts">
  import { FolderOpen, ZoomIn, ZoomOut, Maximize2, ScanSearch } from "@lucide/svelte";

  interface Props {
    onOpen?: () => void;
    onFit?: () => void;
    onActualSize?: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
  }

  let { onOpen, onFit, onActualSize, onZoomIn, onZoomOut }: Props = $props();
</script>

<header class="flex h-10 items-center gap-1 bg-surface-100-900 px-3">
  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Open image"
    title="Open image"
    onclick={onOpen}
  >
    <FolderOpen size={16} aria-hidden="true" />
  </button>

  <div class="mx-1 h-5 w-px bg-surface-300-700" role="separator" aria-orientation="vertical"></div>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Fit to screen"
    title="Fit to screen (F)"
    onclick={onFit}
  >
    <Maximize2 size={16} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Actual size"
    title="Actual size (1)"
    onclick={onActualSize}
  >
    <ScanSearch size={16} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Zoom in"
    title="Zoom in (+)"
    onclick={onZoomIn}
  >
    <ZoomIn size={16} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Zoom out"
    title="Zoom out (−)"
    onclick={onZoomOut}
  >
    <ZoomOut size={16} aria-hidden="true" />
  </button>
</header>
