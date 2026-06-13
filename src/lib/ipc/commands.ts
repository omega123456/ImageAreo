export const IPC_COMMANDS = {
  frontendReady: "frontend_ready",
  queryFileAssociations: "query_file_associations",
  setDefaultAssociations: "set_default_associations",
  scanFolder: "scan_folder",
  decodeImage: "decode_image",
  peekDecodedImage: "peek_decoded_image",
  sampleImage: "sample_image",
  generateThumbnail: "generate_thumbnail",
  copyImageToClipboard: "copy_image_to_clipboard",
  revealInFileManager: "reveal_in_file_manager",
} as const;

/**
 * Backend → frontend event names (Phase 12). Kept in sync with the Rust
 * `startup::OPEN_PATH_EVENT` and `menu::MENU_EVENT` constants.
 */
export const IPC_EVENTS = {
  /** Carries a filesystem path to open (launch path / macOS Opened event). */
  openPath: "imageareo://open-path",
  /** Carries a native-menu action key (matches the Rust menu item ids). */
  menu: "imageareo://menu",
} as const;

/**
 * Native-menu action keys. These mirror `src-tauri/src/menu/mod.rs::ids` and
 * are the payloads delivered on the `menu` event.
 */
export const MENU_ACTIONS = {
  open: "file.open",
  openFolder: "file.open_folder",
  fit: "view.fit",
  actualSize: "view.actual_size",
  toggleGallery: "view.toggle_gallery",
  toggleFullscreen: "view.toggle_fullscreen",
  settings: "app.settings",
} as const;

export type MenuAction = (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS];

export type SortOrder = "name" | "date";

export interface ImageEntry {
  path: string;
  name: string;
  modified: number;
}

export interface DecodedImage {
  /** On-disk cache file path returned by the backend decode command. */
  path: string;
  width: number;
  height: number;
  orientation: number;
}

export type DecodeImageQuality = "preview" | "display" | "enhance";

export interface Thumbnail {
  url: string;
}

export interface OkResponse {
  ok: true;
}

export interface ExtAssociation {
  ext: string;
  isDefault: boolean;
}

export interface ScanFolderRequest {
  path: string;
  sortOrder: SortOrder;
}

export interface DecodeImageRequest {
  path: string;
  quality?: DecodeImageQuality;
}

export interface GenerateThumbnailRequest {
  path: string;
  size: number;
}

export interface SampleImageRequest {
  path: string;
  size: number;
}

export interface CopyImageToClipboardRequest {
  path: string;
}

export interface RevealInFileManagerRequest {
  path: string;
}

export interface SetDefaultAssociationsRequest {
  exts: string[];
}
