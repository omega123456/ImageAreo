import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Minimal shape of a pending update the store needs. The real
 * `@tauri-apps/plugin-updater` {@link Update} satisfies this; tests inject a
 * lightweight stand-in so the available/install flow runs headlessly.
 */
export interface PendingUpdate {
  version: string;
  downloadAndInstall(): Promise<void>;
}

/** Resolves the current pending update (or `null`). Injectable for tests. */
export type UpdateChecker = () => Promise<PendingUpdate | null>;

/** Performs the post-install relaunch. Injectable for tests (OS side effect). */
export type Relauncher = () => Promise<void>;

/** Delay before the launch-time update check, so it never competes with the
 * first paint / image load. */
export const UPDATE_CHECK_DELAY_MS = 3000;

/**
 * Auto-updater state and actions.
 *
 * On launch (after {@link UPDATE_CHECK_DELAY_MS}) the store checks the
 * GitHub-hosted `latest.json` via the Tauri updater plugin. When an update is
 * available it surfaces a non-modal toast; "Later" dismisses the toast but
 * leaves a badge on the settings button and an entry in the settings drawer.
 *
 * The plugin `check` and `relaunch` are injected through {@link configure} so
 * the store is fully testable without a Tauri runtime. The actual download /
 * install / relaunch are OS process side effects (coverage-excluded).
 */
class UpdaterStore {
  /** Whether a newer version is available. */
  updateAvailable = $state<boolean>(false);
  /** Target version of the available update, if any. */
  updateVersion = $state<string | null>(null);
  /** True while the install+relaunch flow is running. */
  installing = $state<boolean>(false);
  /** True once "Later" was chosen: hides the toast, keeps the badge/entry. */
  dismissed = $state<boolean>(false);

  /** Whether the toast should be visible (available and not yet dismissed). */
  get showToast(): boolean {
    return this.updateAvailable && !this.dismissed;
  }

  /** Whether the persistent badge/drawer entry should show. */
  get showBadge(): boolean {
    return this.updateAvailable && this.dismissed;
  }

  #checker: UpdateChecker = defaultChecker;
  #relauncher: Relauncher = relaunch;
  #pending: PendingUpdate | null = null;

  /** Swap the update checker / relauncher (tests, or alternate transports). */
  configure(options: { checker?: UpdateChecker; relauncher?: Relauncher }): void {
    if (options.checker) this.#checker = options.checker;
    if (options.relauncher) this.#relauncher = options.relauncher;
  }

  /**
   * Check for an update. Safe to call anywhere — any failure (offline, no
   * Tauri runtime, malformed feed) leaves the store in its no-update state.
   */
  async checkForUpdate(): Promise<void> {
    try {
      const update = await this.#checker();
      if (!update) {
        this.#pending = null;
        this.updateAvailable = false;
        this.updateVersion = null;
        return;
      }
      this.#pending = update;
      this.updateVersion = update.version;
      this.updateAvailable = true;
    } catch {
      // No update surfaced on failure; the next launch will retry.
      this.#pending = null;
      this.updateAvailable = false;
      this.updateVersion = null;
    }
  }

  /**
   * Schedule the launch-time check after {@link UPDATE_CHECK_DELAY_MS}. Returns
   * a disposer that cancels the pending timer (e.g. on unmount).
   */
  scheduleLaunchCheck(): () => void {
    const handle = setTimeout(() => {
      void this.checkForUpdate();
    }, UPDATE_CHECK_DELAY_MS);
    return () => clearTimeout(handle);
  }

  /**
   * Download, install and relaunch into the new version. The download/install
   * and relaunch are OS process side effects (coverage-excluded); failures
   * clear the installing flag so the user can retry.
   */
  async installUpdate(): Promise<void> {
    if (!this.#pending || this.installing) return;
    this.installing = true;
    try {
      await this.#pending.downloadAndInstall();
      await this.#relauncher();
    } catch {
      this.installing = false;
    }
  }

  /** Hide the toast but keep the badge and the settings-drawer entry. */
  dismissUpdate(): void {
    this.dismissed = true;
  }

  /** Reset to a pristine state — test helper. */
  resetForTests(): void {
    this.updateAvailable = false;
    this.updateVersion = null;
    this.installing = false;
    this.dismissed = false;
    this.#pending = null;
    this.#checker = defaultChecker;
    this.#relauncher = relaunch;
  }
}

/** Default checker backed by the Tauri updater plugin. */
async function defaultChecker(): Promise<PendingUpdate | null> {
  const update: Update | null = await check();
  return update;
}

export const updater = new UpdaterStore();
