<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";
  import { chromeTone } from "../stores/chrome-tone.svelte";
  import { orientationTransform } from "../utils/format";
  import {
    cssColorLuminance,
    sampleRegionLuminance,
  } from "../utils/backdrop-tone";
  import { openPath } from "../utils/open-entry";
  import { sampleImage } from "../ipc";
  import { ZoomPanController } from "../utils/zoom-pan-controller";
  import ContextMenu from "./ContextMenu.svelte";
  import EmptyState from "./states/EmptyState.svelte";
  import ErrorState from "./states/ErrorState.svelte";
  import LoadingState from "./states/LoadingState.svelte";

  interface Props {
    /** Bound out so the toolbar/keyboard can drive zoom/fit actions. */
    controller?: ZoomPanController | null;
    onOpen?: () => void;
    /** In fullscreen the canvas surround goes full black (the image is the hero). */
    fullscreen?: boolean;
    /** Height (px) of the filmstrip overlapping the bottom; reserved by "fit". */
    bottomInset?: number;
  }

  let {
    controller = $bindable(null),
    onOpen,
    fullscreen = false,
    bottomInset = 0,
  }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let contextMenu = $state<ContextMenu | null>(null);

  // Reused offscreen canvas for backdrop sampling (created lazily, browser only).
  let sampleCanvas: HTMLCanvasElement | null = null;
  // Sampling source: a small same-origin data-URL render of the current image
  // fetched from the backend. Asset-protocol URLs taint the canvas and can't be
  // read, so we never sample the displayed <img> directly.
  let samplerImg: HTMLImageElement | null = null;
  let samplerReady = $state(false);

  /**
   * Sample the image brightness behind the toolbar (top-center band) and pick a
   * light/dark glyph tone so icons stay legible over any content. Falls back to
   * the canvas-surround color when no image is shown or the sample is unreadable.
   */
  function sampleToolbarTone(): void {
    if (typeof document === "undefined" || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const surround = getComputedStyle(container).backgroundColor;
    const surroundLum = cssColorLuminance(surround);

    if (viewer.status === "ready" && samplerReady && samplerImg) {
      if (!sampleCanvas) sampleCanvas = document.createElement("canvas");
      const band = {
        x: rect.width * 0.12,
        y: 4,
        w: rect.width * 0.76,
        h: Math.min(64, rect.height),
      };
      const lum = sampleRegionLuminance(
        samplerImg,
        {
          cw: rect.width,
          ch: rect.height,
          natW: viewer.naturalWidth,
          natH: viewer.naturalHeight,
          zoom: viewer.zoom,
          panX: viewer.pan.x,
          panY: viewer.pan.y,
          rotationDeg: viewer.rotation,
          orientation: viewer.orientation,
        },
        band,
        sampleCanvas,
        surround,
      );
      if (lum !== null) {
        chromeTone.toolbarDark = lum < 0.55;
        return;
      }
    }

    // No image / unreadable sample: fall back to the surround brightness.
    if (surroundLum !== null) chromeTone.toolbarDark = surroundLum < 0.55;
  }

  // Preserve the last displayed name while a new image is decoding so the old
  // image does not momentarily get announced with the next image's filename.
  let lastReadyName = $state<string | null>(null);

  // Re-attempt opening the failed image (the path is still on the store).
  function retry(): void {
    if (viewer.path) void openPath(viewer.path);
  }

  // Open the canvas context menu at the cursor on right-click. The menu itself
  // no-ops when no image is loaded.
  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    void contextMenu?.openAt(event.clientX, event.clientY);
  }

  // Shift+F10 is the keyboard equivalent of a context-menu request. The canvas
  // container is non-focusable (role="presentation"), so this is driven from
  // the window-level key handler in App.svelte via the bindable method below;
  // it anchors the menu to the container's center. No-ops without an image.
  export function openContextMenuAtCenter(): void {
    const rect = container?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    void contextMenu?.openAt(cx, cy);
  }

  // Create/destroy the controller alongside the container element.
  $effect(() => {
    if (!container) return;
    const c = new ZoomPanController(container, viewer);
    controller = c;
    return () => {
      c.destroy();
      controller = null;
    };
  });

  // Keep the controller's fit inset in sync with the filmstrip height so a
  // fitted image re-centers above the strip as it appears/resizes.
  $effect(() => {
    controller?.setBottomInset(bottomInset);
  });

  // Fetch a small same-origin (data-URL) render of the current image from the
  // backend and load it as the sampling source.
  $effect(() => {
    const path = viewer.path;
    samplerReady = false;
    samplerImg = null;
    if (typeof Image === "undefined" || !path) return;

    let cancelled = false;
    void sampleImage({ path, size: 96 })
      .then((dataUrl) => {
        if (cancelled) return;
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          if (cancelled) return;
          samplerImg = img;
          samplerReady = true;
        };
        img.src = dataUrl;
      })
      .catch(() => {
        /* sampling unavailable — toolbar falls back to the surround tone */
      });

    return () => {
      cancelled = true;
    };
  });

  // Re-sample the toolbar backdrop when the image or view transform changes.
  // Debounced so panning/zooming doesn't sample every frame.
  $effect(() => {
    const _deps = [
      viewer.status,
      viewer.zoom,
      viewer.pan.x,
      viewer.pan.y,
      viewer.rotation,
      viewer.orientation,
      fullscreen,
      samplerReady,
    ];
    void _deps;
    if (typeof window === "undefined") return;
    const id = window.setTimeout(sampleToolbarTone, 80);
    return () => window.clearTimeout(id);
  });

  function onImageLoad(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    viewer.setReady(img.naturalWidth, img.naturalHeight);
    lastReadyName = viewer.name;
    // Defer the fit to the next frame so layout has settled — a cached/
    // synchronous decode can fire `load` before the container has a real size.
    requestAnimationFrame(() => controller?.fitToScreen());
  }

  function onImageError(): void {
    viewer.setError();
  }

  // The single permitted inline-style use: the JS-driven zoom/pan transform.
  // The EXIF-orientation fragment is appended last so it reorients the image
  // in its own coordinate space, beneath the user's zoom/pan/rotation.
  const transform = $derived(
    [
      `translate(${viewer.pan.x}px, ${viewer.pan.y}px)`,
      `scale(${viewer.zoom})`,
      `rotate(${viewer.rotation}deg)`,
      orientationTransform(viewer.orientation),
    ]
      .filter(Boolean)
      .join(" "),
  );
</script>

<div
  bind:this={container}
  class={`relative flex h-full w-full items-center justify-center overflow-hidden ${fullscreen ? "bg-black" : "bg-canvas-surround"}`}
  data-testid="viewer-canvas"
  oncontextmenu={onContextMenu}
  role="presentation"
>
  {#if viewer.status === "idle"}
    <EmptyState {onOpen} />
  {:else if viewer.status === "error"}
    <ErrorState onRetry={retry} onOpenAnother={onOpen} />
  {:else}
    {#if viewer.status === "loading"}
      <LoadingState />
    {/if}

    {#if viewer.source}
      {#key viewer.source}
        <img
          src={viewer.source}
          alt={(viewer.status === "loading" && viewer.source ? lastReadyName ?? viewer.name : viewer.name) ?? "Image"}
          draggable="false"
          decoding="async"
          class="max-w-none origin-center select-none"
          style="transform: {transform};"
          onload={onImageLoad}
          onerror={onImageError}
        />
      {/key}
    {/if}
  {/if}
</div>

<!--
  Rendered as a sibling of the canvas (not a descendant) on purpose: the canvas
  hosts the ZoomPanController, whose native pointerdown listener calls
  setPointerCapture and would steal clicks from menu items if the menu bubbled
  through it. The menu is position:fixed, so the DOM location is purely about
  event routing.
-->
<ContextMenu bind:this={contextMenu} />
