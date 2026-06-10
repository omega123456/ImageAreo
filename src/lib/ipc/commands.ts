export const IPC_COMMANDS = {
  scanFolder: "scan_folder",
  decodeImage: "decode_image",
  generateThumbnail: "generate_thumbnail",
  copyImageToClipboard: "copy_image_to_clipboard",
  revealInFileManager: "reveal_in_file_manager",
} as const;

export type SortOrder = "name" | "date";

export interface ImageEntry {
  path: string;
  name: string;
  modified: number;
}

export interface DecodedImage {
  dataUrl: string;
  width: number;
  height: number;
  orientation: number;
}

export interface Thumbnail {
  dataUrl: string;
}

export interface OkResponse {
  ok: true;
}

export interface ScanFolderRequest {
  path: string;
  sortOrder: SortOrder;
}

export interface DecodeImageRequest {
  path: string;
}

export interface GenerateThumbnailRequest {
  path: string;
  size: number;
}

export interface CopyImageToClipboardRequest {
  path: string;
}

export interface RevealInFileManagerRequest {
  path: string;
}
