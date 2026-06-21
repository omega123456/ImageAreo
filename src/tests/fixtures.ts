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
 *   query_file_associations  {}                   -> ExtAssociation[]
 *   set_default_associations { exts }             -> { ok }
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
  "plugin:clipboard-manager|write_text": () => null,
  "plugin:clipboard-manager|read_text": () => "",

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
  // Stable signature by default; auto-scan tests override to simulate change.
  folder_signature: () => 1_700_000_000_000,
  // Small, non-animated, within-ceiling probe by default so native images take
  // the direct (WebView) path. Tests override for large/animated/over-ceiling.
  probe_image: () => ({
    width: 800,
    height: 600,
    pixels: 480_000,
    animated: false,
    exceedsLimit: false,
  }),
  decode_image: () => ({
    path: "/tmp/imageareo-images/decoded.jpg",
    width: 1,
    height: 1,
    orientation: 1,
  }),
  // No enhanced cache by default; tests opt in by overriding this command.
  peek_decoded_image: () => null,
  sample_image: () =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  generate_thumbnail: () => ({
    path: "/tmp/imageareo-thumb.jpg",
  }),
  copy_image_to_clipboard: () => ({ ok: true }),
  reveal_in_file_manager: () => ({ ok: true }),
  // Accepts the paper size (mm) + orientation args from Phase 3 while keeping a
  // `void`-compatible return shape so the quick-print contract holds.
  print_current_view: (_args) => ({ ok: true }),
  query_file_associations: () => [
    { ext: "jpg", isDefault: true },
    { ext: "png", isDefault: false },
    { ext: "webp", isDefault: false },
  ],
  set_default_associations: () => ({ ok: true }),
  // Default: a JPEG carrying camera EXIF. Tests override for PNG/no-camera,
  // loading, or error cases.
  read_image_metadata: (args) => ({
    fileName: "IMG_4032.JPG",
    filePath: String(args?.path ?? "/photos/IMG_4032.JPG"),
    format: "JPEG",
    fileSizeBytes: 5_033_165,
    width: 4032,
    height: 3024,
    pixels: 12_192_768,
    colorType: "RGB",
    bitDepth: 8,
    orientation: 1,
    camera: {
      make: "Canon",
      model: "Canon EOS R6",
      lens: "RF24-105mm F4 L IS USM",
      iso: 400,
      aperture: 4.0,
      shutterSpeed: "1/250",
      focalLength: 50,
      dateTaken: "2026:06:10 14:32:00",
    },
  }),
};
