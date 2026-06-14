import { readFullscreen, writeFullscreen } from "../utils/native-window";

/**
 * Shared, app-wide UI-state runes that are not tied to a single component tree.
 *
 * This is the seam other input channels (the toolbar button and the native
 * macOS app-menu "Settings…" item built in Phase 12) use to drive transient UI
 * such as the settings drawer, without each owning the open/close state.
 */
class UiStore {
  settingsOpen = $state<boolean>(false);
  infoOpen = $state<boolean>(false);
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

  openInfo(): void {
    this.infoOpen = true;
  }

  closeInfo(): void {
    this.infoOpen = false;
  }

  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  async initializeFullscreen(): Promise<void> {
    this.fullscreen = await readFullscreen();
  }

  async toggleFullscreen(): Promise<void> {
    await this.setFullscreen(!this.fullscreen);
  }

  async exitFullscreen(): Promise<void> {
    await this.setFullscreen(false);
  }

  async setFullscreen(fullscreen: boolean): Promise<void> {
    await writeFullscreen(fullscreen);
    this.fullscreen = fullscreen;
  }
}

export const ui = new UiStore();
