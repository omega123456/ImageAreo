import {
  COPIES_MAX,
  COPIES_MIN,
  type FitMode,
  type MarginId,
  type Orientation,
  type PaperSizeId,
  type TemplateId,
} from "../utils/print-presets";

/**
 * Reactive print state: the window's open flag plus the layout settings every
 * print UI control and entry point reads and mutates. Pure runes — no native or
 * IPC calls so the seam stays mockable; geometry recompute lives in components.
 */
class PrintStore {
  open = $state<boolean>(false);
  // A native print is in flight. The OS print dialog (macOS sheet / WebView2
  // browser dialog) is async and returns control to us immediately, but it reads
  // the LIVE print DOM throughout the modal session. So the print-only layer must
  // stay mounted while this is set, independent of `open` (the custom modal is
  // dismissed the instant the OS dialog opens). Cleared lazily on the next
  // `openWindow`/`reset` — the leftover layer is `display:none` on screen.
  printing = $state<boolean>(false);
  template = $state<TemplateId>("full");
  paperSize = $state<PaperSizeId>("letter");
  orientation = $state<Orientation>("portrait");
  margins = $state<MarginId>("normal");
  // Page count equals copies (each printed page is the same full layout).
  copies = $state<number>(COPIES_MIN);
  fit = $state<FitMode>("fit");
  // Inlined `data:` URL of the current image, set just before a native print so
  // the print render tree needs no external (asset://) load. Empty otherwise;
  // the print DOM falls back to the live `viewer.source` for the on-screen path.
  printImage = $state<string>("");

  /** Restore every field to its initial default — single source of truth. */
  reset(): void {
    this.open = false;
    this.printing = false;
    this.template = "full";
    this.paperSize = "letter";
    this.orientation = "portrait";
    this.margins = "normal";
    this.copies = COPIES_MIN;
    this.fit = "fit";
    this.printImage = "";
  }

  openWindow(): void {
    // Drop any leftover print layer from a prior native print before reopening,
    // so the hidden print DOM / inlined image bytes don't linger.
    this.endPrinting();
    this.open = true;
  }

  closeWindow(): void {
    this.open = false;
  }

  /**
   * Mark a native print as in flight. Keeps the print-only DOM mounted across
   * the async OS print dialog even after the custom modal is dismissed.
   */
  beginPrinting(): void {
    this.printing = true;
  }

  /** End the in-flight print and release the inlined print image. */
  endPrinting(): void {
    this.printing = false;
    this.printImage = "";
  }

  setTemplate(template: TemplateId): void {
    this.template = template;
  }

  setPaperSize(paperSize: PaperSizeId): void {
    this.paperSize = paperSize;
  }

  setOrientation(orientation: Orientation): void {
    this.orientation = orientation;
  }

  setMargins(margins: MarginId): void {
    this.margins = margins;
  }

  setCopies(copies: number): void {
    const whole = Math.trunc(copies);
    this.copies = Math.min(COPIES_MAX, Math.max(COPIES_MIN, whole));
  }

  setFit(fit: FitMode): void {
    this.fit = fit;
  }

  setPrintImage(dataUrl: string): void {
    this.printImage = dataUrl;
  }
}

export const print = new PrintStore();
