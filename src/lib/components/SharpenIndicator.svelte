<script lang="ts">
  /**
   * The "Sharpening…" pill. After a zoom-in pushes the displayed resolution past
   * the current viewport tier, the viewer store fetches a sharper (8192) tier in
   * the background (`viewer.sharpening`). This pill surfaces that work, but only
   * when it is slow enough to matter:
   *
   *  - It appears only after a short debounce (~350ms), so fast upgrades stay
   *    silent and the pill never flashes on quick zooms.
   *  - It dismisses ~400ms after the sharper tile has loaded and painted (the
   *    store clears `sharpening`), avoiding an abrupt disappearance.
   *  - It never appears on zoom-out (the store only sets `sharpening` for a
   *    zoom-in that crosses the tier).
   *
   * It is visually identical to `EnhanceControl` (same `pillBase`, same
   * content-aware glyph color via `chromeTone.sharpenDark`) and is
   * `pointer-events-none` throughout. Like ZoomHud/EnhanceControl it announces
   * through a debounced `aria-live` mirror so it does not spam screen readers.
   */
  import { viewer } from "../stores/viewer.svelte";
  import { chromeTone } from "../stores/chrome-tone.svelte";

  interface Props {
    onBoundsChange?: (rect: DOMRect | null) => void;
  }

  let { onBoundsChange }: Props = $props();
  let rootEl = $state<HTMLElement | null>(null);

  /** Delay before the pill appears, so fast upgrades stay silent. */
  const APPEAR_DELAY_MS = 350;
  /** Delay before the pill hides after the sharp tier paints. */
  const DISMISS_DELAY_MS = 400;

  // Debounced visibility: show ~350ms after `sharpening` becomes true; hide
  // ~400ms after it becomes false. Both edges are debounced from a single
  // effect keyed on the store flag.
  let visible = $state(false);
  $effect(() => {
    const busy = viewer.sharpening;
    const delay = busy ? APPEAR_DELAY_MS : DISMISS_DELAY_MS;
    const timer = setTimeout(() => {
      visible = busy;
    }, delay);
    return () => clearTimeout(timer);
  });

  // Debounced mirror of the loading state for the aria-live announcement.
  let announced = $state("");
  $effect(() => {
    const busy = viewer.sharpening;
    const timer = setTimeout(() => {
      announced = busy ? "Sharpening image" : "";
    }, 300);
    return () => clearTimeout(timer);
  });

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

  const pillBase =
    "ring-glass-highlight rounded-full bg-toolbar-surface px-3 py-1.5 text-xs font-medium shadow-xl ring-1 ring-inset backdrop-blur-xl backdrop-saturate-150";
  const glyphClass = $derived(
    chromeTone.sharpenDark
      ? "text-chrome-glyph-on-dark drop-shadow-glyph"
      : "text-chrome-glyph-on-light",
  );
</script>

{#if visible}
  <div
    bind:this={rootEl}
    class={`pointer-events-none flex items-center gap-2 ${pillBase} ${glyphClass}`}
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="sharpen-indicator"
  >
    <div
      class={`size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${glyphClass}`}
      aria-hidden="true"
    ></div>
    <span>Sharpening…</span>
  </div>
{/if}

<span class="sr-only" aria-live="polite">{announced}</span>
