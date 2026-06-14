<script lang="ts">
  import { folder } from "../stores/folder.svelte";
  import { updater } from "../stores/updater.svelte";
  import { chromeTone } from "../stores/chrome-tone.svelte";
  import { icons, iconWeightFor } from "../icons";

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
    onToggleInfo?: () => void;
    galleryVisible?: boolean;
    fullscreen?: boolean;
    infoOpen?: boolean;
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
    onToggleInfo,
    galleryVisible = true,
    fullscreen = false,
    infoOpen = false,
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
  const InfoIcon = icons.info;
  const SettingsIcon = icons.settings;

  /** Floating-toolbar icons render slightly larger than the 16px chrome default. */
  const TOOLBAR_ICON_SIZE = 20;

  const hasFolder = $derived(folder.images.length > 0);
  const current = $derived(folder.currentIndex + 1);
  const total = $derived(folder.images.length);
  const FullscreenIcon = $derived(fullscreen ? FullscreenExitIcon : FullscreenEnterIcon);

  // Glyph color adapts to the sampled image brightness behind the toolbar.
  const glyphClass = $derived(
    chromeTone.toolbarDark
      ? "text-chrome-glyph-on-dark drop-shadow-glyph"
      : "text-chrome-glyph-on-light",
  );
  const buttonClass = $derived(
    chromeTone.toolbarDark
      ? "btn-icon hover:bg-chrome-hover-on-dark"
      : "btn-icon hover:bg-chrome-hover-on-light",
  );

  // Selected-toggle chip fill, adapted to the same sampled tone.
  const activeChipClass = $derived(
    chromeTone.toolbarDark ? "bg-chrome-active-on-dark" : "bg-chrome-active-on-light",
  );
</script>

<header
  class="bg-toolbar-surface ring-glass-highlight flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 shadow-xl ring-1 ring-inset backdrop-blur-xl backdrop-saturate-150"
>
  <!-- File group -->
  <button
    type="button"
    class={buttonClass}
    aria-label="Open image"
    title="Open image"
    onclick={onOpen}
  >
    <OpenFileIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class={buttonClass}
    aria-label="Open folder"
    title="Open folder"
    onclick={onOpenFolder}
  >
    <OpenFolderIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <div class="bg-separator mx-1.5 h-6 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- View group -->
  <button
    type="button"
    class={buttonClass}
    aria-label="Fit to screen"
    title="Fit to screen (F)"
    onclick={onFit}
  >
    <FitIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class={buttonClass}
    aria-label="Actual size"
    title="Actual size (1)"
    onclick={onActualSize}
  >
    <ActualSizeIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class={buttonClass}
    aria-label="Zoom in"
    title="Zoom in (+)"
    onclick={onZoomIn}
  >
    <ZoomInIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class={buttonClass}
    aria-label="Zoom out"
    title="Zoom out (−)"
    onclick={onZoomOut}
  >
    <ZoomOutIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class="{buttonClass} {fullscreen ? activeChipClass : ''}"
    aria-label="Toggle fullscreen"
    aria-pressed={fullscreen}
    title="Toggle fullscreen (F11)"
    onclick={onToggleFullscreen}
  >
    <FullscreenIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <div class="bg-separator mx-1.5 h-6 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- Rotate group -->
  <button
    type="button"
    class={buttonClass}
    aria-label="Rotate left"
    title="Rotate left (Ctrl+[)"
    onclick={onRotateLeft}
  >
    <RotateLeftIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <button
    type="button"
    class={buttonClass}
    aria-label="Rotate right"
    title="Rotate right (Ctrl+])"
    onclick={onRotateRight}
  >
    <RotateRightIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
  </button>

  <div class="bg-separator mx-1.5 h-6 w-px" role="separator" aria-orientation="vertical"></div>

  <!-- Filmstrip + settings group -->
  <button
    type="button"
    class="{buttonClass} {galleryVisible ? activeChipClass : ''}"
    aria-label="Toggle filmstrip"
    aria-pressed={galleryVisible}
    title="Toggle filmstrip"
    onclick={onToggleGallery}
  >
    <FilmstripIcon
      size={TOOLBAR_ICON_SIZE}
      weight={iconWeightFor("filmstrip", galleryVisible)}
      aria-hidden="true"
      class={glyphClass}
    />
  </button>

  <button
    type="button"
    class="{buttonClass} {infoOpen ? activeChipClass : ''}"
    aria-label="Image info"
    aria-pressed={infoOpen}
    title="Image info (I)"
    onclick={onToggleInfo}
  >
    <InfoIcon
      size={TOOLBAR_ICON_SIZE}
      weight={iconWeightFor("info", infoOpen)}
      aria-hidden="true"
      class={glyphClass}
    />
  </button>

  <div class="relative">
    <button
      type="button"
      class={buttonClass}
      aria-label="Settings"
      title="Settings"
      onclick={onSettings}
    >
      <SettingsIcon size={TOOLBAR_ICON_SIZE} aria-hidden="true" class={glyphClass} />
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
      class="{glyphClass} ml-1 px-1.5 font-sans text-sm font-medium tabular-nums"
      aria-label="Image position"
    >
      {current} / {total}
    </span>
  {/if}
</header>
