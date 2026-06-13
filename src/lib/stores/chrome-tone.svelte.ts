/**
 * Sampled brightness for floating chrome. Each flag is true when that control's
 * local backdrop is dark, so it should render light glyphs. Defaults match the
 * typical dark canvas surround before any image is sampled.
 */
class ChromeTone {
  toolbarDark = $state(true);
  enhanceDark = $state(true);
}

export const chromeTone = new ChromeTone();
