/**
 * Shared, app-wide UI-state runes that are not tied to a single component tree.
 *
 * This is the seam other input channels (the toolbar button and the native
 * macOS app-menu "Settings…" item built in Phase 12) use to drive transient UI
 * such as the settings drawer, without each owning the open/close state.
 */
class UiStore {
  settingsOpen = $state<boolean>(false);
  /**
   * Shared fullscreen flag. Phase 11 only toggles this state (via the keyboard
   * and the native View menu); Phase 16 owns the actual fullscreen visuals and
   * window-level call, reacting to this flag.
   */
  fullscreen = $state<boolean>(false);

  openSettings(): void {
    this.settingsOpen = true;
  }

  closeSettings(): void {
    this.settingsOpen = false;
  }

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
  }

  toggleFullscreen(): void {
    this.fullscreen = !this.fullscreen;
  }

  exitFullscreen(): void {
    this.fullscreen = false;
  }
}

export const ui = new UiStore();
