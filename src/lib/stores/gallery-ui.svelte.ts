/**
 * Gallery-strip UI visibility state (Svelte 5 runes).
 *
 * A simple boolean toggle — the strip is visible by default and hidden via the
 * toolbar/menu "Toggle Gallery" action. This is pure view-state with no
 * persistence; fullscreen auto-hide (P16) layers on top of it separately.
 */
class GalleryUiStore {
  /** Whether the gallery strip is shown. Visible by default. */
  visible = $state<boolean>(true);

  toggle(): void {
    this.visible = !this.visible;
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  reset(): void {
    this.visible = true;
  }
}

export const galleryUi = new GalleryUiStore();
