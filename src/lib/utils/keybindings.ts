/**
 * Global keyboard model (Phase 11).
 *
 * Maps a `KeyboardEvent` to one of the viewer's discrete actions. The mapping is
 * a pure function over an injected `KeyActions` bag so it can be unit-tested
 * without a DOM: `App.svelte` supplies handlers that drive the zoom/pan
 * controller, the folder navigation, the rotation store, and the shared UI
 * (settings drawer + fullscreen) seam.
 *
 * The bindings stay live regardless of chrome visibility (this matters for the
 * P16 fullscreen mode), so the handler only suppresses itself while a text input
 * has focus — never based on the toolbar/gallery being shown.
 */

/** Action handlers the key handler dispatches to. */
export interface KeyActions {
  /** Previous image in the folder; resets zoom to fit. */
  prev: () => void;
  /** Next image in the folder; resets zoom to fit. */
  next: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  rotateLeft: () => void;
  rotateRight: () => void;
  toggleFullscreen: () => void;
  /**
   * Toggle the image-info card (always active; works with no image).
   * Optional so the action bag can omit it until the card is wired in (Phase 5);
   * an unbound `toggleInfo` simply no-ops.
   */
  toggleInfo?: () => void;
  /**
   * Print the current image via the OS-native print dialog (`Ctrl/Cmd+P`).
   * Optional so the action bag can omit it; an unbound `print` simply no-ops.
   */
  print?: () => void;
  /** Close any open overlay / exit fullscreen (Esc). */
  escape: () => void;
}

/** The discrete action a key event resolves to, or `null` for no binding. */
export type KeyBinding = keyof KeyActions | null;

/**
 * Resolve a keyboard event to its bound action name, or `null` if unbound.
 *
 * Pure and side-effect-free so the full key table can be asserted directly.
 * `Ctrl+[` / `Ctrl+]` rotate (also accepts Meta on macOS); `Ctrl/Cmd+P`
 * prints; `Ctrl+Cmd+F` toggles fullscreen (the mac chord — requires BOTH ctrl
 * and meta so plain Cmd+F / Ctrl+F Find are not hijacked); `Esc` and `F11` are
 * always honoured
 * (overlay/fullscreen handling decides whether anything happens), while the
 * rest are image-view actions.
 */
export function resolveBinding(e: KeyboardEvent): KeyBinding {
  const mod = e.ctrlKey || e.metaKey;

  if (mod) {
    if (e.ctrlKey && e.metaKey && (e.key === "f" || e.key === "F")) {
      return "toggleFullscreen";
    }
    if (e.key === "[") return "rotateLeft";
    if (e.key === "]") return "rotateRight";
    // `mod` is `ctrlKey || metaKey`, so this covers Ctrl+P (Windows) and Cmd+P
    // (macOS) with a single branch.
    if (e.key === "p" || e.key === "P") return "print";
    return null;
  }

  switch (e.key) {
    case "ArrowLeft":
      return "prev";
    case "ArrowRight":
      return "next";
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "f":
    case "F":
      return "fit";
    case "1":
      return "actualSize";
    case "i":
    case "I":
      return "toggleInfo";
    case "F11":
      return "toggleFullscreen";
    case "Escape":
      return "escape";
    default:
      return null;
  }
}

/** Bindings allowed to fire even while no image is loaded / ready. */
const ALWAYS_ACTIVE: ReadonlySet<KeyBinding> = new Set<KeyBinding>([
  "escape",
  "toggleFullscreen",
  "toggleInfo",
]);

/** True when focus is in a text-editing control that should keep the keys. */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/**
 * Build a `keydown` handler bound to the given actions. `isReady` gates the
 * image-view bindings (zoom/nav/rotate) so they no-op without a ready image,
 * while Esc and fullscreen always fire. Matched events call `preventDefault`.
 */
export function createKeyHandler(
  actions: KeyActions,
  isReady: () => boolean,
  isBlocked: (binding: KeyBinding) => boolean = () => false,
  isAllowedWhileNotReady: (binding: KeyBinding) => boolean = () => false,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (isTextInput(e.target)) return;

    const binding = resolveBinding(e);
    if (binding === null) return;
    if (isBlocked(binding)) return;
    if (
      !ALWAYS_ACTIVE.has(binding) &&
      !isReady() &&
      !isAllowedWhileNotReady(binding)
    ) {
      return;
    }

    e.preventDefault();
    actions[binding]?.();
  };
}
