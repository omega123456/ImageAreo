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

function galleryThumbnailConcurrency(): number {
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
  if (
    typeof hardwareConcurrency !== "number" ||
    !Number.isFinite(hardwareConcurrency)
  ) {
    return 6;
  }

  return Math.min(Math.max(Math.floor(hardwareConcurrency), 4), 16);
}

export const GALLERY_THUMBNAIL_MAX_CONCURRENT = galleryThumbnailConcurrency();

export interface ThumbnailEntry {
  status: ThumbnailStatus;
  url: string | null;
}

interface RequestOptions {
  priority?: boolean;
}

interface QueuedThumbnailRequest {
  key: string;
  path: string;
  size: number;
  resolve: () => void;
}

function cacheKey(path: string, size: number): string {
  return `${size}::${path}`;
}

class GalleryThumbnailCache {
  /** Reactive map of cache-key -> entry. Components read entries by key. */
  #entries = $state<Record<string, ThumbnailEntry>>({});
  /** Keys with a generate_thumbnail call currently in flight. */
  #inFlight = new Set<string>();
  /** Pending requests waiting for an available backend slot. */
  #queue: QueuedThumbnailRequest[] = [];
  /** Number of backend calls actively running. */
  #activeCount = 0;

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
  async request(
    path: string,
    size: number,
    options: RequestOptions = {},
  ): Promise<void> {
    const key = cacheKey(path, size);
    if (key in this.#entries || this.#inFlight.has(key)) {
      return;
    }

    this.#entries = {
      ...this.#entries,
      [key]: { status: "pending", url: null },
    };

    await this.#schedule({ key, path, size }, options);
  }

  prefetchFolder(paths: string[], size: number): void {
    this.cancelPending();

    for (const path of paths) {
      void this.request(path, size);
    }
  }

  cancelPending(): void {
    const queuedKeys = new Set(this.#queue.map((request) => request.key));
    if (queuedKeys.size > 0) {
      const nextEntries = { ...this.#entries };
      for (const key of queuedKeys) {
        if (!this.#inFlight.has(key) && nextEntries[key]?.status === "pending") {
          delete nextEntries[key];
        }
      }
      this.#entries = nextEntries;
    }

    const queue = this.#queue;
    this.#queue = [];

    for (const request of queue) {
      request.resolve();
    }
  }

  async #schedule(
    request: Omit<QueuedThumbnailRequest, "resolve">,
    options: RequestOptions,
  ): Promise<void> {
    if (this.#activeCount < GALLERY_THUMBNAIL_MAX_CONCURRENT) {
      await this.#runRequest(request);
      return;
    }

    await new Promise<void>((resolve) => {
      const queuedRequest = { ...request, resolve };
      if (options.priority) {
        this.#queue.unshift(queuedRequest);
      } else {
        this.#queue.push(queuedRequest);
      }
    });
  }

  async #runRequest(
    request: Omit<QueuedThumbnailRequest, "resolve">,
  ): Promise<void> {
    this.#activeCount += 1;
    this.#inFlight.add(request.key);

    try {
      const thumbnail = await generateThumbnail({
        path: request.path,
        size: request.size,
      });
      this.#entries = {
        ...this.#entries,
        [request.key]: { status: "ready", url: thumbnail.url },
      };
    } catch {
      this.#entries = {
        ...this.#entries,
        [request.key]: { status: "error", url: null },
      };
    } finally {
      this.#inFlight.delete(request.key);
      this.#activeCount = Math.max(0, this.#activeCount - 1);
      this.#drainQueue();
    }
  }

  #drainQueue(): void {
    while (
      this.#activeCount < GALLERY_THUMBNAIL_MAX_CONCURRENT &&
      this.#queue.length > 0
    ) {
      const next = this.#queue.shift();
      if (!next) {
        return;
      }

      void this.#runQueuedRequest(next);
    }
  }

  async #runQueuedRequest(request: QueuedThumbnailRequest): Promise<void> {
    await this.#runRequest(request);
    request.resolve();
  }

  /** Drop a single cached entry (e.g. to retry a failed generation). */
  invalidate(path: string, size: number): void {
    const key = cacheKey(path, size);
    if (!(key in this.#entries)) {
      return;
    }
    const next = { ...this.#entries };
    delete next[key];
    this.#entries = next;
    this.#inFlight.delete(key);
  }

  /** Clear the entire session cache. */
  clear(): void {
    this.#entries = {};
    this.#inFlight.clear();
    this.cancelPending();
    this.#activeCount = 0;
  }
}

export const galleryThumbnails = new GalleryThumbnailCache();
