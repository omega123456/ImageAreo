<script lang="ts">
  import {
    FolderOpen,
    ZoomIn,
    ZoomOut,
    Maximize2,
    ScanSearch,
    Settings2,
    PanelBottomClose,
    PanelBottomOpen,
    RotateCcw,
    RotateCw,
  } from "@lucide/svelte";

  interface Props {
    onOpen?: () => void;
    onOpenFolder?: () => void;
    onFit?: () => void;
    onActualSize?: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onRotateLeft?: () => void;
    onRotateRight?: () => void;
    onSettings?: () => void;
    onToggleGallery?: () => void;
    galleryVisible?: boolean;
  }

  let {
    onOpen,
    onOpenFolder,
    onFit,
    onActualSize,
    onZoomIn,
    onZoomOut,
    onRotateLeft,
    onRotateRight,
    onSettings,
    onToggleGallery,
    galleryVisible = true,
  }: Props = $props();
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

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Open folder"
    title="Open folder"
    onclick={onOpenFolder}
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

  <div class="mx-1 h-5 w-px bg-surface-300-700" role="separator" aria-orientation="vertical"></div>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Rotate left"
    title="Rotate left (Ctrl+[)"
    onclick={onRotateLeft}
  >
    <RotateCcw size={16} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Rotate right"
    title="Rotate right (Ctrl+])"
    onclick={onRotateRight}
  >
    <RotateCw size={16} aria-hidden="true" />
  </button>

  <div class="mx-1 h-5 w-px bg-surface-300-700" role="separator" aria-orientation="vertical"></div>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Toggle gallery"
    aria-pressed={galleryVisible}
    title="Toggle gallery"
    onclick={onToggleGallery}
  >
    {#if galleryVisible}
      <PanelBottomClose size={16} aria-hidden="true" />
    {:else}
      <PanelBottomOpen size={16} aria-hidden="true" />
    {/if}
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal"
    aria-label="Settings"
    title="Settings"
    onclick={onSettings}
  >
    <Settings2 size={16} aria-hidden="true" />
  </button>
</header>
