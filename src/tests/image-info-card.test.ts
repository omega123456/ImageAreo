import { render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ImageInfoCard from "../lib/components/ImageInfoCard.svelte";
import { chromeTone } from "../lib/stores/chrome-tone.svelte";
import { imageInfo } from "../lib/stores/image-info.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import { ipc } from "./ipc-mock";
import type { ImageMetadata } from "../lib/ipc/commands";

const JPEG_META: ImageMetadata = {
  fileName: "IMG_4032.JPG",
  filePath: "/photos/2026/June/IMG_4032.JPG",
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
    model: "EOS R6",
    lens: "RF24-105mm F4",
    iso: 400,
    aperture: 4.0,
    shutterSpeed: "1/250",
    focalLength: 50,
    dateTaken: "2026:06:10 14:32:00",
  },
};

const PNG_META: ImageMetadata = {
  fileName: "Screenshot.png",
  filePath: "/Desktop/Screenshot.png",
  format: "PNG",
  fileSizeBytes: 626_688,
  width: 2560,
  height: 1440,
  pixels: 3_686_400,
  colorType: "RGBA",
  bitDepth: 8,
  orientation: 1,
  camera: null,
};

async function setMeta(path: string): Promise<void> {
  viewer.path = path;
  viewer.name = path.split("/").pop() ?? path;
  await imageInfo.ensureLoaded(null);
  await imageInfo.ensureLoaded(path);
}

describe("ImageInfoCard", () => {
  beforeEach(() => {
    chromeTone.infoDark = true;
    viewer.reset();
    void imageInfo.ensureLoaded(null);
  });

  afterEach(() => {
    viewer.reset();
    void imageInfo.ensureLoaded(null);
    vi.restoreAllMocks();
  });

  it("renders the complementary role and aria-labelledby header", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/2026/June/IMG_4032.JPG");

    render(ImageInfoCard);

    const card = screen.getByTestId("image-info-card");
    expect(card).toHaveAttribute("role", "complementary");
    const headingId = card.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId as string)).toHaveTextContent(
      "Image info",
    );
  });

  it("renders File, Image and Camera groups for a JPEG with EXIF", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/2026/June/IMG_4032.JPG");

    render(ImageInfoCard);

    expect(screen.getByTestId("image-info-file")).toBeInTheDocument();
    expect(screen.getByTestId("image-info-image")).toBeInTheDocument();
    expect(screen.getByTestId("image-info-camera")).toBeInTheDocument();

    const card = screen.getByTestId("image-info-card");
    expect(card).toHaveTextContent("IMG_4032.JPG");
    expect(card).toHaveTextContent("4032 × 3024");
    expect(card).toHaveTextContent("12.2 MP");
    expect(card).toHaveTextContent("RGB");
    expect(card).toHaveTextContent("8-bit");
    expect(card).toHaveTextContent("1 (Normal)");
    expect(card).toHaveTextContent("Canon EOS R6");
    expect(card).toHaveTextContent("ISO 400");
    expect(card).toHaveTextContent("f/4");
    expect(card).toHaveTextContent("1/250 s");
    expect(card).toHaveTextContent("50 mm");
  });

  it("hides the Camera group for an image without camera EXIF", async () => {
    ipc.override("read_image_metadata", () => PNG_META);
    await setMeta("/Desktop/Screenshot.png");

    render(ImageInfoCard);

    expect(screen.getByTestId("image-info-file")).toBeInTheDocument();
    expect(screen.getByTestId("image-info-image")).toBeInTheDocument();
    expect(screen.queryByTestId("image-info-camera")).toBeNull();
    expect(screen.getByTestId("image-info-card")).not.toHaveTextContent("Camera");
  });

  it("omits empty rows whose formatter signals OMIT", async () => {
    ipc.override("read_image_metadata", () => ({
      ...PNG_META,
      colorType: null,
      bitDepth: null,
    }));
    await setMeta("/Desktop/nodepth.png");

    render(ImageInfoCard);

    // Color and Bit depth rows omitted independently; Dimensions still present.
    expect(screen.getByTestId("image-info-image")).not.toHaveTextContent("Color");
    expect(screen.getByTestId("image-info-image")).not.toHaveTextContent(
      "Bit depth",
    );
    expect(screen.getByTestId("image-info-image")).toHaveTextContent("Dimensions");
  });

  it("renders Color without Bit depth when only the color type is known", async () => {
    ipc.override("read_image_metadata", () => ({
      ...PNG_META,
      colorType: "RGB",
      bitDepth: null,
    }));
    await setMeta("/Desktop/coloronly.png");

    render(ImageInfoCard);

    const image = screen.getByTestId("image-info-image");
    expect(image).toHaveTextContent("Color");
    expect(image).not.toHaveTextContent("Bit depth");
  });

  it("shows placeholder bars with group headers while loading", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    ipc.override("read_image_metadata", async () => {
      await gate;
      return JPEG_META;
    });

    viewer.path = "/photos/slow.jpg";
    viewer.name = "slow.jpg";
    void imageInfo.ensureLoaded("/photos/slow.jpg");

    render(ImageInfoCard);

    expect(imageInfo.status).toBe("loading");
    expect(screen.getAllByTestId("image-info-placeholder").length).toBeGreaterThan(
      0,
    );
    const card = screen.getByTestId("image-info-card");
    expect(card).toHaveTextContent("File");
    expect(card).toHaveTextContent("Image");

    release();
    await imageInfo.ensureLoaded("/photos/slow.jpg");
  });

  it("shows an inline error row and keeps the card rendered on failure", async () => {
    ipc.override("read_image_metadata", () => {
      throw new Error("nope");
    });
    viewer.path = "/photos/bad.jpg";
    viewer.name = "bad.jpg";
    await imageInfo.ensureLoaded("/photos/bad.jpg");

    render(ImageInfoCard);
    // The mount effect re-issues the (uncached) fetch; let it reject and settle.
    await imageInfo.ensureLoaded("/photos/bad.jpg");
    await Promise.resolve();

    expect(screen.getByTestId("image-info-card")).toBeInTheDocument();
    const error = await screen.findByTestId("image-info-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Could not read metadata");
  });

  it("uses on-dark glyph classes when chromeTone.infoDark is true", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/x.jpg");
    chromeTone.infoDark = true;

    render(ImageInfoCard);

    const card = screen.getByTestId("image-info-card");
    expect(card).toHaveClass("text-chrome-glyph-on-dark", "drop-shadow-glyph");
  });

  it("switches to on-light glyph classes when chromeTone.infoDark is false", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/y.jpg");
    chromeTone.infoDark = false;

    render(ImageInfoCard);

    const card = screen.getByTestId("image-info-card");
    expect(card).toHaveClass("text-chrome-glyph-on-light");
    expect(card).not.toHaveClass("drop-shadow-glyph");
  });

  it("reports its bounding rect via onBoundsChange", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/z.jpg");
    const onBoundsChange = vi.fn();

    render(ImageInfoCard, { props: { onBoundsChange } });

    expect(onBoundsChange).toHaveBeenCalled();
    expect(onBoundsChange.mock.calls[0][0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it("renders the Path value with rtl direction and a full-path tooltip", async () => {
    ipc.override("read_image_metadata", () => JPEG_META);
    await setMeta("/photos/2026/June/IMG_4032.JPG");

    render(ImageInfoCard);

    const pathValue = screen
      .getByTestId("image-info-file")
      .querySelector('[dir="rtl"]');
    expect(pathValue).not.toBeNull();
    expect(pathValue).toHaveAttribute(
      "title",
      "/photos/2026/June/IMG_4032.JPG",
    );
  });

  it("announces the current filename through a debounced aria-live region", async () => {
    vi.useFakeTimers();
    try {
      ipc.override("read_image_metadata", () => JPEG_META);
      viewer.path = "/photos/2026/June/IMG_4032.JPG";
      viewer.name = "IMG_4032.JPG";

      render(ImageInfoCard);
      await vi.advanceTimersByTimeAsync(300);

      const live = document.querySelector(".sr-only");
      expect(live).toHaveTextContent("Info updated: IMG_4032.JPG");
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("does not fetch metadata when no image path is set", async () => {
    viewer.reset();
    await imageInfo.ensureLoaded(null);

    render(ImageInfoCard);

    expect(ipc.calls("read_image_metadata")).toHaveLength(0);
  });
});
