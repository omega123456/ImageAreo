/**
 * Pure horizontal-virtualization math for the gallery strip.
 *
 * The strip lays out fixed-width thumbnails (size + gap) in a single row. Given
 * the current scroll offset and viewport width, this computes the slice of item
 * indices that must be rendered (visible range padded by a buffer on each side)
 * plus the total scrollable width and the left offset of the first rendered
 * item — so the rendered window can be absolutely positioned inside a full-width
 * spacer. Kept pure (no DOM) so it is unit-testable in isolation; the component
 * only feeds it measured numbers.
 */

export interface VirtualWindow {
  /** First item index to render (inclusive). */
  startIndex: number;
  /** Last item index to render (inclusive). */
  endIndex: number;
  /** Total scrollable width of all items, in CSS pixels. */
  totalWidth: number;
  /** Left offset of `startIndex`, in CSS pixels. */
  offsetLeft: number;
}

export function computeVirtualWindow(
  itemCount: number,
  itemStride: number,
  scrollLeft: number,
  viewportWidth: number,
  buffer: number,
): VirtualWindow {
  if (itemCount <= 0 || itemStride <= 0) {
    return { startIndex: 0, endIndex: -1, totalWidth: 0, offsetLeft: 0 };
  }

  const totalWidth = itemCount * itemStride;
  const safeScroll = Math.max(0, Math.min(scrollLeft, totalWidth));
  const safeViewport = Math.max(0, viewportWidth);

  const firstVisible = Math.floor(safeScroll / itemStride);
  const lastVisible = Math.floor((safeScroll + safeViewport) / itemStride);

  const startIndex = Math.max(0, firstVisible - buffer);
  const endIndex = Math.min(itemCount - 1, lastVisible + buffer);

  return {
    startIndex,
    endIndex,
    totalWidth,
    offsetLeft: startIndex * itemStride,
  };
}
