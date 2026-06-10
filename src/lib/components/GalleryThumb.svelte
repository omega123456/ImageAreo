<script lang="ts">
  import { ImageOff } from "@lucide/svelte";
  import type { ImageEntry } from "../ipc/commands";
  import { galleryThumbnails } from "../stores/gallery-thumbnails.svelte";

  interface Props {
    entry: ImageEntry;
    index: number;
    size: number;
    active: boolean;
    onSelect: (index: number) => void;
  }

  let { entry, index, size, active, onSelect }: Props = $props();
  const SIZE_CLASSES: Record<number, string> = {
    48: "h-12 w-12",
    64: "h-16 w-16",
    80: "h-20 w-20",
    96: "h-24 w-24",
    120: "h-30 w-30",
  };

  // Issue (or reuse) the thumbnail request whenever this thumb is mounted or
  // its identity/size changes. The cache de-duplicates, so re-renders from
  // virtualization recycling never trigger a duplicate backend call.
  $effect(() => {
    void galleryThumbnails.request(entry.path, size);
  });

  const thumb = $derived(galleryThumbnails.get(entry.path, size));
  const status = $derived(thumb?.status ?? "pending");
  const sizeClass = $derived(SIZE_CLASSES[size] ?? SIZE_CLASSES[120]);
</script>

<button
  type="button"
  class={`card preset-tonal-surface ${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-md p-0 transition-transform`}
  class:ring-2={active}
  class:ring-primary-400={active}
  class:scale-105={active}
  aria-label={entry.name}
  aria-current={active ? "true" : undefined}
  onclick={() => onSelect(index)}
>
  {#if status === "ready" && thumb?.dataUrl}
    <img
      src={thumb.dataUrl}
      alt={entry.name}
      class="h-full w-full object-cover"
      draggable="false"
    />
  {:else if status === "error"}
    <ImageOff size={20} class="text-error-400" aria-hidden="true" />
  {:else}
    <div class="placeholder h-full w-full animate-pulse" aria-hidden="true"></div>
  {/if}
</button>
