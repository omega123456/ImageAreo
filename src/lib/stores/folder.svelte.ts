import { folderSignature, scanFolder } from "../ipc";
import type { ImageEntry } from "../ipc/commands";
import { settings } from "./settings.svelte";

/** Auto-scan poll interval. Cheap (one directory stat) unless the dir changed. */
export const AUTO_SCAN_INTERVAL_MS = 1500;

function directoryOf(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return lastSeparator <= 0 ? normalized : normalized.slice(0, lastSeparator);
}

class FolderStore {
  private openRequestId = 0;

  /** Last observed directory signature; `null` re-baselines on the next poll. */
  private lastSignature: number | null = null;
  private autoScanTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  /** Guards against overlapping auto-scan ticks while one is awaiting IPC. */
  private polling = false;

  path = $state<string>("");
  images = $state<ImageEntry[]>([]);
  currentIndex = $state<number>(-1);
  isLoading = $state<boolean>(false);
  error = $state<string | null>(null);

  get current(): ImageEntry | null {
    return this.images[this.currentIndex] ?? null;
  }

  get hasPrev(): boolean {
    return this.currentIndex > 0;
  }

  get hasNext(): boolean {
    return this.currentIndex >= 0 && this.currentIndex < this.images.length - 1;
  }

  async open(selectedPath: string): Promise<ImageEntry | null> {
    const requestId = ++this.openRequestId;
    this.isLoading = true;
    this.error = null;
    // New folder: re-baseline the signature on the next auto-scan tick.
    this.lastSignature = null;

    try {
      const images = await scanFolder({
        path: selectedPath,
        sortOrder: settings.sortOrder,
      });
      if (requestId !== this.openRequestId) return null;

      this.images = images;
      this.path = images[0] ? directoryOf(images[0].path) : directoryOf(selectedPath);

      const selectedIndex = images.findIndex((entry) => entry.path === selectedPath);
      this.currentIndex = selectedIndex >= 0 ? selectedIndex : images.length > 0 ? 0 : -1;
      return this.current;
    } catch (error) {
      if (requestId !== this.openRequestId) return null;

      this.images = [];
      this.currentIndex = -1;
      this.path = directoryOf(selectedPath);
      this.error =
        error instanceof Error ? error.message : "Failed to scan folder";
      return null;
    } finally {
      if (requestId === this.openRequestId) {
        this.isLoading = false;
      }
    }
  }

  async reloadForSortOrder(sortOrder: "name" | "date"): Promise<ImageEntry | null> {
    const selectedPath = this.current?.path;
    const rootPath = selectedPath || this.path;
    if (!rootPath) return this.current;

    const requestId = ++this.openRequestId;
    this.isLoading = true;
    this.error = null;
    // Re-baseline like open(): if rootPath is a different folder, a retained
    // signature must not coincidentally suppress the first real rescan.
    this.lastSignature = null;

    try {
      const images = await scanFolder({
        path: rootPath,
        sortOrder,
      });
      if (requestId !== this.openRequestId) return null;

      this.images = images;
      this.path = images[0] ? directoryOf(images[0].path) : directoryOf(rootPath);
      this.currentIndex =
        selectedPath == null
          ? images.length > 0
            ? 0
            : -1
          : images.findIndex((entry) => entry.path === selectedPath);
      if (this.currentIndex < 0 && images.length > 0) {
        this.currentIndex = 0;
      }
      return this.current;
    } catch (error) {
      if (requestId !== this.openRequestId) return null;
      this.error =
        error instanceof Error ? error.message : "Failed to scan folder";
      return null;
    } finally {
      if (requestId === this.openRequestId) {
        this.isLoading = false;
      }
    }
  }

  selectIndex(index: number): ImageEntry | null {
    if (index < 0 || index >= this.images.length) return this.current;
    if (index === this.currentIndex) return this.current;
    this.currentIndex = index;
    return this.current;
  }

  next(): ImageEntry | null {
    if (!this.hasNext) return this.current;
    this.currentIndex += 1;
    return this.current;
  }

  prev(): ImageEntry | null {
    if (!this.hasPrev) return this.current;
    this.currentIndex -= 1;
    return this.current;
  }

  /**
   * Begin auto-scanning the open folder for added/removed files. Each tick does
   * one cheap directory stat (`folderSignature`) and only runs a full
   * `scanFolder` + merge when the signature changed. Idempotent. Polling pauses
   * while the document is hidden and resumes (with an immediate scan) on return.
   */
  startAutoScan(): void {
    if (this.autoScanTimer !== null) return;

    this.autoScanTimer = setInterval(() => {
      void this.pollOnce();
    }, AUTO_SCAN_INTERVAL_MS);

    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "visible") {
          void this.pollOnce();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  /** Stop auto-scanning and detach the visibility listener. Idempotent. */
  stopAutoScan(): void {
    if (this.autoScanTimer !== null) {
      clearInterval(this.autoScanTimer);
      this.autoScanTimer = null;
    }
    if (this.visibilityHandler !== null && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }

  /**
   * One auto-scan tick: stat the directory; on the first observation (or after a
   * folder change) capture the baseline without rescanning; otherwise rescan and
   * merge only when the signature moved. No-ops when no folder is open, while a
   * load is in flight, when the document is hidden, or when a tick is already
   * running. Backend errors (folder removed/unreadable) are swallowed so a
   * transient failure leaves the current listing untouched.
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    if (this.isLoading) return;
    const root = this.path;
    if (!root) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    // Capture the open token so a concurrent open()/reloadForSortOrder() that
    // lands during our awaits supersedes this tick — the directory `path` alone
    // is unchanged when reopening another image or flipping sort in the same
    // folder, so the path check below is not sufficient on its own.
    const requestId = this.openRequestId;
    this.polling = true;
    try {
      let signature: number;
      try {
        signature = await folderSignature({ path: root });
      } catch {
        return;
      }
      if (root !== this.path || requestId !== this.openRequestId) return;

      if (this.lastSignature === null) {
        this.lastSignature = signature;
        return;
      }
      if (signature === this.lastSignature) return;

      let images: ImageEntry[];
      try {
        images = await scanFolder({ path: root, sortOrder: settings.sortOrder });
      } catch {
        return;
      }
      if (root !== this.path || requestId !== this.openRequestId) return;

      this.lastSignature = signature;
      this.mergeImages(images);
    } finally {
      this.polling = false;
    }
  }

  /**
   * Reconcile the listing against a fresh scan without a wholesale reassign:
   * preserves the current selection by path so navigation/scroll survive a tick,
   * and keeps the currently-viewed entry visible even if it was deleted on disk
   * (it drops on a later scan once the user navigates away). A no-op when the
   * path list is already identical, so an unchanged folder produces no churn.
   */
  mergeImages(next: ImageEntry[]): void {
    const currentPath = this.current?.path ?? null;

    let merged = next;
    if (currentPath !== null && !next.some((entry) => entry.path === currentPath)) {
      const kept = this.images[this.currentIndex];
      if (kept) {
        const at = Math.min(Math.max(this.currentIndex, 0), next.length);
        merged = [...next.slice(0, at), kept, ...next.slice(at)];
      }
    }

    if (samePaths(this.images, merged)) return;

    this.images = merged;
    if (currentPath === null) {
      this.currentIndex = merged.length > 0 ? 0 : -1;
      return;
    }
    const index = merged.findIndex((entry) => entry.path === currentPath);
    this.currentIndex = index >= 0 ? index : merged.length > 0 ? 0 : -1;
  }

  reset(): void {
    this.path = "";
    this.images = [];
    this.currentIndex = -1;
    this.isLoading = false;
    this.error = null;
    this.lastSignature = null;
  }
}

function samePaths(a: ImageEntry[], b: ImageEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].path !== b[index].path) return false;
  }
  return true;
}

export const folder = new FolderStore();
