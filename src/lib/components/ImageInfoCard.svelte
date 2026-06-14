<script lang="ts">
  /**
   * Top-left floating "liquid glass" image-info card.
   *
   * Renders File / Image / Camera groups for the current image, fetching
   * metadata on demand through the `imageInfo` store whenever the card is
   * mounted and `viewer.path` changes (cached per path). Empty rows are omitted
   * and the Camera group is hidden entirely when the image carries no camera
   * EXIF. Loading shows placeholder bars with the group structure intact; a
   * fetch failure shows an inline error row without closing.
   *
   * The card is `role="complementary"` (not a dialog): it never traps or steals
   * focus. Its text/icon tone adapts to the sampled brightness beneath it via
   * `chromeTone.infoDark`, mirroring the toolbar. The current filename is
   * announced through a debounced (~300ms) `aria-live` mirror like ZoomHud, so
   * arrowing through a folder does not spam screen readers. The card reports its
   * bounding rect via `onBoundsChange` (mirroring EnhanceControl) so the parent
   * can feed that region into the adaptive-tone sampling pass.
   *
   * Visibility/transition (fullscreen auto-hide, reduced-motion) is owned by the
   * parent host; this component only renders its content.
   */
  import { ICON_SIZE, icons } from "../icons";
  import { chromeTone } from "../stores/chrome-tone.svelte";
  import { imageInfo } from "../stores/image-info.svelte";
  import { viewer } from "../stores/viewer.svelte";
  import {
    formatAperture,
    formatBitDepth,
    formatColorType,
    formatDateTaken,
    formatDimensions,
    formatFileSize,
    formatFocalLength,
    formatIso,
    formatMegapixels,
    formatOrientation,
    formatShutter,
    isOmitted,
    type Formatted,
  } from "../utils/metadata-format";

  interface Props {
    onBoundsChange?: (rect: DOMRect | null) => void;
  }

  let { onBoundsChange }: Props = $props();
  let rootEl = $state<HTMLElement | null>(null);

  const InfoIcon = icons.info;
  const ErrorIcon = icons.imageError;
  const headingId = "image-info-heading";

  // Fetch on demand: while the card is mounted (i.e. open) and the current
  // image path changes, ensure its metadata is loaded (cached or fetched).
  $effect(() => {
    void imageInfo.ensureLoaded(viewer.path);
  });

  // Debounced mirror of the current filename for the aria-live announcement.
  let announced = $state("");
  $effect(() => {
    const name = viewer.name ?? "";
    const timer = setTimeout(() => {
      announced = name ? `Info updated: ${name}` : "";
    }, 300);
    return () => clearTimeout(timer);
  });

  // Report live bounds to the parent so the viewer can sample the region
  // beneath the card for adaptive tone (mirrors EnhanceControl).
  $effect(() => {
    if (!onBoundsChange) return;
    if (!rootEl) {
      onBoundsChange(null);
      return;
    }

    const publish = (): void => {
      onBoundsChange(rootEl?.getBoundingClientRect() ?? null);
    };

    publish();

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    observer?.observe(rootEl);
    window.addEventListener("resize", publish);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      onBoundsChange(null);
    };
  });

  const meta = $derived(imageInfo.current);
  const loading = $derived(imageInfo.status === "loading");
  const failed = $derived(imageInfo.status === "error");

  interface Row {
    label: string;
    value: Formatted;
    /** True for the path row (rtl truncation + full-path tooltip). */
    path?: boolean;
    /** Full untruncated value, exposed as a hover tooltip when present. */
    title?: string;
  }

  function keep(rows: Row[]): Row[] {
    return rows.filter((row) => !isOmitted(row.value));
  }

  const fileRows = $derived<Row[]>(
    meta
      ? keep([
          { label: "Name", value: meta.fileName ?? "" },
          {
            label: "Path",
            value: meta.filePath ?? "",
            path: true,
            title: meta.filePath ?? "",
          },
          { label: "Format", value: meta.format ?? "" },
          { label: "Size", value: formatFileSize(meta.fileSizeBytes) },
        ])
      : [],
  );

  const imageRows = $derived<Row[]>(
    meta
      ? keep([
          { label: "Dimensions", value: formatDimensions(meta.width, meta.height) },
          { label: "Megapixels", value: formatMegapixels(meta.pixels) },
          { label: "Color", value: formatColorType(meta.colorType) },
          { label: "Bit depth", value: formatBitDepth(meta.bitDepth) },
          { label: "Orientation", value: formatOrientation(meta.orientation) },
        ])
      : [],
  );

  const cameraRows = $derived<Row[]>(
    meta?.camera
      ? keep([
          {
            label: "Camera",
            value: [meta.camera.make, meta.camera.model]
              .filter((part) => part?.trim())
              .join(" "),
          },
          { label: "Lens", value: meta.camera.lens?.trim() ?? "" },
          { label: "ISO", value: formatIso(meta.camera.iso) },
          { label: "Aperture", value: formatAperture(meta.camera.aperture) },
          { label: "Shutter", value: formatShutter(meta.camera.shutterSpeed) },
          { label: "Focal", value: formatFocalLength(meta.camera.focalLength) },
          { label: "Taken", value: formatDateTaken(meta.camera.dateTaken) },
        ])
      : [],
  );

  const hasCamera = $derived(cameraRows.length > 0);

  // Placeholder row labels shown while loading (stable group structure).
  const loadingFile = ["Name", "Path", "Format", "Size"];
  const loadingImage = [
    "Dimensions",
    "Megapixels",
    "Color",
    "Bit depth",
    "Orientation",
  ];

  const glyphClass = $derived(
    chromeTone.infoDark
      ? "text-chrome-glyph-on-dark drop-shadow-glyph"
      : "text-chrome-glyph-on-light",
  );
  const labelClass = $derived(
    chromeTone.infoDark
      ? "text-chrome-glyph-on-dark/60"
      : "text-chrome-glyph-on-light/60",
  );
  const placeholderClass = $derived(
    chromeTone.infoDark ? "bg-chrome-hover-on-dark" : "bg-chrome-hover-on-light",
  );

  const surface =
    "w-72 max-h-screen overflow-y-auto scrollbar-thin scrollbar-thumb-surface-400-600 bg-toolbar-surface ring-glass-highlight rounded-2xl px-3 py-3 shadow-xl ring-1 ring-inset backdrop-blur-xl backdrop-saturate-150";
  const sectionHeaderClass = "text-xs font-semibold tracking-wider uppercase";
  const rowClass = "flex items-baseline justify-between gap-3";
  const dividerClass = "bg-separator h-px w-full my-2";
</script>

<section
  bind:this={rootEl}
  class={`${surface} ${glyphClass}`}
  role="complementary"
  aria-labelledby={headingId}
  data-testid="image-info-card"
>
  <header class="flex items-center gap-2">
    <InfoIcon size={ICON_SIZE} weight="regular" aria-hidden="true" />
    <h2 id={headingId} class="text-sm font-medium">Image info</h2>
  </header>

  {#if failed}
    <div class="mt-3 flex items-center gap-2" role="alert" data-testid="image-info-error">
      <ErrorIcon size={ICON_SIZE} weight="regular" aria-hidden="true" />
      <span class="text-xs font-medium">Could not read metadata</span>
    </div>
  {:else if loading}
    <div class="mt-3">
      <p class={`${sectionHeaderClass} ${labelClass}`}>File</p>
      {#each loadingFile as label (label)}
        <div class={`mt-2 ${rowClass}`}>
          <span class={`shrink-0 text-xs ${labelClass}`}>{label}</span>
          <span
            class={`h-2.5 w-24 animate-pulse rounded-full ${placeholderClass}`}
            data-testid="image-info-placeholder"
            aria-hidden="true"
          ></span>
        </div>
      {/each}
      <div class={dividerClass}></div>
      <p class={`${sectionHeaderClass} ${labelClass}`}>Image</p>
      {#each loadingImage as label (label)}
        <div class={`mt-2 ${rowClass}`}>
          <span class={`shrink-0 text-xs ${labelClass}`}>{label}</span>
          <span
            class={`h-2.5 w-24 animate-pulse rounded-full ${placeholderClass}`}
            data-testid="image-info-placeholder"
            aria-hidden="true"
          ></span>
        </div>
      {/each}
    </div>
  {:else if meta}
    <div class="mt-3" data-testid="image-info-file">
      <p class={`${sectionHeaderClass} ${labelClass}`}>File</p>
      {#each fileRows as row (row.label)}
        <div class={`mt-2 ${rowClass}`}>
          <span class={`shrink-0 text-xs ${labelClass}`}>{row.label}</span>
          <span
            class="min-w-0 truncate text-right text-xs font-medium"
            dir={row.path ? "rtl" : undefined}
            title={row.title}>{row.value}</span
          >
        </div>
      {/each}
    </div>

    <div class={dividerClass}></div>

    <div data-testid="image-info-image">
      <p class={`${sectionHeaderClass} ${labelClass}`}>Image</p>
      {#each imageRows as row (row.label)}
        <div class={`mt-2 ${rowClass}`}>
          <span class={`shrink-0 text-xs ${labelClass}`}>{row.label}</span>
          <span class="min-w-0 truncate text-right text-xs font-medium">{row.value}</span>
        </div>
      {/each}
    </div>

    {#if hasCamera}
      <div class={dividerClass}></div>
      <div data-testid="image-info-camera">
        <p class={`${sectionHeaderClass} ${labelClass}`}>Camera</p>
        {#each cameraRows as row (row.label)}
          <div class={`mt-2 ${rowClass}`}>
            <span class={`shrink-0 text-xs ${labelClass}`}>{row.label}</span>
            <span class="min-w-0 truncate text-right text-xs font-medium">{row.value}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<span class="sr-only" aria-live="polite">{announced}</span>
