<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";
  import { orientationTransform } from "../utils/format";
  import { openPath } from "../utils/open-entry";
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
  }

  let {
    controller = $bindable(null),
    onOpen,
    fullscreen = false,
  }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let contextMenu = $state<ContextMenu | null>(null);

  // The last source that reached the "ready" state. Shown ghosted behind the
  // spinner while the next image decodes, so navigation doesn't flash to empty.
  let lastReadySource = $state<string>("");
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

  function onImageLoad(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    viewer.setReady(img.naturalWidth, img.naturalHeight);
    lastReadySource = viewer.source;
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
      <LoadingState previousSource={lastReadySource} previousName={lastReadyName} />
    {/if}

    <img
      src={viewer.source}
      alt={viewer.name ?? "Image"}
      draggable="false"
      decoding="async"
      class="max-w-none origin-center select-none"
      class:opacity-0={viewer.status !== "ready"}
      style="transform: {transform};"
      onload={onImageLoad}
      onerror={onImageError}
    />
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
