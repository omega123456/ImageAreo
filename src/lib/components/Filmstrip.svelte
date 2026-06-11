<script lang="ts">
  import { tick } from "svelte";
  import FilmstripThumb from "./FilmstripThumb.svelte";
  import { folder } from "../stores/folder.svelte";
  import { galleryThumbnails } from "../stores/gallery-thumbnails.svelte";
  import { settings } from "../stores/settings.svelte";
  import { computeVirtualWindow } from "../utils/horizontal-virtual";
  import { icons, ICON_SIZE, ICON_WEIGHT } from "../icons";

  const PrevIcon = icons.previous;
  const NextIcon = icons.next;

  interface Props {
    onSelect?: (index: number) => void | Promise<void>;
  }

  let {
    onSelect = (index: number) => {
      folder.selectIndex(index);
    },
  }: Props = $props();

  /** Inter-thumb gap, in CSS pixels (matches the gap utility below). */
  const GAP = 6;
  /** Off-screen render buffer (extra items each side of the viewport). */
  const RENDER_BUFFER = 3;

  const images = $derived(folder.images);
  const thumbnailSize = $derived(settings.densityDimensions.thumbnailSize);
  const stripHeight = $derived(settings.densityDimensions.stripHeight);
  /** Per-item horizontal advance: thumbnail box + one gap. */
  const stride = $derived(thumbnailSize + GAP);

  // Measured viewport width (ResizeObserver) + live scroll position drive the
  // windowing math. Scroll position and auto-center use JS-driven scrolling,
  // the permitted imperative escape hatch (like the zoom-pan transform).
  let viewportWidth = $state(0);
  let scrollLeft = $state(0);
  let scroller = $state<HTMLDivElement | null>(null);

  const win = $derived(
    computeVirtualWindow(
      images.length,
      stride,
      scrollLeft,
      viewportWidth,
      RENDER_BUFFER,
    ),
  );

  const visibleItems = $derived(
    images.slice(win.startIndex, win.endIndex + 1).map((entry, offset) => ({
      entry,
      index: win.startIndex + offset,
    })),
  );

  const atStart = $derived(scrollLeft <= 0);
  const atEnd = $derived(
    win.totalWidth > viewportWidth &&
      scrollLeft >= win.totalWidth - viewportWidth - 1,
  );
  const overflows = $derived(win.totalWidth > viewportWidth + 1);

  function measure(node: HTMLDivElement): { destroy: () => void } {
    scroller = node;
    viewportWidth = node.clientWidth;
    scrollLeft = node.scrollLeft;

    const observer = new ResizeObserver(() => {
      viewportWidth = node.clientWidth;
    });
    observer.observe(node);

    return {
      destroy() {
        observer.disconnect();
        if (scroller === node) scroller = null;
      },
    };
  }

  function onScroll(event: Event): void {
    scrollLeft = (event.currentTarget as HTMLDivElement).scrollLeft;
  }

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function nudge(direction: -1 | 1): void {
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * Math.max(stride, viewportWidth * 0.8),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  // Auto-center the active thumb whenever the selection changes. The active
  // index may be outside the rendered window, so center via direct scroll math
  // (windowing keeps the element absent from the DOM until it scrolls in).
  $effect(() => {
    const index = folder.currentIndex;
    void thumbnailSize; // re-center if density (stride) changes
    if (index < 0 || !scroller || viewportWidth <= 0) return;

    const node = scroller;
    const reduced = prefersReducedMotion();
    void tick().then(() => {
      const target = index * stride + thumbnailSize / 2 - viewportWidth / 2;
      const max = Math.max(0, node.scrollWidth - node.clientWidth);
      node.scrollTo({
        left: Math.max(0, Math.min(target, max)),
        behavior: reduced ? "auto" : "smooth",
      });
    });
  });

  // Prefetch every folder thumbnail at the active density pixel size so the
  // windowed slice fills in quickly as the user scrolls.
  $effect(() => {
    const paths = images.map((entry) => entry.path);
    const requestedSize = thumbnailSize;
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

  function selectIndex(index: number): void {
    void onSelect(index);
  }

  // Roving keyboard navigation across the listbox.
  function onKeydown(event: KeyboardEvent): void {
    const last = images.length - 1;
    const current = Math.max(0, folder.currentIndex);
    let next: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        next = Math.min(last, current + 1);
        break;
      case "ArrowLeft":
        next = Math.max(0, current - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (next !== current) selectIndex(next);
    void focusActive();
  }

  async function focusActive(): Promise<void> {
    await tick();
    scroller
      ?.querySelector<HTMLElement>('[role="option"][aria-current="true"]')
      ?.focus();
  }
</script>

{#if images.length > 0}
  <section
    class="group relative flex w-full items-center bg-strip-surface"
    style={`height:${stripHeight}px`}
    aria-label="Filmstrip"
  >
    <!-- Edge-fade affordances (utility gradients, token colors). -->
    {#if overflows && !atStart}
      <div
        class="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-strip-surface to-transparent"
        aria-hidden="true"
      ></div>
    {/if}
    {#if overflows && !atEnd}
      <div
        class="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-strip-surface to-transparent"
        aria-hidden="true"
      ></div>
    {/if}

    <!-- Hover-revealed chevron buttons. -->
    {#if overflows && !atStart}
      <button
        type="button"
        class="btn-icon btn-icon-sm preset-tonal absolute left-1 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Scroll filmstrip left"
        title="Scroll left"
        onclick={() => nudge(-1)}
      >
        <PrevIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
      </button>
    {/if}
    {#if overflows && !atEnd}
      <button
        type="button"
        class="btn-icon btn-icon-sm preset-tonal absolute right-1 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Scroll filmstrip right"
        title="Scroll right"
        onclick={() => nudge(1)}
      >
        <NextIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
      </button>
    {/if}

    <!-- Real horizontal scroll container; vertical overflow stays visible so
         the lifted/scaled active thumb is not clipped by the row. -->
    <div
      use:measure
      onscroll={onScroll}
      role="listbox"
      aria-label="Folder images"
      aria-orientation="horizontal"
      tabindex="-1"
      onkeydown={onKeydown}
      class="scrollbar-thin scrollbar-thumb-surface-400-600 h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-visible scroll-smooth"
    >
      <!-- Full-width spacer establishes the scrollable extent; the rendered
           window is absolutely positioned at the computed offset. py reserves
           headroom for the active lift. -->
      <div
        class="relative h-full"
        style={`width:${win.totalWidth}px`}
      >
        <div
          class="absolute top-0 bottom-0 flex items-center py-2"
          style={`left:${win.offsetLeft}px;gap:${GAP}px`}
        >
          {#each visibleItems as item (item.entry.path)}
            <FilmstripThumb
              entry={item.entry}
              index={item.index}
              size={thumbnailSize}
              active={item.index === folder.currentIndex}
              tabbable={item.index === Math.max(0, folder.currentIndex)}
              onSelect={selectIndex}
            />
          {/each}
        </div>
      </div>
    </div>
  </section>
{/if}
