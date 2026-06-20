import { describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import {
  copyImageToClipboard,
  decodeImage,
  generateThumbnail,
  printCurrentView,
  readImageMetadata,
  revealInFileManager,
  scanFolder,
} from "../lib/ipc";

describe("IPC wrappers", () => {
  it("forwards each command through the IPC seam with typed payloads", async () => {
    await scanFolder({ path: "/photos/img1.jpg", sortOrder: "date" });
    const decoded = await decodeImage({ path: "/photos/img1.heic" });
    await decodeImage({ path: "/photos/raw.dng", quality: "preview" });
    const thumbnail = await generateThumbnail({ path: "/photos/img1.jpg", size: 128 });
    await copyImageToClipboard({ path: "/photos/img1.jpg" });
    await revealInFileManager({ path: "/photos/img1.jpg" });
    await printCurrentView();

    expect(ipc.calls("scan_folder")).toEqual([
      { path: "/photos/img1.jpg", sortOrder: "date" },
    ]);
    expect(ipc.calls("decode_image")).toEqual([
      { path: "/photos/img1.heic" },
      { path: "/photos/raw.dng", quality: "preview" },
    ]);
    expect(ipc.calls("generate_thumbnail")).toEqual([
      { path: "/photos/img1.jpg", size: 128 },
    ]);
    expect(ipc.calls("copy_image_to_clipboard")).toEqual([
      { path: "/photos/img1.jpg" },
    ]);
    expect(ipc.calls("reveal_in_file_manager")).toEqual([
      { path: "/photos/img1.jpg" },
    ]);
    expect(ipc.calls("print_current_view")).toEqual([{}]);
    expect(thumbnail).toEqual({ url: "asset:///tmp/imageareo-thumb.jpg" });
    expect(decoded).toEqual({
      path: "/tmp/imageareo-images/decoded.jpg",
      url: "asset:///tmp/imageareo-images/decoded.jpg",
      width: 1,
      height: 1,
      orientation: 1,
    });
  });

  it("reads image metadata through the seam and returns the default fixture", async () => {
    const metadata = await readImageMetadata({ path: "/photos/IMG_4032.JPG" });

    expect(ipc.calls("read_image_metadata")).toEqual([
      { path: "/photos/IMG_4032.JPG" },
    ]);
    expect(metadata).toEqual({
      fileName: "IMG_4032.JPG",
      filePath: "/photos/IMG_4032.JPG",
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
    });
  });

  it("honors a per-test override for read_image_metadata (no-camera PNG)", async () => {
    ipc.override("read_image_metadata", (args) => ({
      fileName: "Screenshot.png",
      filePath: String(args?.path ?? ""),
      format: "PNG",
      fileSizeBytes: 626_688,
      width: 2560,
      height: 1440,
      pixels: 3_686_400,
      colorType: "RGBA",
      bitDepth: 8,
      orientation: 1,
      camera: null,
    }));

    const metadata = await readImageMetadata({ path: "/Desktop/Screenshot.png" });

    expect(metadata.format).toBe("PNG");
    expect(metadata.camera).toBeNull();
    expect(metadata.filePath).toBe("/Desktop/Screenshot.png");
  });
});
