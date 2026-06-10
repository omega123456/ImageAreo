import { invoke, type InvokeArgs } from "@tauri-apps/api/core";

import {
  IPC_COMMANDS,
  type CopyImageToClipboardRequest,
  type DecodeImageRequest,
  type DecodedImage,
  type GenerateThumbnailRequest,
  type ImageEntry,
  type OkResponse,
  type RevealInFileManagerRequest,
  type ScanFolderRequest,
  type Thumbnail,
} from "./commands";

function invokeCommand<TResponse>(
  command: string,
  request: InvokeArgs,
): Promise<TResponse> {
  return invoke<TResponse>(command, request);
}

export function scanFolder(request: ScanFolderRequest): Promise<ImageEntry[]> {
  return invokeCommand<ImageEntry[]>(
    IPC_COMMANDS.scanFolder,
    request as unknown as InvokeArgs,
  );
}

export function decodeImage(request: DecodeImageRequest): Promise<DecodedImage> {
  return invokeCommand<DecodedImage>(
    IPC_COMMANDS.decodeImage,
    request as unknown as InvokeArgs,
  );
}

export function generateThumbnail(
  request: GenerateThumbnailRequest,
): Promise<Thumbnail> {
  return invokeCommand<Thumbnail>(
    IPC_COMMANDS.generateThumbnail,
    request as unknown as InvokeArgs,
  );
}

export function copyImageToClipboard(
  request: CopyImageToClipboardRequest,
): Promise<OkResponse> {
  return invokeCommand<OkResponse>(
    IPC_COMMANDS.copyImageToClipboard,
    request as unknown as InvokeArgs,
  );
}

export function revealInFileManager(
  request: RevealInFileManagerRequest,
): Promise<OkResponse> {
  return invokeCommand<OkResponse>(
    IPC_COMMANDS.revealInFileManager,
    request as unknown as InvokeArgs,
  );
}
