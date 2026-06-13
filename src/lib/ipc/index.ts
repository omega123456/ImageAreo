import { convertFileSrc, invoke, type InvokeArgs } from "@tauri-apps/api/core";

import {
  type ExtAssociation,
  IPC_COMMANDS,
  type CopyImageToClipboardRequest,
  type DecodeImageRequest,
  type DecodedImage,
  type GenerateThumbnailRequest,
  type ImageEntry,
  type OkResponse,
  type RevealInFileManagerRequest,
  type SampleImageRequest,
  type ScanFolderRequest,
  type SetDefaultAssociationsRequest,
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

export function queryFileAssociations(): Promise<ExtAssociation[]> {
  return invokeCommand<ExtAssociation[]>(IPC_COMMANDS.queryFileAssociations, {});
}

export function setDefaultAssociations(
  request: SetDefaultAssociationsRequest,
): Promise<OkResponse> {
  return invokeCommand<OkResponse>(
    IPC_COMMANDS.setDefaultAssociations,
    request as unknown as InvokeArgs,
  );
}

export function scanFolder(request: ScanFolderRequest): Promise<ImageEntry[]> {
  return invokeCommand<ImageEntry[]>(
    IPC_COMMANDS.scanFolder,
    request as unknown as InvokeArgs,
  );
}

/** A decoded backend image with its cache path resolved to an asset URL. */
export type DecodedImageWithUrl = DecodedImage & { url: string };

export async function decodeImage(
  request: DecodeImageRequest,
): Promise<DecodedImageWithUrl> {
  const decoded = await invokeCommand<DecodedImage>(
    IPC_COMMANDS.decodeImage,
    request as unknown as InvokeArgs,
  );
  return {
    ...decoded,
    url: convertFileSrc(decoded.path),
  };
}

/**
 * Return an already-cached decode result for `request` without decoding, or
 * `null` when nothing is cached. Used to prefer a previously-enhanced image on
 * reopen without triggering a fresh demosaic.
 */
export async function peekDecodedImage(
  request: DecodeImageRequest,
): Promise<DecodedImageWithUrl | null> {
  const decoded = await invokeCommand<DecodedImage | null>(
    IPC_COMMANDS.peekDecodedImage,
    request as unknown as InvokeArgs,
  );
  if (!decoded) {
    return null;
  }
  return {
    ...decoded,
    url: convertFileSrc(decoded.path),
  };
}

/** Small downscaled image as a same-origin data URL for backdrop sampling. */
export function sampleImage(request: SampleImageRequest): Promise<string> {
  return invokeCommand<string>(
    IPC_COMMANDS.sampleImage,
    request as unknown as InvokeArgs,
  );
}

export async function generateThumbnail(
  request: GenerateThumbnailRequest,
): Promise<Thumbnail> {
  const thumbnail = await invokeCommand<{ path: string }>(
    IPC_COMMANDS.generateThumbnail,
    request as unknown as InvokeArgs,
  );
  return {
    url: convertFileSrc(thumbnail.path),
  };
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
