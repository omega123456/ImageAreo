<script lang="ts">
  import { folder } from "../stores/folder.svelte";
  import { updater } from "../stores/updater.svelte";
  import { icons, ICON_SIZE, iconWeightFor } from "../icons";

  interface Props {
    onOpen?: () => void;
    onOpenFolder?: () => void;
    onFit?: () => void;
    onActualSize?: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onToggleFullscreen?: () => void;
    onRotateLeft?: () => void;
    onRotateRight?: () => void;
    onSettings?: () => void;
    onToggleGallery?: () => void;
    galleryVisible?: boolean;
    fullscreen?: boolean;
  }

  let {
    onOpen,
    onOpenFolder,
    onFit,
    onActualSize,
    onZoomIn,
    onZoomOut,
    onToggleFullscreen,
    onRotateLeft,
    onRotateRight,
    onSettings,
    onToggleGallery,
    galleryVisible = true,
    fullscreen = false,
  }: Props = $props();

  const OpenFileIcon = icons.openFile;
  const OpenFolderIcon = icons.openFolder;
  const FitIcon = icons.fit;
  const ActualSizeIcon = icons.actualSize;
  const ZoomInIcon = icons.zoomIn;
  const ZoomOutIcon = icons.zoomOut;
  const FullscreenEnterIcon = icons.fullscreenEnter;
  const FullscreenExitIcon = icons.fullscreenExit;
  const RotateLeftIcon = icons.rotateLeft;
  const RotateRightIcon = icons.rotateRight;
  const FilmstripIcon = icons.filmstrip;
  const SettingsIcon = icons.settings;

  const hasFolder = $derived(folder.images.length > 0);
  const current = $derived(folder.currentIndex + 1);
  const total = $derived(folder.images.length);
  const FullscreenIcon = $derived(fullscreen ? FullscreenExitIcon : FullscreenEnterIcon);
</script>

<header
  class="bg-toolbar-surface flex items-center gap-1 rounded-xl px-2 py-1 shadow-lg backdrop-blur-sm"
>
  <!-- File group -->
  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Open image"
    title="Open image"
    onclick={onOpen}
  >
    <OpenFileIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Open folder"
    title="Open folder"
    onclick={onOpenFolder}
  >
    <OpenFolderIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <div class="bg-separator mx-1 h-5 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- View group -->
  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Fit to screen"
    title="Fit to screen (F)"
    onclick={onFit}
  >
    <FitIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Actual size"
    title="Actual size (1)"
    onclick={onActualSize}
  >
    <ActualSizeIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Zoom in"
    title="Zoom in (+)"
    onclick={onZoomIn}
  >
    <ZoomInIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Zoom out"
    title="Zoom out (−)"
    onclick={onZoomOut}
  >
    <ZoomOutIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Toggle fullscreen"
    aria-pressed={fullscreen}
    title="Toggle fullscreen (F11)"
    onclick={onToggleFullscreen}
  >
    <FullscreenIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <div class="bg-separator mx-1 h-5 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- Rotate group -->
  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Rotate left"
    title="Rotate left (Ctrl+[)"
    onclick={onRotateLeft}
  >
    <RotateLeftIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Rotate right"
    title="Rotate right (Ctrl+])"
    onclick={onRotateRight}
  >
    <RotateRightIcon size={ICON_SIZE} aria-hidden="true" />
  </button>

  <div class="bg-separator mx-1 h-5 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- Filmstrip + settings group -->
  <button
    type="button"
    class="btn-icon btn-icon-sm preset-tonal-surface"
    aria-label="Toggle filmstrip"
    aria-pressed={galleryVisible}
    title="Toggle filmstrip"
    onclick={onToggleGallery}
  >
    <FilmstripIcon
      size={ICON_SIZE}
      weight={iconWeightFor("filmstrip", galleryVisible)}
      aria-hidden="true"
    />
  </button>

  <div class="relative">
    <button
      type="button"
      class="btn-icon btn-icon-sm preset-tonal-surface"
      aria-label="Settings"
      title="Settings"
      onclick={onSettings}
    >
      <SettingsIcon size={ICON_SIZE} aria-hidden="true" />
    </button>
    {#if updater.showBadge}
      <span
        class="pointer-events-none absolute top-0.5 right-0.5 size-2 rounded-full bg-primary-500"
        data-testid="update-badge"
        aria-label="Update available"
      ></span>
    {/if}
  </div>

  {#if hasFolder}
    <span
      class="ml-1 px-1 font-sans text-xs font-medium text-surface-500-500 tabular-nums"
      aria-label="Image position"
    >
      {current} / {total}
    </span>
  {/if}
</header>
