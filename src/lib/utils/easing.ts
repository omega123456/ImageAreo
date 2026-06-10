/**
 * Easing functions used by the zoom/pan controller.
 *
 * `t` is the normalized progress in [0, 1]; the return value is the eased
 * progress, also in [0, 1].
 */

/** Clamp a number into the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b` by eased factor `t`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth deceleration toward the end — used for discrete zoom steps. */
export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

/** Strong deceleration curve used for drag-release momentum. */
export function easeOutQuint(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 5);
}
