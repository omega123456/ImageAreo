/**
 * Default IPC response fixtures for Vitest tests.
 *
 * Maps every Tauri IPC command in the ImageAreo contract to a stable default
 * response. Individual tests override any command via `ipc.override(cmd, fn)`.
 *
 * The application-level commands below are intentionally FRONT-LOADED against
 * the full contract table in the plan even though some are implemented in later
 * phases (scan_folder/decode_image in P4/P5, generate_thumbnail in P6,
 * copy_image_to_clipboard/reveal_in_file_manager in P7). The fixture shapes are
 * the agreed contract, so tests written in those phases need no new wiring here.
 *
 * Contract (from the plan's API table):
 *   scan_folder              { path, sortOrder }  -> ImageEntry[]
 *   decode_image             { path }             -> DecodedImage
 *   generate_thumbnail       { path, size }       -> Thumbnail
 *   copy_image_to_clipboard  { path }             -> { ok }
 *   reveal_in_file_manager   { path }             -> { ok }
 */

export type IpcHandler = (
  args?: Record<string, unknown>,
  commandName?: string,
) => unknown;

const STORE_RESOURCE_ID = 1;
const storeState = new Map<string, unknown>();

export function resetFixtureState(): void {
  storeState.clear();
}

export const IPC_FIXTURES: Record<string, IpcHandler> = {
  // --- Tauri event system (handled by shouldMockEvents; here for completeness) ---
  "plugin:event|listen": (args) => args?.handler ?? null,
  "plugin:event|unlisten": () => null,

  // --- Tauri plugin: dialog (Open File / Open Folder) ---
  "plugin:dialog|open": () => null,
  "plugin:dialog|save": () => null,

  // --- Tauri plugin: clipboard-manager ---
  "plugin:clipboard-manager|write-text": () => null,
  "plugin:clipboard-manager|read-text": () => "",

  // --- Tauri plugin: store ---
  "plugin:store|load": (args) => {
    const defaults = (args?.options as { defaults?: Record<string, unknown> } | undefined)
      ?.defaults;
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        if (!storeState.has(key)) {
          storeState.set(key, value);
        }
      }
    }
    return STORE_RESOURCE_ID;
  },
  "plugin:store|get_store": () => STORE_RESOURCE_ID,
  "plugin:store|get": (args) => {
    const key = String(args?.key ?? "");
    return [storeState.get(key), storeState.has(key)];
  },
  "plugin:store|set": (args) => {
    storeState.set(String(args?.key ?? ""), args?.value);
    return null;
  },
  "plugin:store|save": () => null,
  "plugin:store|has": (args) => storeState.has(String(args?.key ?? "")),
  "plugin:store|delete": (args) => storeState.delete(String(args?.key ?? "")),
  "plugin:store|clear": () => {
    storeState.clear();
    return null;
  },
  "plugin:store|reset": () => {
    storeState.clear();
    return null;
  },
  "plugin:store|keys": () => [...storeState.keys()],
  "plugin:store|values": () => [...storeState.values()],
  "plugin:store|entries": () => [...storeState.entries()],
  "plugin:store|length": () => storeState.size,
  "plugin:store|reload": () => null,

  // --- Tauri plugin: opener ---
  "plugin:opener|open_path": () => null,

  // --- Tauri plugin: updater ---
  "plugin:updater|check": () => null,
  "plugin:updater|download_and_install": () => null,

  // --- Tauri plugin: process ---
  "plugin:process|relaunch": () => null,

  // --- ImageAreo application commands ---
  scan_folder: () => [
    {
      path: "/photos/img1.jpg",
      name: "img1.jpg",
      modified: 1_700_000_000_000,
    },
    {
      path: "/photos/img2.png",
      name: "img2.png",
      modified: 1_700_000_100_000,
    },
  ],
  decode_image: () => ({
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
    width: 1,
    height: 1,
    orientation: 1,
  }),
  generate_thumbnail: () => ({
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  }),
  copy_image_to_clipboard: () => ({ ok: true }),
  reveal_in_file_manager: () => ({ ok: true }),
};
