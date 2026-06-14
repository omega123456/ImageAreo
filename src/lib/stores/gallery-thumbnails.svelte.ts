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

import { convertFileSrc } from "@tauri-apps/api/core";

import { generateThumbnail } from "../ipc";
import { isNativeFormat } from "../utils/format";

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

/**
 * Maximum number of resolved (ready/error) entries retained in the session
 * cache. When exceeded, the least-recently-used resolved entries are evicted.
 * Pending/in-flight entries are never evicted (their completion would re-insert
 * and race the generation guard), so the live count can briefly exceed this cap
 * by the number of in-flight requests; that band is itself bounded upstream by
 * the windowed filmstrip prefetch.
 */
export const GALLERY_THUMBNAIL_LRU_CAP = 400;

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
  /** Folder generation captured when the request was issued. */
  generation: number;
  resolve: () => void;
}

function cacheKey(path: string, size: number): string {
  return `${size}::${path}`;
}

function isDecodeFailedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "decode_failed"
  );
}

function fallbackNativeThumbnailUrl(path: string, error: unknown): string | null {
  if (!isNativeFormat(path) || !isDecodeFailedError(error)) {
    return null;
  }

  return convertFileSrc(path);
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
  /**
   * Folder generation token. Incremented on every folder change; in-flight
   * requests capture the generation at issue time, and completions whose
   * captured generation no longer matches are dropped (so a slow prior-folder
   * thumbnail cannot repopulate the cache after a clear).
   */
  #generation = 0;
  /**
   * LRU recency order of cache keys (most-recently-used last). A key is touched
   * on read and on insertion; eviction drops from the front, skipping any key
   * still pending/in-flight.
   */
  #recency: string[] = [];

  /** Current folder generation token. */
  get generation(): number {
    return this.#generation;
  }

  /** Number of entries currently retained in the cache (any status). */
  get size(): number {
    return Object.keys(this.#entries).length;
  }

  /** Current entry for a path+size, or `undefined` if never requested. */
  get(path: string, size: number): ThumbnailEntry | undefined {
    const key = cacheKey(path, size);
    const entry = this.#entries[key];
    if (entry !== undefined) {
      this.#touch(key);
    }
    return entry;
  }

  /** Drop a key from the recency list if present. */
  #removeFromRecency(key: string): void {
    const at = this.#recency.indexOf(key);
    if (at !== -1) this.#recency.splice(at, 1);
  }

  /** Mark a key as most-recently-used. */
  #touch(key: string): void {
    this.#removeFromRecency(key);
    this.#recency.push(key);
  }

  /**
   * Evict least-recently-used resolved entries until at or below the LRU cap.
   * Pending/in-flight entries are skipped — only `ready`/`error` entries are
   * removed, so an in-flight completion can never be evicted out from under
   * itself.
   */
  #enforceLru(): void {
    let scan = 0;
    while (this.#recency.length - scan > GALLERY_THUMBNAIL_LRU_CAP) {
      const key = this.#recency[scan];
      const entry = this.#entries[key];
      if (entry === undefined) {
        // Stale recency reference (already invalidated); drop it.
        this.#recency.splice(scan, 1);
        continue;
      }
      if (entry.status === "pending" || this.#inFlight.has(key)) {
        // Cannot evict in-flight work; leave it in place and scan past it.
        scan += 1;
        continue;
      }
      this.#recency.splice(scan, 1);
      const next = { ...this.#entries };
      delete next[key];
      this.#entries = next;
    }
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
      this.#touch(key);
      return;
    }

    this.#entries = {
      ...this.#entries,
      [key]: { status: "pending", url: null },
    };
    this.#touch(key);

    await this.#schedule({ key, path, size, generation: this.#generation }, options);
  }

  prefetchFolder(paths: string[], size: number): void {
    this.cancelPending();

    for (const path of paths) {
      void this.request(path, size);
    }
  }

  /**
   * Prefetch only the thumbnails for a band of `±band` images around
   * `currentIndex` (the visible window plus look-ahead/behind), rather than the
   * whole folder. Each move cancels queued (not-yet-started) requests that now
   * fall outside the band, then enqueues the new band; in-flight requests are
   * left to finish (no cancellation of running work). Thumbnails outside the
   * band load lazily on scroll via {@link request}.
   */
  prefetchWindow(
    paths: string[],
    currentIndex: number,
    size: number,
    band: number,
  ): void {
    // Cancel out-of-band queued requests so the new band isn't starved behind
    // stale prefetch work. (Preserves the pre-existing cancel-on-prefetch
    // behavior, now scoped to a moving window.)
    this.cancelPending();

    if (paths.length === 0) {
      return;
    }

    const center = Math.max(0, Math.min(currentIndex, paths.length - 1));
    const start = Math.max(0, center - band);
    const end = Math.min(paths.length - 1, center + band);

    for (let index = start; index <= end; index += 1) {
      void this.request(paths[index], size);
    }
  }

  cancelPending(): void {
    const queuedKeys = new Set(this.#queue.map((request) => request.key));
    if (queuedKeys.size > 0) {
      const nextEntries = { ...this.#entries };
      for (const key of queuedKeys) {
        if (!this.#inFlight.has(key) && nextEntries[key]?.status === "pending") {
          delete nextEntries[key];
          this.#removeFromRecency(key);
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

    let result: ThumbnailEntry | null = null;
    try {
      const thumbnail = await generateThumbnail({
        path: request.path,
        size: request.size,
      });
      result = { status: "ready", url: thumbnail.url };
    } catch (error) {
      const fallbackUrl = fallbackNativeThumbnailUrl(request.path, error);
      result =
        fallbackUrl !== null
          ? { status: "ready", url: fallbackUrl }
          : { status: "error", url: null };
    } finally {
      this.#inFlight.delete(request.key);
      this.#activeCount = Math.max(0, this.#activeCount - 1);

      // Generation guard: a completion from a superseded folder must not
      // repopulate the cache after a folder-change clear. Drop the pending
      // placeholder if it survived (it normally won't, since clear() resets
      // #entries) so a stale entry can never linger.
      if (request.generation !== this.#generation) {
        if (this.#entries[request.key]?.status === "pending") {
          const next = { ...this.#entries };
          delete next[request.key];
          this.#entries = next;
          this.#removeFromRecency(request.key);
        }
      } else if (result !== null) {
        this.#entries = {
          ...this.#entries,
          [request.key]: result,
        };
        this.#enforceLru();
      }

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
    this.#removeFromRecency(key);
  }

  /**
   * Begin a new folder generation: bumps the generation token (so any in-flight
   * prior-folder requests are dropped on completion) and clears the cache. This
   * is the race-free folder-change reset.
   */
  newGeneration(): number {
    this.#generation += 1;
    this.clear();
    return this.#generation;
  }

  /** Clear the entire session cache. */
  clear(): void {
    this.#entries = {};
    this.#inFlight.clear();
    this.#recency = [];
    this.cancelPending();
    this.#activeCount = 0;
  }
}

export const galleryThumbnails = new GalleryThumbnailCache();
