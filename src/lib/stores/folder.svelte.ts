import { scanFolder } from "../ipc";
import type { ImageEntry } from "../ipc/commands";
import { settings } from "./settings.svelte";

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

  reset(): void {
    this.path = "";
    this.images = [];
    this.currentIndex = -1;
    this.isLoading = false;
    this.error = null;
  }
}

export const folder = new FolderStore();
