import { LazyStore } from "@tauri-apps/plugin-store";

import { setLogLevel } from "../ipc";
import type { LogLevel, SortOrder } from "../ipc/commands";

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
  logLevel: LogLevel;
}

const STORE_PATH = "settings.json";

const STORE_KEYS = {
  theme: "theme",
  galleryDensity: "galleryDensity",
  sortOrder: "sortOrder",
  // Also read by the Rust logger at launch (`logging::SETTINGS_LOG_LEVEL_KEY`).
  logLevel: "logLevel",
} as const;

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  theme: "system",
  galleryDensity: "large",
  sortOrder: "name",
  logLevel: "info",
};

export const LOG_LEVELS: readonly LogLevel[] = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "system" || value === "light" || value === "dark";
}

function isGalleryDensity(value: unknown): value is GalleryDensity {
  return value === "small" || value === "medium" || value === "large";
}

function isSortOrder(value: unknown): value is SortOrder {
  return value === "name" || value === "date";
}

export function isLogLevel(value: unknown): value is LogLevel {
  return (LOG_LEVELS as readonly unknown[]).includes(value);
}

class SettingsStore {
  theme = $state<ThemeSetting>(DEFAULT_SETTINGS.theme);
  galleryDensity = $state<GalleryDensity>(DEFAULT_SETTINGS.galleryDensity);
  sortOrder = $state<SortOrder>(DEFAULT_SETTINGS.sortOrder);
  logLevel = $state<LogLevel>(DEFAULT_SETTINGS.logLevel);
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
      const logLevel = await this.#store.get(STORE_KEYS.logLevel);

      this.theme = isThemeSetting(theme) ? theme : DEFAULT_SETTINGS.theme;
      this.galleryDensity = isGalleryDensity(galleryDensity)
        ? galleryDensity
        : DEFAULT_SETTINGS.galleryDensity;
      this.sortOrder = isSortOrder(sortOrder)
        ? sortOrder
        : DEFAULT_SETTINGS.sortOrder;
      this.logLevel = isLogLevel(logLevel) ? logLevel : DEFAULT_SETTINGS.logLevel;
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

  /**
   * Apply the level to the running backend logger and persist it; the backend
   * reads the persisted value from `settings.json` on the next launch.
   */
  async setLogLevel(logLevel: LogLevel): Promise<void> {
    const next = isLogLevel(logLevel) ? logLevel : this.logLevel;
    this.logLevel = next;
    await setLogLevel({ level: next });
    await this.#persist(STORE_KEYS.logLevel, next);
  }

  snapshot(): SettingsSnapshot {
    return {
      theme: this.theme,
      galleryDensity: this.galleryDensity,
      sortOrder: this.sortOrder,
      logLevel: this.logLevel,
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
    this.logLevel = snapshot.logLevel;
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
