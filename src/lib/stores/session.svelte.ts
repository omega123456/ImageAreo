import { LazyStore } from "@tauri-apps/plugin-store";

/**
 * Persistent session state (Svelte 5 runes).
 *
 * Remembers the last image the user was viewing so it can be reopened on the
 * next launch — whether the app was closed normally or relaunched by the
 * auto-updater after installing an update. The path is written to its own
 * `session.json` store (separate from user `settings.json`) on every navigation
 * and read back once at launch.
 *
 * The launch-time restore is best-effort: a removed or unreadable file simply
 * leaves the viewer empty rather than surfacing an error.
 */

const STORE_PATH = "session.json";
const LAST_IMAGE_PATH_KEY = "lastImagePath";

class SessionStore {
  /** Path of the most recently viewed image, restored on the next launch. */
  lastImagePath = $state<string | null>(null);

  #store: LazyStore | null = null;
  #initialized = false;

  #ensureStore(): LazyStore {
    if (!this.#store) {
      this.#store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });
    }
    return this.#store;
  }

  /**
   * Load the persisted last-viewed image path. Idempotent; any failure (no Tauri
   * runtime, malformed store) leaves `lastImagePath` null so the restore no-ops.
   */
  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;

    try {
      const store = this.#ensureStore();
      await store.init();
      const stored = await store.get(LAST_IMAGE_PATH_KEY);
      this.lastImagePath =
        typeof stored === "string" && stored.length > 0 ? stored : null;
    } catch {
      this.lastImagePath = null;
    }
  }

  /**
   * Record the currently-viewed image path and persist it. A no-op when the path
   * is unchanged so repeated navigation to the same image avoids redundant
   * writes. Best-effort: a persistence failure is swallowed.
   */
  async setLastImagePath(path: string): Promise<void> {
    if (!path || path === this.lastImagePath) return;
    this.lastImagePath = path;

    try {
      const store = this.#ensureStore();
      await store.set(LAST_IMAGE_PATH_KEY, path);
      await store.save();
    } catch {
      // Best-effort: losing one write only forfeits the restore on next launch.
    }
  }

  resetForTests(): void {
    this.lastImagePath = null;
    this.#store = null;
    this.#initialized = false;
  }
}

export const session = new SessionStore();
