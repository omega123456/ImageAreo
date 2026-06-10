import { convertFileSrc, invoke, type InvokeArgs } from "@tauri-apps/api/core";

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

/**
 * Signal that the frontend has registered its listeners and is ready to
 * receive the initial launch path. Resolves to the buffered path (if any) so
 * the caller can open it directly — see the Phase 12 ready-handshake.
 */
export function frontendReady(): Promise<string | null> {
  return invokeCommand<string | null>(IPC_COMMANDS.frontendReady, {});
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
  return invokeCommand<{ path: string }>(
    IPC_COMMANDS.generateThumbnail,
    request as unknown as InvokeArgs,
  ).then((thumbnail) => ({
    url: convertFileSrc(thumbnail.path),
  }));
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
