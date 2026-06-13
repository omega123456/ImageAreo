/**
 * Content-aware backdrop sampling for floating chrome.
 *
 * The toolbar floats over the image through a very translucent glass, so its
 * glyphs must adapt to whatever the image shows behind them. This module
 * re-renders the on-screen image region behind a chrome rectangle into a tiny
 * offscreen canvas — replicating the viewer's pan/zoom/rotation/orientation
 * transform — and returns the average relative luminance of that region. The
 * caller picks a light or dark glyph from the result.
 *
 * Native images load through Tauri's asset protocol; if the webview taints the
 * canvas, `getImageData` throws and we return `null` so the caller keeps its
 * previous (or default) tone rather than crashing.
 */

export interface BackdropGeom {
  /** Container (canvas) CSS size. */
  cw: number;
  ch: number;
  /** Natural image dimensions. */
  natW: number;
  natH: number;
  /** Live view transform. */
  zoom: number;
  panX: number;
  panY: number;
  rotationDeg: number;
  /** EXIF orientation (1–8). */
  orientation: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Linear matrix (a,b,c,d) for an EXIF orientation, matching `orientationTransform`. */
function orientationMatrix(o: number): [number, number, number, number] {
  switch (o) {
    case 2:
      return [-1, 0, 0, 1]; // scaleX(-1)
    case 3:
      return [-1, 0, 0, -1]; // rotate180
    case 4:
      return [1, 0, 0, -1]; // scaleY(-1)
    case 5:
      return [0, 1, 1, 0]; // rotate90 + flip
    case 6:
      return [0, 1, -1, 0]; // rotate90
    case 7:
      return [0, -1, -1, 0]; // rotate270 + flip
    case 8:
      return [0, -1, 1, 0]; // rotate270
    default:
      return [1, 0, 0, 1];
  }
}

/** Relative luminance (0..1) of an sRGB triplet (no gamma; adequate for a threshold). */
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Parse a CSS color string into relative luminance (0..1), or null. */
export function cssColorLuminance(color: string): number | null {
  const rgb = color.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(/[ ,/]+/).map((x) => parseFloat(x));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return luminance(parts[0], parts[1], parts[2]);
  }

  const oklch = color.match(/oklch\(([^)]+)\)/);
  if (!oklch) return null;

  const parts = oklch[1].split(/[ ,/]+/);
  if (parts.length < 3) return null;
  const lightness = parts[0].endsWith("%")
    ? parseFloat(parts[0]) / 100
    : parseFloat(parts[0]);
  return Number.isNaN(lightness) ? null : Math.max(0, Math.min(1, lightness));
}

/** Convert a viewport-space rect to container-local coordinates and clamp it. */
export function rectWithinContainer(
  bounds: ViewportRect | null,
  containerRect: ViewportRect,
): Rect | null {
  if (!bounds) return null;

  const x = Math.max(0, bounds.left - containerRect.left);
  const y = Math.max(0, bounds.top - containerRect.top);
  const right = Math.min(containerRect.width, bounds.left - containerRect.left + bounds.width);
  const bottom = Math.min(containerRect.height, bounds.top - containerRect.top + bounds.height);
  const w = right - x;
  const h = bottom - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * Average relative luminance (0..1) of the image content shown within `rect`
 * (container coordinates), or `null` if the canvas can't be read (tainted).
 * `backgroundFill` is painted first so letterboxed/empty areas count as the
 * canvas surround rather than transparent black.
 */
export function sampleRegionLuminance(
  img: CanvasImageSource,
  geom: BackdropGeom,
  rect: Rect,
  canvas: HTMLCanvasElement,
  backgroundFill: string,
): number | null {
  if (rect.w <= 0 || rect.h <= 0 || geom.natW <= 0 || geom.natH <= 0) return null;

  const maxDim = 48;
  const s = Math.min(1, maxDim / rect.w, maxDim / rect.h);
  const sw = Math.max(1, Math.round(rect.w * s));
  const sh = Math.max(1, Math.round(rect.h * s));
  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = backgroundFill || "#000";
  ctx.fillRect(0, 0, sw, sh);

  // container coords -> downscaled canvas pixels.
  ctx.scale(s, s);
  ctx.translate(-rect.x, -rect.y);

  // Replicate the on-screen transform (origin = container center).
  ctx.translate(geom.cw / 2, geom.ch / 2);
  ctx.translate(geom.panX, geom.panY);
  ctx.scale(geom.zoom, geom.zoom);
  ctx.rotate((geom.rotationDeg * Math.PI) / 180);
  const [a, b, c, d] = orientationMatrix(geom.orientation);
  ctx.transform(a, b, c, d, 0, 0);
  ctx.translate(-geom.natW / 2, -geom.natH / 2);

  try {
    ctx.drawImage(img, 0, 0, geom.natW, geom.natH);
    const { data } = ctx.getImageData(0, 0, sw, sh);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += luminance(data[i], data[i + 1], data[i + 2]);
      n++;
    }
    return n > 0 ? sum / n : null;
  } catch {
    return null; // tainted canvas
  }
}
