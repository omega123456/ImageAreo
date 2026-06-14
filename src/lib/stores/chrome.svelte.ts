/**
 * Chrome auto-hide store (Svelte 5 runes).
 *
 * Owns the visibility of the *floating chrome* — the translucent toolbar and the
 * zoom HUD — which fade out after a short period of pointer/keyboard inactivity
 * and also hide when fullscreen is entered. The filmstrip is intentionally NOT
 * governed by this store (product decision: it stays visible).
 *
 * The shell (`App.svelte`) is the only place that wires DOM listeners and
 * fullscreen transitions: it calls {@link ChromeStore.registerActivity} on
 * mousemove/keydown, forwards fullscreen changes via
 * {@link ChromeStore.setFullscreen}, and binds the exposed
 * {@link ChromeStore.chromeVisible} to the overlay containers. Keeping all DOM
 * event binding out of this store keeps it pure and unit-testable headlessly
 * (with fake timers).
 *
 * Fullscreen is *read* from the `ui` store — this store does not own or move it.
 */
/** Idle period (ms) after which chrome hides when there is no activity. */
export const CHROME_IDLE_MS = 2500;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

class ChromeStore {
  /** Whether chrome was hidden because the idle timeout elapsed. */
  #idle = $state<boolean>(false);

  /** Reactive mirror of the reduced-motion media query. */
  #reducedMotion = $state<boolean>(false);

  /**
   * Number of chrome surfaces (toolbar / info card) the pointer is currently
   * hovering. While > 0 the idle countdown is suspended so chrome under the
   * cursor never fades out from under it. A counter (not a boolean) tolerates
   * overlapping enter/leave across multiple surfaces.
   */
  #holds = 0;

  #timer: ReturnType<typeof setTimeout> | null = null;
  #motionQuery: MediaQueryList | null = null;
  #removeMotionListener: (() => void) | null = null;

  /** Whether the floating chrome (toolbar + HUD) should be shown. */
  readonly chromeVisible = $derived(!this.#idle);

  /**
   * Whether visibility transitions should be applied instantly (no fade),
   * derived from the user's reduced-motion preference. The shell consults this
   * to choose instant vs. faded application.
   */
  readonly instant = $derived(this.#reducedMotion);

  /**
   * Register user activity. Shows the chrome immediately and (re)starts the
   * idle countdown; after {@link CHROME_IDLE_MS} of no further activity the
   * chrome hides. Safe to call frequently (e.g. on every mousemove).
   */
  registerActivity(): void {
    this.#idle = false;
    // While the pointer rests on a chrome surface, keep it shown without arming
    // the countdown — a stationary hover fires no further activity, so a timer
    // here would hide the very chrome the user is pointing at.
    if (this.#holds > 0) {
      this.#clearTimer();
      return;
    }
    this.#restartTimer();
  }

  /**
   * Begin holding chrome visible (pointer entered a chrome surface). Shows the
   * chrome and suspends the idle countdown until the matching
   * {@link releaseVisible}.
   */
  holdVisible(): void {
    this.#holds += 1;
    this.#idle = false;
    this.#clearTimer();
  }

  /**
   * End one hold (pointer left a chrome surface). When the last hold is
   * released, resume the normal idle countdown.
   */
  releaseVisible(): void {
    this.#holds = Math.max(0, this.#holds - 1);
    if (this.#holds === 0) {
      this.registerActivity();
    }
  }

  /**
   * Fullscreen participates in the same idle model: entering fullscreen hides
   * chrome immediately, but later activity can reveal it again while staying in
   * fullscreen. Leaving fullscreen is treated as activity so chrome returns.
   */
  setFullscreen(fullscreen: boolean): void {
    if (fullscreen) {
      this.#idle = true;
      this.#clearTimer();
      // The chrome surfaces become non-interactive (translated off-screen,
      // pointer-events-none) on this transition, and the browser may not deliver
      // a matching `pointerleave`. Reconcile holds here so a stale hold can't
      // pin chrome visible and suppress the idle countdown indefinitely.
      this.#holds = 0;
      return;
    }

    this.registerActivity();
  }

  /**
   * Begin watching the reduced-motion media query and seed the idle timer.
   * Called by the shell on mount. No-op when there is no DOM (SSR/tests that
   * never mount the shell).
   */
  start(): void {
    if (typeof window === "undefined") return;

    this.#removeMotionListener?.();
    this.#motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    this.#reducedMotion = this.#motionQuery.matches;

    const onChange = () => {
      this.#reducedMotion = this.#motionQuery?.matches ?? false;
    };
    this.#motionQuery.addEventListener("change", onChange);
    this.#removeMotionListener = () => {
      this.#motionQuery?.removeEventListener("change", onChange);
    };

    this.registerActivity();
  }

  /**
   * Stop the idle timer and detach the reduced-motion listener. Called by the
   * shell on teardown.
   */
  stop(): void {
    this.#clearTimer();
    this.#idle = false;
    this.#holds = 0;
    this.#removeMotionListener?.();
    this.#removeMotionListener = null;
    this.#motionQuery = null;
  }

  #restartTimer(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#idle = true;
      this.#timer = null;
    }, CHROME_IDLE_MS);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

export const chrome = new ChromeStore();
