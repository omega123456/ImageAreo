import { getCurrentWindow } from "@tauri-apps/api/window";

/** Base application name, shown in the title bar when no image is open. */
export const APP_TITLE = "ImageAreo";

export async function readFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen();
}

export async function writeFullscreen(fullscreen: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(fullscreen);
}

/**
 * Build the window-title string for the currently loaded image. Shows the
 * filename followed by its full filesystem path, falling back to the bare app
 * name when nothing is open. Pure logic — kept separate from {@link writeTitle}
 * so it is testable without the OS window call.
 */
export function windowTitle(path: string | null, name: string | null): string {
  if (!path) return APP_TITLE;
  const label = name ?? path;
  return `${label} — ${path} — ${APP_TITLE}`;
}

export async function writeTitle(title: string): Promise<void> {
  await getCurrentWindow().setTitle(title);
}
