<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";
  import { chromeTone } from "../stores/chrome-tone.svelte";
  import { orientationTransform } from "../utils/format";
  import {
    cssColorLuminance,
    rectWithinContainer,
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
    /** Viewport rect of the enhance control, sampled independently from the toolbar. */
    enhanceBounds?: DOMRect | null;
    /** Viewport rect of the floating toolbar, sampled at its actual position. */
    toolbarBounds?: DOMRect | null;
    /** Viewport rect of the Sharpening pill, sampled independently like enhance. */
    sharpenBounds?: DOMRect | null;
  }

  let {
    controller = $bindable(null),
    onOpen,
    fullscreen = false,
    bottomInset = 0,
    enhanceBounds = null,
    toolbarBounds = null,
    sharpenBounds = null,
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
  let sampleLayoutVersion = $state(0);

  function bumpChromeSampleVersion(): void {
    sampleLayoutVersion += 1;
  }

  function sampleTone(rectInContainer: { x: number; y: number; w: number; h: number }): number | null {
    if (!container || !samplerReady || !samplerImg) return null;
    if (!sampleCanvas) sampleCanvas = document.createElement("canvas");
    const surround = getComputedStyle(container).backgroundColor;
    return sampleRegionLuminance(
      samplerImg,
      {
        cw: container.clientWidth,
        ch: container.clientHeight,
        natW: viewer.naturalWidth,
        natH: viewer.naturalHeight,
        zoom: viewer.zoom,
        panX: viewer.pan.x,
        panY: viewer.pan.y,
        rotationDeg: viewer.rotation,
        orientation: viewer.orientation,
      },
      rectInContainer,
      sampleCanvas,
      surround,
    );
  }

  /**
   * Sample the image brightness behind the floating toolbar and enhance control,
   * independently, so each glass surface adapts to the pixels directly under it.
   * Falls back to the canvas-surround color when no image is shown or the sample
   * is unreadable.
   */
  function sampleChromeTone(): void {
    if (typeof document === "undefined" || !container) return;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return;

    const surround = getComputedStyle(container).backgroundColor;
    const surroundLum = cssColorLuminance(surround);

    if (viewer.status === "ready" && samplerReady && samplerImg) {
      const toolbarBand =
        toolbarBounds
          ? rectWithinContainer(toolbarBounds, containerRect)
          : {
              x: containerRect.width * 0.12,
              y: 4,
              w: containerRect.width * 0.76,
              h: Math.min(64, containerRect.height),
            };
      if (toolbarBand) {
        const toolbarLum = sampleTone(toolbarBand);
        if (toolbarLum !== null) {
          chromeTone.toolbarDark = toolbarLum < 0.55;
        } else if (surroundLum !== null) {
          chromeTone.toolbarDark = surroundLum < 0.55;
        }
      } else if (surroundLum !== null) {
        chromeTone.toolbarDark = surroundLum < 0.55;
      }

      if (enhanceBounds) {
        const enhanceRect = rectWithinContainer(enhanceBounds, containerRect);
        if (enhanceRect) {
          const enhanceLum = sampleTone(enhanceRect);
          if (enhanceLum !== null) {
            chromeTone.enhanceDark = enhanceLum < 0.55;
          } else if (surroundLum !== null) {
            chromeTone.enhanceDark = surroundLum < 0.55;
          }
        } else if (surroundLum !== null) {
          chromeTone.enhanceDark = surroundLum < 0.55;
        }
      } else if (surroundLum !== null) {
        chromeTone.enhanceDark = surroundLum < 0.55;
      }

      if (sharpenBounds) {
        const sharpenRect = rectWithinContainer(sharpenBounds, containerRect);
        if (sharpenRect) {
          const sharpenLum = sampleTone(sharpenRect);
          if (sharpenLum !== null) {
            chromeTone.sharpenDark = sharpenLum < 0.55;
          } else if (surroundLum !== null) {
            chromeTone.sharpenDark = surroundLum < 0.55;
          }
        } else if (surroundLum !== null) {
          chromeTone.sharpenDark = surroundLum < 0.55;
        }
      } else if (surroundLum !== null) {
        chromeTone.sharpenDark = surroundLum < 0.55;
      }

      return;
    }

    // No image / unreadable sample: fall back to the surround brightness.
    if (surroundLum !== null) {
      const dark = surroundLum < 0.55;
      chromeTone.toolbarDark = dark;
      chromeTone.enhanceDark = dark;
      chromeTone.sharpenDark = dark;
    }
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

  // The first image can finish loading before the canvas/filmstrip layout has
  // fully settled. Re-sample when the container geometry changes so the
  // floating toolbar picks up the correct backdrop on first open as well.
  $effect(() => {
    if (typeof ResizeObserver === "undefined" || !container) return;
    const observer = new ResizeObserver(() => {
      sampleLayoutVersion += 1;
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  // Keep the controller's fit inset in sync with the filmstrip height so a
  // fitted image re-centers above the strip as it appears/resizes.
  $effect(() => {
    controller?.setBottomInset(bottomInset);
  });

  // Fetch a small same-origin (data-URL) render of the current image from the
  // backend and load it as the sampling source.
  $effect(() => {
    const path = viewer.samplePath ?? viewer.path;
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
          bumpChromeSampleVersion();
        };
        img.src = dataUrl;
      })
      .catch(() => {
        sampleChromeTone();
        /* sampling unavailable — toolbar falls back to the surround tone */
      });

    return () => {
      cancelled = true;
    };
  });

  // Re-sample floating-chrome backdrops when the image, transforms, or control
  // geometry change. Debounced so panning/zooming doesn't sample every frame.
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
      sampleLayoutVersion,
      toolbarBounds?.left,
      toolbarBounds?.top,
      toolbarBounds?.width,
      toolbarBounds?.height,
      enhanceBounds?.left,
      enhanceBounds?.top,
      enhanceBounds?.width,
      enhanceBounds?.height,
      sharpenBounds?.left,
      sharpenBounds?.top,
      sharpenBounds?.width,
      sharpenBounds?.height,
    ];
    void _deps;
    if (typeof window === "undefined") return;
    const id = window.setTimeout(sampleChromeTone, 80);
    return () => window.clearTimeout(id);
  });

  // Report the viewport long edge (CSS px) to the store so the next display
  // open sizes its initial tier to the viewport (#5). Re-published on resize.
  $effect(() => {
    if (typeof ResizeObserver === "undefined" || !container) return;
    const publish = (): void => {
      const rect = container?.getBoundingClientRect();
      if (rect) viewer.setViewportLongEdge(Math.max(rect.width, rect.height));
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(container);
    return () => observer.disconnect();
  });

  // Trigger the on-zoom sharper-tier upgrade. When a zoom-in pushes the
  // displayed resolution past the current viewport tier, the store fetches the
  // 8192 tier and drives the `sharpening` pill. Debounced so a continuous wheel
  // zoom does not fire a request every frame; zoom-out never triggers (the store
  // guards on the displayed long edge exceeding the current tier).
  $effect(() => {
    const _deps = [viewer.status, viewer.zoom, viewer.rotation, viewer.orientation];
    void _deps;
    if (typeof window === "undefined" || !controller) return;
    const ctrl = controller;
    const id = window.setTimeout(() => {
      void viewer.maybeUpgradeTier(ctrl.displayedLongEdgeDevicePx());
    }, 200);
    return () => window.clearTimeout(id);
  });

  function onImageLoad(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    // A seamless tier swap preserves the user's zoom/pan (the store already
    // rescaled zoom for the new intrinsic size); re-fitting would snap the view
    // back to fit, which is the bug we are avoiding.
    const preserveTransform = viewer.consumePreserveTransform();
    viewer.setReady(img.naturalWidth, img.naturalHeight);
    lastReadyName = viewer.name;
    if (preserveTransform) {
      bumpChromeSampleVersion();
      return;
    }
    // Defer the fit to the next frame so layout has settled — a cached/
    // synchronous decode can fire `load` before the container has a real size.
    requestAnimationFrame(() => {
      controller?.applyInitialFit();
      // Even when fit resolves to the current zoom (for example 1:1 images),
      // force one more chrome sample from the final painted state.
      bumpChromeSampleVersion();
    });
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
    <ErrorState
      variant={viewer.errorReason === "limit" ? "limit" : "error"}
      onRetry={retry}
      onOpenAnother={onOpen}
    />
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
