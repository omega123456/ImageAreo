/**
 * File-open entry points & multi-instance plumbing (Phase 12).
 *
 * Centralizes the three ways a path enters ImageAreo — OS file association
 * (launch path / macOS Opened event), drag-and-drop onto the window, and the
 * File>Open / Open Folder menu+toolbar — and routes native-menu actions to the
 * frontend view/store actions.
 *
 * All `invoke`/event access goes through the `ipc` layer; the pure helpers
 * (path extraction, menu routing) are unit-tested, and the listener-wiring
 * `registerEntryPoints` is exercised against the IPC mock seam.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { frontendReady } from "../ipc";
import { IPC_EVENTS, MENU_ACTIONS, type MenuAction } from "../ipc/commands";
import { folder } from "../stores/folder.svelte";
import { session } from "../stores/session.svelte";
import { viewer } from "../stores/viewer.svelte";

let openRequestId = 0;

function looksLikeDirectoryPath(path: string): boolean {
  const normalized = path.replace(/[\\/]+$/, "");
  const leaf = normalized.split(/[\\/]/).pop() ?? "";
  return !leaf.includes(".");
}

/**
 * Open a filesystem path: resolve its folder via `scan_folder` and load the
 * selected image into the viewer. Shared by every open entry point.
 */
export async function openPath(path: string): Promise<void> {
  const requestId = ++openRequestId;
  await folder.open(path);
  if (requestId !== openRequestId) return;

  // After scan, prefer the resolved current entry (handles folder drops, where
  // the dropped path is a directory rather than a specific image).
  const target = folder.current?.path;
  if (!target) {
    if (folder.error === null && looksLikeDirectoryPath(path)) viewer.reset();
    return;
  }

  void session.setLastImagePath(target);
  await viewer.openPath(target);
}

/**
 * Reopen the image the user was last viewing, restored from the persisted
 * session. Best-effort: a missing/unreadable file leaves the viewer empty. Used
 * at launch when no file-association/launch path was provided, so a normal
 * close+reopen — or an updater relaunch — lands back on the last image.
 */
export async function restoreLastSession(): Promise<void> {
  await session.initialize();
  const path = session.lastImagePath;
  if (!path) return;
  await openPath(path);
}

/** Jump to an image index in the current folder and load it into the viewer. */
export async function goToIndex(index: number): Promise<void> {
  const before = folder.currentIndex;
  const entry = folder.selectIndex(index);
  if (!entry || folder.currentIndex === before) return;
  void session.setLastImagePath(entry.path);
  await viewer.openPath(entry.path);
}

/**
 * Step to an adjacent image in the current folder and load it. `step` advances
 * the folder index (next/prev), and the newly current entry is opened through
 * `viewer.openPath`, whose `load()` resets the transform — so navigation always
 * lands on a centered fit. A no-op at the folder boundary leaves the view as-is.
 */
async function step(advance: () => { path: string } | null): Promise<void> {
  const before = folder.currentIndex;
  const entry = advance();
  if (!entry || folder.currentIndex === before) return;
  void session.setLastImagePath(entry.path);
  await viewer.openPath(entry.path);
}

/** Navigate to the next image (resets zoom to fit). */
export function goNext(): Promise<void> {
  return step(() => folder.next());
}

/** Navigate to the previous image (resets zoom to fit). */
export function goPrev(): Promise<void> {
  return step(() => folder.prev());
}

/**
 * Extract the first dropped path from a Tauri native drag-drop "drop" payload.
 * HTML5 dragover is disabled by `dragDropEnabled`, so drops arrive as Tauri
 * webview drag-drop events whose drop payload carries an array of paths.
 */
export function pathFromDropPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { type?: unknown; paths?: unknown };
  if (record.type !== undefined && record.type !== "drop") return null;
  const paths = record.paths;
  if (!Array.isArray(paths)) return null;
  const first = paths.find((p) => typeof p === "string" && p.length > 0);
  return typeof first === "string" ? first : null;
}

/**
 * Handlers that App.svelte supplies for view actions whose implementation lives
 * in the component/controller layer (or in features that land in later phases).
 * Unset handlers are simply ignored, so menu items become functional as P10
 * (gallery) and P16 (fullscreen) wire themselves up.
 */
export interface MenuActionHandlers {
  openDialog?: () => void;
  openFolderDialog?: () => void;
  fit?: () => void;
  actualSize?: () => void;
  toggleGallery?: () => void;
  toggleFullscreen?: () => void;
  openSettings?: () => void;
}

/** Route a native-menu action key to the matching handler. */
export function dispatchMenuAction(
  action: MenuAction | string,
  handlers: MenuActionHandlers,
): void {
  switch (action) {
    case MENU_ACTIONS.open:
      handlers.openDialog?.();
      break;
    case MENU_ACTIONS.openFolder:
      handlers.openFolderDialog?.();
      break;
    case MENU_ACTIONS.fit:
      handlers.fit?.();
      break;
    case MENU_ACTIONS.actualSize:
      handlers.actualSize?.();
      break;
    case MENU_ACTIONS.toggleGallery:
      handlers.toggleGallery?.();
      break;
    case MENU_ACTIONS.toggleFullscreen:
      handlers.toggleFullscreen?.();
      break;
    case MENU_ACTIONS.settings:
      handlers.openSettings?.();
      break;
    // Unknown keys (natively-handled items) are ignored.
  }
}

/**
 * Register all Phase-12 listeners and complete the ready-handshake.
 *
 * 1. Listen for backend `open-path` events (post-ready file-association opens).
 * 2. Listen for native menu events and route them to `handlers`.
 * 3. Listen for native webview drag-drop "drop" events and open the path.
 * 4. Signal `frontend_ready`; if the backend buffered a cold-launch path, open
 *    it now (the buffering closes the macOS Opened-before-ready race). With no
 *    launch path, restore the last-viewed image from the persisted session.
 *
 * Returns an unlisten function that detaches every listener.
 */
export async function registerEntryPoints(
  handlers: MenuActionHandlers,
): Promise<UnlistenFn> {
  const unlistenOpenPath = await listen<string>(IPC_EVENTS.openPath, (event) => {
    if (typeof event.payload === "string" && event.payload.length > 0) {
      void openPath(event.payload);
    }
  });

  const unlistenMenu = await listen<string>(IPC_EVENTS.menu, (event) => {
    dispatchMenuAction(event.payload, handlers);
  });

  const unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
    const path = pathFromDropPayload(event.payload);
    if (path) void openPath(path);
  });

  // Handshake: tell the backend we are ready and flush any buffered launch path.
  // With no launch path (normal start, or an updater relaunch), fall back to
  // reopening the last image the user was viewing.
  const buffered = await frontendReady();
  if (typeof buffered === "string" && buffered.length > 0) {
    await openPath(buffered);
  } else {
    await restoreLastSession();
  }

  return () => {
    unlistenOpenPath();
    unlistenMenu();
    unlistenDrop();
  };
}
