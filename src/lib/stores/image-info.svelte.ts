/**
 * On-demand image-metadata store (Svelte 5 runes).
 *
 * Owns the per-path metadata cache and the fetch lifecycle for the info card.
 * Metadata is fetched only when the card explicitly asks for it (`ensureLoaded`)
 * and cached by absolute path so re-opening or navigating back is instant. A
 * stale-guard discards a late response whose path is no longer the requested
 * one, so a slow fetch for a previous image can never overwrite the current.
 */

import { readImageMetadata } from "../ipc";
import type { ImageMetadata } from "../ipc/commands";

/** Fetch lifecycle for the currently-requested path. */
export type ImageInfoStatus = "idle" | "loading" | "ready" | "error";

class ImageInfoStore {
  /** Per-path metadata cache, keyed by absolute path. */
  #cache = new Map<string, ImageMetadata>();
  /** In-flight fetches keyed by path, so concurrent callers (info card + title
   * bar) share a single IPC request rather than each issuing their own. */
  #inFlight = new Map<string, Promise<ImageMetadata>>();
  /** The path of the most recent `ensureLoaded` request (stale-guard token). */
  #requestedPath: string | null = null;

  status = $state<ImageInfoStatus>("idle");
  error = $state<string | null>(null);
  /** Metadata for the most recently requested path, or `null` while loading. */
  current = $state<ImageMetadata | null>(null);

  /**
   * Ensure metadata for `path` is loaded, returning cached data immediately or
   * fetching via the IPC seam. Concurrent/late responses for a superseded path
   * are dropped. A `null`/empty path resets to the idle (empty) state.
   */
  async ensureLoaded(path: string | null): Promise<void> {
    if (!path) {
      this.#requestedPath = null;
      this.current = null;
      this.error = null;
      this.status = "idle";
      return;
    }

    this.#requestedPath = path;

    const cached = this.#cache.get(path);
    if (cached) {
      this.current = cached;
      this.error = null;
      this.status = "ready";
      return;
    }

    this.current = null;
    this.error = null;
    this.status = "loading";

    try {
      // Share a single in-flight request per path so the info card and the
      // title bar don't each issue their own read for the same image.
      let request = this.#inFlight.get(path);
      if (!request) {
        request = readImageMetadata({ path });
        this.#inFlight.set(path, request);
      }
      const metadata = await request;
      this.#cache.set(path, metadata);
      if (this.#requestedPath !== path) return;
      this.current = metadata;
      this.error = null;
      this.status = "ready";
    } catch (err) {
      if (this.#requestedPath !== path) return;
      this.current = null;
      this.error = err instanceof Error ? err.message : "Could not read metadata";
      this.status = "error";
    } finally {
      this.#inFlight.delete(path);
    }
  }
}

export const imageInfo = new ImageInfoStore();
