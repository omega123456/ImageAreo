import { getCurrentWindow } from "@tauri-apps/api/window";

export async function readFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen();
}

export async function writeFullscreen(fullscreen: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(fullscreen);
}
