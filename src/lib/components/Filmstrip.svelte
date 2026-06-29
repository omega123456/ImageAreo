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
  /** Active thumb scale factor (matches `scale-125` on the active thumb). */
  const ACTIVE_SCALE = 1.25;
  /** Prefetch band: ±this many thumbnails around the current index. */
  const PREFETCH_BAND = 50;

  const images = $derived(folder.images);
  const thumbnailSize = $derived(settings.densityDimensions.thumbnailSize);
  const stripHeight = $derived(settings.densityDimensions.stripHeight);
  /** Per-item horizontal advance: thumbnail box + one gap. */
  const stride = $derived(thumbnailSize + GAP);
  /** Extra height the active thumb gains on each side when scaled (it grows
   *  from its center). Reserved as top+bottom padding so the active thumb is
   *  never clipped and the rail height stays fixed across selections. */
  const activeGrowth = $derived(
    Math.ceil(((ACTIVE_SCALE - 1) / 2) * thumbnailSize) + 4,
  );

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
      scrollLeft - activeGrowth,
      viewportWidth,
      RENDER_BUFFER,
    ),
  );

  // Leading + trailing inset so the scaled active thumb at either end has room
  // to grow sideways instead of being clipped by the scroll container edge.
  const contentWidth = $derived(win.totalWidth + activeGrowth * 2);

  const visibleItems = $derived(
    images.slice(win.startIndex, win.endIndex + 1).map((entry, offset) => ({
      entry,
      index: win.startIndex + offset,
    })),
  );

  const atStart = $derived(scrollLeft <= 0);
  const atEnd = $derived(
    contentWidth > viewportWidth &&
      scrollLeft >= contentWidth - viewportWidth - 1,
  );
  const overflows = $derived(contentWidth > viewportWidth + 1);

  // Map vertical wheel input onto the horizontal axis so a plain mouse wheel
  // scrolls the strip. Registered non-passive so preventDefault is honored
  // (Svelte marks `wheel` listeners passive by default).
  function onWheel(event: WheelEvent): void {
    // Only translate vertical wheel into horizontal scroll; horizontal (trackpad)
    // gestures already scroll the row natively, so leave them to keep momentum.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    const node = event.currentTarget as HTMLDivElement;
    // Normalize line/page wheel deltas (mouse wheels report deltaMode 1) into
    // pixels so a notch advances a meaningful distance, not a single pixel.
    const unit =
      event.deltaMode === 1 ? stride : event.deltaMode === 2 ? node.clientWidth : 1;
    node.scrollLeft += event.deltaY * unit;
  }

  function measure(node: HTMLDivElement): { destroy: () => void } {
    scroller = node;
    viewportWidth = node.clientWidth;
    scrollLeft = node.scrollLeft;

    const observer = new ResizeObserver(() => {
      viewportWidth = node.clientWidth;
    });
    observer.observe(node);
    node.addEventListener("wheel", onWheel, { passive: false });

    return {
      destroy() {
        observer.disconnect();
        node.removeEventListener("wheel", onWheel);
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

  // The selection index we last auto-centered on. Centering is keyed strictly
  // to this: only a selection change (arrow keys / click) re-centers. Scrolling,
  // resize, and density changes re-run this effect too (they touch `viewport`,
  // `stride`, and the `contentWidth` dependency), but must NOT yank the view
  // back to the active thumb — so anything other than an index change bails.
  let lastCenteredIndex = -1;

  // Auto-center the active thumb when the selection changes. The active index
  // may be outside the rendered window, so center via direct scroll math
  // (windowing keeps the element absent from the DOM until it scrolls in).
  $effect(() => {
    const index = folder.currentIndex;
    const node = scroller;
    // Read layout inputs so the math reflects the current density/viewport, but
    // these are NOT re-center triggers — only the index is (see guard below).
    const viewport = viewportWidth;
    const itemStride = stride;
    const growth = activeGrowth;
    const half = thumbnailSize / 2;
    const max = Math.max(0, contentWidth - viewport);
    if (index < 0 || !node || viewport <= 0) return;

    // Only re-center on an actual selection change. Bail for every other reason
    // the effect re-ran (scroll, resize, density) so the strip stays exactly
    // where the user scrolled it.
    if (index === lastCenteredIndex) return;
    lastCenteredIndex = index;

    void tick().then(() => {
      const target = growth + index * itemStride + half - viewport / 2;
      // Instant (not smooth) so rapid arrow-key navigation tracks the selection
      // without queued animations lagging behind.
      node.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: "auto" });
    });
  });

  // Identity of the last folder we prefetched for. A change means a folder
  // switch, which must reset the thumbnail cache under a new generation token
  // (so a slow prior-folder thumbnail cannot repopulate it after the clear).
  let lastFolderImages: typeof images | null = null;

  // Prefetch only the band of thumbnails around the current index (±PREFETCH_BAND)
  // at the active density pixel size, rather than the whole folder. The band
  // re-prefetches as the selection (window) moves; thumbnails outside the band
  // load lazily on scroll via FilmstripThumb's own request.
  $effect(() => {
    const folderImages = images;
    const paths = folderImages.map((entry) => entry.path);
    const requestedSize = thumbnailSize;
    const center = folder.currentIndex;
    let cancelled = false;

    if (folderImages !== lastFolderImages) {
      lastFolderImages = folderImages;
      galleryThumbnails.newGeneration();
    }

    queueMicrotask(() => {
      if (!cancelled) {
        galleryThumbnails.prefetchWindow(
          paths,
          center,
          requestedSize,
          PREFETCH_BAND,
        );
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

    // Stop the bubble to the window-level key handler, which would also advance
    // the selection (double navigation).
    event.preventDefault();
    event.stopPropagation();
    if (next !== current) selectIndex(next);
    void focusActive();
  }

  async function focusActive(): Promise<void> {
    await tick();
    scroller
      ?.querySelector<HTMLElement>('[role="option"][aria-current="true"]')
      ?.focus({ preventScroll: true });
  }
</script>

{#if images.length > 0}
  <section
    class="group ring-glass-highlight relative flex w-full items-center bg-strip-surface ring-1 ring-inset backdrop-blur-xl backdrop-saturate-150"
    style={`height:${stripHeight + activeGrowth * 2}px`}
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
        class="btn-icon btn-icon-sm preset-tonal absolute left-1 top-1/2 z-20 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
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
        class="btn-icon btn-icon-sm preset-tonal absolute right-1 top-1/2 z-20 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Scroll filmstrip right"
        title="Scroll right"
        onclick={() => nudge(1)}
      >
        <NextIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
      </button>
    {/if}

    <!-- Real horizontal scroll container; the row is centered and the section
         reserves `activeGrowth` of vertical padding on each side so the scaled
         active thumb grows symmetrically without clipping or shifting the row. -->
    <div
      use:measure
      onscroll={onScroll}
      role="listbox"
      aria-label="Folder images"
      aria-orientation="horizontal"
      tabindex="-1"
      onkeydown={onKeydown}
      class="scrollbar-thin scrollbar-thumb-surface-400-600 h-full w-full overflow-x-auto overflow-y-visible"
    >
      <!-- Full-width spacer establishes the scrollable extent; the rendered
           window is absolutely positioned at the computed offset. -->
      <div
        class="relative h-full"
        style={`width:${contentWidth}px`}
      >
        <div
          class="absolute top-0 bottom-0 flex items-center"
          style={`left:${win.offsetLeft + activeGrowth}px;gap:${GAP}px`}
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
