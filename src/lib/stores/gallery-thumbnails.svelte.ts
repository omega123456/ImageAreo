/**
 * In-memory, per-session thumbnail cache for the gallery strip (Svelte 5 runes).
 *
 * Thumbnails are keyed by `path` + requested logical `size` and generated via
 * the Rust `generate_thumbnail` command (through the IPC seam). The cache is
 * the single source of truth the gallery thumbnails read from: a `request` for
 * an already-cached or already-in-flight key is a no-op, so revisiting a
 * thumbnail (scrolling back, re-rendering after virtualization recycles it)
 * never issues a duplicate backend call. The cache lives only for the session
 * and is discarded on app exit (persistent disk cache is out of scope for v1).
 */

import { generateThumbnail } from "../ipc";

export type ThumbnailStatus = "pending" | "ready" | "error";

export interface ThumbnailEntry {
  status: ThumbnailStatus;
  dataUrl: string | null;
}

function cacheKey(path: string, size: number): string {
  return `${size}::${path}`;
}

class GalleryThumbnailCache {
  /** Reactive map of cache-key -> entry. Components read entries by key. */
  #entries = $state<Record<string, ThumbnailEntry>>({});
  /** Keys with a generate_thumbnail call currently in flight. */
  #inFlight = new Set<string>();

  /** Current entry for a path+size, or `undefined` if never requested. */
  get(path: string, size: number): ThumbnailEntry | undefined {
    return this.#entries[cacheKey(path, size)];
  }

  /** True if a request for this key has been issued (pending, ready, or error). */
  has(path: string, size: number): boolean {
    return cacheKey(path, size) in this.#entries;
  }

  /**
   * Ensure a thumbnail for `path` at `size` is generated, caching the result.
   *
   * Cached or in-flight keys short-circuit so no duplicate backend call is
   * issued. A failed generation is recorded as an `error` entry and can be
   * retried by clearing it first via {@link invalidate}.
   */
  async request(path: string, size: number): Promise<void> {
    const key = cacheKey(path, size);
    if (key in this.#entries || this.#inFlight.has(key)) return;

    this.#inFlight.add(key);
    this.#entries = {
      ...this.#entries,
      [key]: { status: "pending", dataUrl: null },
    };

    try {
      const thumbnail = await generateThumbnail({ path, size });
      this.#entries = {
        ...this.#entries,
        [key]: { status: "ready", dataUrl: thumbnail.dataUrl },
      };
    } catch {
      this.#entries = {
        ...this.#entries,
        [key]: { status: "error", dataUrl: null },
      };
    } finally {
      this.#inFlight.delete(key);
    }
  }

  /** Drop a single cached entry (e.g. to retry a failed generation). */
  invalidate(path: string, size: number): void {
    const key = cacheKey(path, size);
    if (!(key in this.#entries)) return;
    const next = { ...this.#entries };
    delete next[key];
    this.#entries = next;
    this.#inFlight.delete(key);
  }

  /** Clear the entire session cache. */
  clear(): void {
    this.#entries = {};
    this.#inFlight.clear();
  }
}

export const galleryThumbnails = new GalleryThumbnailCache();
