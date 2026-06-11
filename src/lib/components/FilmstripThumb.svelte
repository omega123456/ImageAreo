<script lang="ts">
  import type { ImageEntry } from "../ipc/commands";
  import { galleryThumbnails } from "../stores/gallery-thumbnails.svelte";
  import { icons, ICON_WEIGHT } from "../icons";

  interface Props {
    entry: ImageEntry;
    index: number;
    /** Density-derived thumbnail pixel size (cache key + box size). */
    size: number;
    active: boolean;
    /** Roving tabindex: only the active option is tab-focusable. */
    tabbable?: boolean;
    onSelect: (index: number) => void;
  }

  let { entry, index, size, active, tabbable = false, onSelect }: Props =
    $props();

  // Density pixel sizes map to standard Tailwind size utilities (no bracket
  // values): small 80 -> size-20, medium 128 -> size-32, large 192 -> size-48.
  // A fixed map keeps styling to named utilities only.
  const SIZE_CLASSES: Record<number, string> = {
    80: "size-20",
    128: "size-32",
    192: "size-48",
  };

  // Issue (or reuse) the thumbnail request whenever this thumb is mounted or
  // its identity/size changes. The cache de-duplicates, so re-renders from
  // virtualization recycling never trigger a duplicate backend call. A density
  // change moves to a new `size::path` key, which misses and regenerates at the
  // new pixel size (no old-size fallback, per the design).
  $effect(() => {
    void galleryThumbnails.request(entry.path, size, { priority: true });
  });

  const thumb = $derived(galleryThumbnails.get(entry.path, size));
  const status = $derived(thumb?.status ?? "pending");
  const sizeClass = $derived(SIZE_CLASSES[size] ?? SIZE_CLASSES[192]);
</script>

<button
  type="button"
  role="option"
  aria-selected={active}
  aria-current={active ? "true" : undefined}
  aria-label={entry.name}
  tabindex={tabbable ? 0 : -1}
  data-index={index}
  class={`card preset-tonal-surface ${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-md p-0 outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary-500`}
  class:relative={active}
  class:z-10={active}
  class:scale-125={active}
  class:ring-2={active}
  class:ring-primary-500={active}
  class:ring-offset-2={active}
  class:ring-offset-strip-surface={active}
  class:shadow-2xl={active}
  onclick={() => onSelect(index)}
>
  {#if status === "ready" && thumb?.url}
    <img
      src={thumb.url}
      alt={entry.name}
      class="h-full w-full object-cover"
      draggable="false"
    />
  {:else if status === "error"}
    {@const Broken = icons.imageFailed}
    <Broken
      size={20}
      weight={ICON_WEIGHT.regular}
      class="text-error-500"
      aria-hidden="true"
    />
  {:else}
    <div class="placeholder h-full w-full animate-pulse" aria-hidden="true"></div>
  {/if}
</button>
