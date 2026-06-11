<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";
  import { orientationTransform } from "../utils/format";
  import { ZoomPanController } from "../utils/zoom-pan-controller";
  import EmptyState from "./states/EmptyState.svelte";

  interface Props {
    /** Bound out so the toolbar/keyboard can drive zoom/fit actions. */
    controller?: ZoomPanController | null;
    onOpen?: () => void;
  }

  let { controller = $bindable(null), onOpen }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);

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
  class="relative flex h-full w-full items-center justify-center overflow-hidden bg-canvas-surround"
>
  {#if viewer.status === "idle"}
    <EmptyState {onOpen} />
  {:else}
    {#if viewer.status === "loading"}
      <div
        class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        aria-live="polite"
      >
        <div
          class="size-10 animate-spin rounded-full border-2 border-surface-400-600 border-t-primary-500"
          role="status"
          aria-label="Loading image"
        ></div>
      </div>
    {/if}

    <!-- eslint-disable-next-line @typescript-eslint/no-non-null-assertion -->
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
