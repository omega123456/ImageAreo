/**
 * Sampled brightness of the image behind the floating toolbar, used to pick a
 * contrasting glyph color. `toolbarDark` is true when the backdrop is dark (so
 * the toolbar should use light glyphs). Defaults to dark, matching the typical
 * dark canvas surround before any image is sampled.
 */
class ChromeTone {
  toolbarDark = $state(true);
}

export const chromeTone = new ChromeTone();
