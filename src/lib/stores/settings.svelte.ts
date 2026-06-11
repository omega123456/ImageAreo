import { LazyStore } from "@tauri-apps/plugin-store";

import type { SortOrder } from "../ipc/commands";

export type ThemeSetting = "system" | "light" | "dark";

export type GalleryDensity = "small" | "medium" | "large";

export interface DensityDimensions {
  stripHeight: number;
  thumbnailSize: number;
}

export const DENSITY_DIMENSIONS: Record<GalleryDensity, DensityDimensions> = {
  small: { stripHeight: 96, thumbnailSize: 80 },
  medium: { stripHeight: 144, thumbnailSize: 128 },
  large: { stripHeight: 208, thumbnailSize: 192 },
};

export interface SettingsSnapshot {
  theme: ThemeSetting;
  galleryDensity: GalleryDensity;
  sortOrder: SortOrder;
}

const STORE_PATH = "settings.json";

const STORE_KEYS = {
  theme: "theme",
  galleryDensity: "galleryDensity",
  sortOrder: "sortOrder",
} as const;

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  theme: "system",
  galleryDensity: "large",
  sortOrder: "name",
};

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "system" || value === "light" || value === "dark";
}

function isGalleryDensity(value: unknown): value is GalleryDensity {
  return value === "small" || value === "medium" || value === "large";
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === "name" || value === "date";
}

class SettingsStore {
  theme = $state<ThemeSetting>(DEFAULT_SETTINGS.theme);
  galleryDensity = $state<GalleryDensity>(DEFAULT_SETTINGS.galleryDensity);
  sortOrder = $state<SortOrder>(DEFAULT_SETTINGS.sortOrder);
  isReady = $state<boolean>(false);
  loadError = $state<string | null>(null);

  #store: LazyStore | null = null;
  #initialized = false;
  #themeQuery: MediaQueryList | null = null;
  #removeThemeListener: (() => void) | null = null;

  get resolvedTheme(): "light" | "dark" {
    if (this.theme === "system") {
      return this.#themeQuery?.matches ? "dark" : "light";
    }
    return this.theme;
  }

  get canvasSurroundMode(): "light" | "dark" {
    return this.resolvedTheme;
  }

  get densityDimensions(): DensityDimensions {
    return DENSITY_DIMENSIONS[this.galleryDensity];
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      this.applyTheme();
      return;
    }

    this.#initialized = true;
    this.#setupThemeListener();
    this.isReady = false;
    this.loadError = null;

    try {
      this.#store = new LazyStore(STORE_PATH, {
        defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        autoSave: false,
      });
      await this.#store.init();

      const theme = await this.#store.get(STORE_KEYS.theme);
      const galleryDensity = await this.#store.get(STORE_KEYS.galleryDensity);
      const sortOrder = await this.#store.get(STORE_KEYS.sortOrder);

      this.theme = isThemeSetting(theme) ? theme : DEFAULT_SETTINGS.theme;
      this.galleryDensity = isGalleryDensity(galleryDensity)
        ? galleryDensity
        : DEFAULT_SETTINGS.galleryDensity;
      this.sortOrder = isSortOrder(sortOrder)
        ? sortOrder
        : DEFAULT_SETTINGS.sortOrder;
    } catch (error) {
      this.#store = null;
      this.loadError =
        error instanceof Error ? error.message : "Failed to load settings";
      this.#applySnapshot(DEFAULT_SETTINGS);
    }

    this.applyTheme();
    this.isReady = true;
  }

  async setTheme(theme: ThemeSetting): Promise<void> {
    this.theme = theme;
    this.applyTheme();
    await this.#persist(STORE_KEYS.theme, theme);
  }

  async setGalleryDensity(galleryDensity: GalleryDensity): Promise<void> {
    const next = isGalleryDensity(galleryDensity)
      ? galleryDensity
      : this.galleryDensity;
    this.galleryDensity = next;
    await this.#persist(STORE_KEYS.galleryDensity, next);
  }

  async setSortOrder(sortOrder: SortOrder): Promise<void> {
    this.sortOrder = sortOrder;
    await this.#persist(STORE_KEYS.sortOrder, sortOrder);
  }

  snapshot(): SettingsSnapshot {
    return {
      theme: this.theme,
      galleryDensity: this.galleryDensity,
      sortOrder: this.sortOrder,
    };
  }

  applyTheme(): void {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.dataset.theme = "cerberus";
    root.dataset.appearance = this.resolvedTheme;
    root.style.colorScheme = this.resolvedTheme;
    root.classList.toggle("dark", this.resolvedTheme === "dark");
  }

  resetForTests(): void {
    this.#removeThemeListener?.();
    this.#removeThemeListener = null;
    this.#themeQuery = null;
    this.#store = null;
    this.#initialized = false;
    this.isReady = false;
    this.loadError = null;
    this.#applySnapshot(DEFAULT_SETTINGS);

    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.style.colorScheme = "";
      delete root.dataset.theme;
      delete root.dataset.appearance;
      root.classList.remove("dark");
    }
  }

  #applySnapshot(snapshot: SettingsSnapshot): void {
    this.theme = snapshot.theme;
    this.galleryDensity = snapshot.galleryDensity;
    this.sortOrder = snapshot.sortOrder;
  }

  #setupThemeListener(): void {
    if (typeof window === "undefined") return;

    this.#removeThemeListener?.();
    this.#themeQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const onChange = () => {
      if (this.theme === "system") {
        this.applyTheme();
      }
    };

    this.#themeQuery.addEventListener("change", onChange);
    this.#removeThemeListener = () => {
      this.#themeQuery?.removeEventListener("change", onChange);
    };
  }

  async #persist(key: string, value: unknown): Promise<void> {
    if (!this.#store) return;
    await this.#store.set(key, value);
    await this.#store.save();
  }
}

export const settings = new SettingsStore();
