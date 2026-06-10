<script lang="ts">
  import { ChevronLeft, ChevronRight } from "@lucide/svelte";
  import GalleryThumb from "./GalleryThumb.svelte";
  import { folder } from "../stores/folder.svelte";
  import { galleryThumbnails } from "../stores/gallery-thumbnails.svelte";
  import { settings } from "../stores/settings.svelte";

  interface Props {
    onSelect?: (index: number) => void | Promise<void>;
  }

  let {
    onSelect = (index: number) => {
      folder.selectIndex(index);
    },
  }: Props = $props();

  const size = $derived(settings.thumbnailSize);
  const thumbnailCount = $derived(settings.thumbnailCount);
  const images = $derived(folder.images);
  const visibleCount = $derived(Math.max(1, thumbnailCount));

  function clampWindowStart(total: number, count: number, currentIndex: number): number {
    if (total <= count) {
      return 0;
    }
    const preferred = Math.max(0, currentIndex - Math.floor(count / 2));
    return Math.min(preferred, total - count);
  }

  $effect(() => {
    const paths = images.map((entry) => entry.path);
    const requestedSize = size;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        galleryThumbnails.prefetchFolder(paths, requestedSize);
      }
    });

    return () => {
      cancelled = true;
    };
  });

  const windowStart = $derived(
    clampWindowStart(images.length, visibleCount, Math.max(0, folder.currentIndex)),
  );
  const windowEnd = $derived(Math.min(images.length, windowStart + visibleCount));

  const visibleItems = $derived(
    images.slice(windowStart, windowEnd).map((entry, offset) => ({
      entry,
      index: windowStart + offset,
    })),
  );

  const canScrollLeft = $derived(windowStart > 0);
  const canScrollRight = $derived(windowEnd < images.length);

  function selectIndex(index: number): void {
    void onSelect(index);
  }
</script>

{#if images.length > 0}
  <section
    class="relative flex h-22 items-center bg-surface-200-800"
    aria-label="Gallery"
  >
    {#if canScrollLeft}
      <button
        type="button"
        class="btn-icon btn-icon-sm preset-tonal absolute left-1 z-10"
        aria-label="Scroll gallery left"
        title="Scroll left"
        onclick={() => selectIndex(Math.max(0, windowStart - 1))}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
    {/if}

    <div class="flex w-full justify-center px-10">
      <div
        class="h-full"
        role="listbox"
        aria-label="Folder images"
        tabindex="-1"
      >
        <div class="flex h-full items-center gap-2 py-2">
          {#each visibleItems as item (item.entry.path)}
            <GalleryThumb
              entry={item.entry}
              index={item.index}
              {size}
              active={item.index === folder.currentIndex}
              onSelect={selectIndex}
            />
          {/each}
        </div>
      </div>
    </div>

    {#if canScrollRight}
      <button
        type="button"
        class="btn-icon btn-icon-sm preset-tonal absolute right-1 z-10"
        aria-label="Scroll gallery right"
        title="Scroll right"
        onclick={() => selectIndex(Math.min(images.length - 1, windowEnd))}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    {/if}
  </section>
{/if}
