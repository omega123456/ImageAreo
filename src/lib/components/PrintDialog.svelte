<script lang="ts">
  import { tick } from "svelte";
  import { fly } from "svelte/transition";

  import { icons, ICON_SIZE, ICON_WEIGHT } from "../icons";
  import { print } from "../stores/print.svelte";
  import { viewer } from "../stores/viewer.svelte";
  import { paperDimensions } from "../utils/print-geometry";
  import { toPrintableDataUrl } from "../utils/print-image";
  import { printCurrentView } from "../ipc";
  import PrintPreview from "./PrintPreview.svelte";
  import PrintTemplatePicker from "./PrintTemplatePicker.svelte";
  import PrintControls from "./PrintControls.svelte";

  const CloseIcon = icons.close;

  // Reduced-motion gates the fly-in; instant under the user preference.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const flyDuration = reducedMotion ? 0 : 200;

  let panel = $state<HTMLElement | null>(null);
  // Element to restore focus to when the dialog closes (the prior active el).
  let returnFocusTo: HTMLElement | null = null;

  const canPrint = $derived(!!viewer.source);

  function close(): void {
    print.closeWindow();
  }

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }

  $effect(() => {
    if (!print.open) {
      // Closing: return focus to whatever was focused before opening.
      returnFocusTo?.focus();
      returnFocusTo = null;
      return;
    }
    returnFocusTo = document.activeElement as HTMLElement | null;
    // Initial focus on the first template card (the first focusable in the
    // picker, which leads the panel body after the header close button).
    const card = panel?.querySelector<HTMLElement>(
      '[role="radiogroup"] button',
    );
    (card ?? focusables()[0])?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !panel?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel?.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  // Two coordinated frames, so WebKit actually composites the freshly-set print
  // image before the native print snapshot (the print <img> lives in a
  // display:none subtree on screen, so it is otherwise never painted).
  function nextPaint(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  async function onPrint(): Promise<void> {
    if (!canPrint) return;

    // Inline the image as a data URL so the print render tree needs no external
    // (asset://) resource load, which macOS WKWebView's print formatter does
    // not reliably re-fetch. Best-effort: fall back to the live source.
    let printSrc = viewer.source;
    try {
      printSrc = await toPrintableDataUrl(viewer.source);
    } catch {
      // Keep the live source; printing proceeds either way.
    }
    print.setPrintImage(printSrc);
    // Mark the print in flight BEFORE dismissing the modal so the print-only
    // layer survives the async OS dialog (see PrintStore.beginPrinting).
    print.beginPrinting();
    await tick();

    // The print <img> is display:none on screen, so WebKit never decodes it and
    // WKWebView's `printOperationWithPrintInfo:` does not wait for async decode
    // → blank page. Force the bitmap to decode and let it composite first.
    try {
      const probe = new Image();
      probe.src = printSrc;
      await probe.decode();
    } catch {
      // decode() is best-effort (unsupported in some engines / data URLs).
    }
    await nextPaint();

    const { widthMm, heightMm } = paperDimensions(
      print.paperSize,
      print.orientation,
    );
    await printCurrentView({
      paperWidthMm: widthMm,
      paperHeightMm: heightMm,
      orientation: print.orientation,
    });
    // Dismiss the custom modal but leave the print-only layer mounted: the OS
    // print dialog is async (macOS sheet / WebView2 dialog) and renders from the
    // live DOM after this returns. The layer is torn down lazily on the next
    // openWindow/reset (PrintStore.endPrinting); it is display:none on screen.
    print.closeWindow();
  }
</script>

{#if print.open}
  <div class="fixed inset-0 z-40 flex items-center justify-center p-4 print:hidden" role="presentation">
    <button
      type="button"
      class="absolute inset-0 bg-surface-950/40"
      aria-label="Close print window"
      tabindex="-1"
      onclick={close}
    ></button>

    <div
      bind:this={panel}
      class="relative z-50 flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-chrome-surface shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-title"
      tabindex="-1"
      onkeydown={onKeydown}
      transition:fly={{ y: -20, duration: flyDuration, opacity: 1 }}
    >
      <header class="flex items-center justify-between border-b border-surface-200-800 p-4">
        <h2 id="print-title" class="text-base font-semibold">Print</h2>
        <button
          type="button"
          class="btn-icon btn-icon-sm preset-tonal"
          aria-label="Close"
          title="Close"
          onclick={close}
        >
          <CloseIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
        </button>
      </header>

      <div
        class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 md:grid md:grid-cols-5 md:items-stretch scrollbar-thin scrollbar-thumb-surface-400-600"
      >
        <div class="min-h-0 md:col-span-3">
          <PrintPreview />
        </div>
        <div class="flex flex-col gap-6 md:col-span-2">
          <section class="flex flex-col gap-2">
            <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
              Layout
            </h3>
            <PrintTemplatePicker />
          </section>
          <PrintControls />
        </div>
      </div>

      <footer
        class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-surface-200-800 bg-chrome-surface p-4"
      >
        <button type="button" class="btn preset-tonal" onclick={close}>
          Cancel
        </button>
        <button
          type="button"
          class="btn preset-filled-primary-500"
          disabled={!canPrint}
          onclick={onPrint}
        >
          Print
        </button>
      </footer>
    </div>
  </div>
{/if}
