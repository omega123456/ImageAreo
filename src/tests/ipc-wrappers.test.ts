import { describe, expect, it } from "vitest";

import { ipc } from "./ipc-mock";
import {
  copyImageToClipboard,
  decodeImage,
  generateThumbnail,
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
    expect(thumbnail).toEqual({ url: "asset:///tmp/imageareo-thumb.jpg" });
    expect(decoded).toEqual({
      path: "/tmp/imageareo-images/decoded.jpg",
      url: "asset:///tmp/imageareo-images/decoded.jpg",
      width: 1,
      height: 1,
      orientation: 1,
    });
  });
});
