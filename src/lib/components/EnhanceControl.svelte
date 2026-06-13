<script lang="ts">
  /**
   * The "Enhance" pill control. Opening a RAW shows the embedded preview (fast,
   * but soft); this control lets the user opt into a one-time full sensor
   * demosaic that sharpens the image. Three states, driven by the viewer store:
   *
   *  - Available — an "Enhance" button with a hover tooltip; clicking it starts
   *                the decode immediately (no confirmation dialog).
   *  - Loading   — a busy chip ("Enhancing…") while the demosaic runs.
   *  - Error     — a transient "Couldn't enhance" message that auto-dismisses
   *                back to Available so the user can retry.
   *
   * Once enhanced, the control renders nothing (the sharp image stays up). The
   * loading announcement uses a debounced `aria-live` mirror (~300ms) like
   * ZoomHud so transient state changes do not spam screen readers.
   */
  import { viewer } from "../stores/viewer.svelte";
  import { chromeTone } from "../stores/chrome-tone.svelte";

  interface Props {
    onBoundsChange?: (rect: DOMRect | null) => void;
  }

  let { onBoundsChange }: Props = $props();
  let rootEl = $state<HTMLElement | null>(null);

  /** How long the error state lingers before auto-dismissing to Available. */
  const ERROR_DISMISS_MS = 2500;

  // Debounced mirror of the loading state for the aria-live announcement.
  let announced = $state("");
  $effect(() => {
    const busy = viewer.enhancing;
    const timer = setTimeout(() => {
      announced = busy ? "Enhancing image" : "";
    }, 300);
    return () => clearTimeout(timer);
  });

  // Auto-dismiss the transient error state back to Available.
  $effect(() => {
    if (!viewer.enhanceError) return;
    const timer = setTimeout(() => {
      viewer.enhanceError = false;
    }, ERROR_DISMISS_MS);
    return () => clearTimeout(timer);
  });

  function enhance(): void {
    void viewer.requestEnhance();
  }

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
    chromeTone.enhanceDark
      ? "text-chrome-glyph-on-dark drop-shadow-glyph"
      : "text-chrome-glyph-on-light",
  );
</script>

{#if viewer.enhancing}
  <div
    bind:this={rootEl}
    class={`pointer-events-none flex items-center gap-2 ${pillBase} ${glyphClass}`}
    role="status"
    aria-live="polite"
    aria-busy="true"
    data-testid="enhance-control"
  >
    <div
      class={`size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${glyphClass}`}
      aria-hidden="true"
    ></div>
    <span>Enhancing…</span>
  </div>
{:else if viewer.enhanceError}
  <div
    bind:this={rootEl}
    class={`flex items-center ${pillBase} ${glyphClass}`}
    role="alert"
    data-testid="enhance-control"
  >
    Couldn't enhance
  </div>
{:else if !viewer.enhanced}
  <button
    bind:this={rootEl}
    type="button"
    class={`${pillBase} ${glyphClass}`}
    aria-label="Enhance this RAW to full sensor resolution"
    title="Sharpen this RAW with a full-resolution decode (slower, uses more memory)"
    data-testid="enhance-control"
    onclick={enhance}
  >
    Enhance
  </button>
{/if}

<span class="sr-only" aria-live="polite">{announced}</span>
