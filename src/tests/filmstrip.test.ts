import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

import { ipc } from "./ipc-mock";
import Filmstrip from "../lib/components/Filmstrip.svelte";
import { folder } from "../lib/stores/folder.svelte";
import { settings } from "../lib/stores/settings.svelte";
import { galleryThumbnails } from "../lib/stores/gallery-thumbnails.svelte";

function seedFolder(count: number): void {
  folder.images = Array.from({ length: count }, (_, i) => ({
    path: `/photos/img${i}.jpg`,
    name: `img${i}.jpg`,
    modified: i,
  }));
  folder.currentIndex = 0;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

// jsdom reports clientWidth/scrollWidth as 0; stub a viewport width so the
// windowing math has a real measurement to work with, and capture scroll calls.
let scrollToSpy: ReturnType<typeof vi.fn>;
let scrollBySpy: ReturnType<typeof vi.fn>;
let widthSpy: ReturnType<typeof vi.spyOn>;

function stubLayout(viewportWidth: number): void {
  widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(viewportWidth);
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return 100000;
    },
  });
  scrollToSpy = vi.fn();
  scrollBySpy = vi.fn();
  HTMLElement.prototype.scrollTo =
    scrollToSpy as unknown as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollBy =
    scrollBySpy as unknown as typeof HTMLElement.prototype.scrollBy;
}

describe("Filmstrip", () => {
  beforeEach(() => {
    folder.reset();
    settings.resetForTests();
    galleryThumbnails.clear();
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${String(args?.path).split("/").pop()}.jpg`,
    }));
    stubLayout(320);
  });

  afterEach(() => {
    widthSpy?.mockRestore();
  });

  it("renders nothing when the folder is empty", () => {
    const { container } = render(Filmstrip);
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders a full-width listbox scroll container on strip-surface", async () => {
    seedFolder(5);
    render(Filmstrip);

    const listbox = screen.getByRole("listbox", { name: "Folder images" });
    expect(listbox).toHaveClass("overflow-x-auto");
    const section = screen.getByRole("region", { name: "Filmstrip" });
    expect(section).toHaveClass("bg-strip-surface");
    expect(await screen.findByRole("option", { name: "img0.jpg" })).toBeInTheDocument();
  });

  it("renders only a windowed slice of a large folder, not every item", async () => {
    seedFolder(500);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });

    const rendered = screen.getAllByRole("option");
    // 320px viewport / ~102px stride + buffer => far fewer than 500.
    expect(rendered.length).toBeLessThan(20);
    expect(screen.queryByRole("option", { name: "img499.jpg" })).toBeNull();
  });

  it("derives item size from the density setting (Large default = 192px)", async () => {
    seedFolder(3);
    render(Filmstrip);

    await screen.findByRole("option", { name: "img0.jpg" });
    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/img0.jpg",
      size: 192,
    });
  });

  it("re-requests thumbnails at the new pixel size when density changes", async () => {
    seedFolder(3);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });

    await settings.setGalleryDensity("small");
    await tick();
    await flushAsyncWork();

    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/img0.jpg",
      size: 80,
    });
  });

  it("prefetches every folder thumbnail at the density pixel size", async () => {
    seedFolder(40);
    render(Filmstrip);

    await screen.findByRole("option", { name: "img0.jpg" });
    await flushAsyncWork();

    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/img39.jpg",
      size: 192,
    });
  });

  it("bounds prefetch to the visible window ±50 on a large folder", async () => {
    seedFolder(500);
    folder.currentIndex = 250;
    render(Filmstrip);
    // The rendered DOM window tracks the scroll position (stubbed at 0), but the
    // prefetch band tracks folder.currentIndex; assert on the prefetch calls.
    await flushAsyncWork();
    await flushAsyncWork();

    const calls = ipc.calls("generate_thumbnail");
    const requested = new Set(
      calls.map((c) => String((c as { path?: unknown })?.path)),
    );

    // The band (±50 around index 250) is prefetched.
    expect(requested.has("/photos/img250.jpg")).toBe(true);
    expect(requested.has("/photos/img200.jpg")).toBe(true);
    expect(requested.has("/photos/img300.jpg")).toBe(true);
    // Items neither in the band nor in the rendered DOM window are never
    // requested — far from both the prefetch center and the (scroll=0) viewport.
    expect(requested.has("/photos/img150.jpg")).toBe(false);
    expect(requested.has("/photos/img350.jpg")).toBe(false);
    expect(requested.has("/photos/img499.jpg")).toBe(false);
    // Total bounded well under the folder size: the ±50 band (101) plus the
    // small rendered DOM window, never the whole 500-image folder.
    expect(requested.size).toBeLessThan(150);
  });

  it("auto-centers the active thumb on selection change via JS scroll", async () => {
    seedFolder(80);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });
    scrollToSpy.mockClear();

    folder.currentIndex = 40;
    await tick();
    await flushAsyncWork();

    expect(scrollToSpy).toHaveBeenCalled();
    const arg = scrollToSpy.mock.calls.at(-1)?.[0] as ScrollToOptions;
    expect(arg.left).toBeGreaterThan(0);
  });

  it("marks the current image's thumbnail active", async () => {
    seedFolder(4);
    folder.currentIndex = 2;
    render(Filmstrip);

    const active = await screen.findByRole("option", { name: "img2.jpg" });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("option", { name: "img0.jpg" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("clicking a thumbnail routes selection through the handler", async () => {
    seedFolder(4);
    const onSelect = vi.fn((index: number) => {
      folder.selectIndex(index);
    });
    render(Filmstrip, { props: { onSelect } });

    const thumb = await screen.findByRole("option", { name: "img1.jpg" });
    thumb.click();
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(folder.currentIndex).toBe(1);
  });

  it("supports roving keyboard navigation across the listbox", async () => {
    seedFolder(10);
    const onSelect = vi.fn((index: number) => {
      folder.selectIndex(index);
    });
    render(Filmstrip, { props: { onSelect } });
    const listbox = await screen.findByRole("listbox", { name: "Folder images" });

    await fireEvent.keyDown(listbox, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith(1);

    await fireEvent.keyDown(listbox, { key: "End" });
    expect(onSelect).toHaveBeenCalledWith(9);

    await fireEvent.keyDown(listbox, { key: "Home" });
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("translates vertical wheel input into horizontal scrolling", async () => {
    seedFolder(200);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });

    const listbox = screen.getByRole("listbox", { name: "Folder images" });
    let scrollLeft = 0;
    Object.defineProperty(listbox, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });

    await fireEvent.wheel(listbox, { deltaY: 120, deltaX: 0 });
    expect(scrollLeft).toBe(120);
  });

  it("normalizes line-mode wheel deltas to a thumbnail stride", async () => {
    seedFolder(200);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });

    const listbox = screen.getByRole("listbox", { name: "Folder images" });
    let scrollLeft = 0;
    Object.defineProperty(listbox, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });

    // deltaMode 1 (lines): one notch advances stride (192px thumb + 6px gap).
    await fireEvent.wheel(listbox, { deltaY: 1, deltaX: 0, deltaMode: 1 });
    expect(scrollLeft).toBe(198);
  });

  it("leaves horizontal-dominant wheel gestures to native scrolling", async () => {
    seedFolder(200);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });

    const listbox = screen.getByRole("listbox", { name: "Folder images" });
    let scrollLeft = 0;
    Object.defineProperty(listbox, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });

    await fireEvent.wheel(listbox, { deltaY: 5, deltaX: 80 });
    expect(scrollLeft).toBe(0);
  });

  it("reveals hover chevrons that nudge the scroll position", async () => {
    seedFolder(200);
    render(Filmstrip);
    await screen.findByRole("option", { name: "img0.jpg" });
    await flushAsyncWork();

    const filmstrip = screen.getByRole("region", { name: "Filmstrip" });
    await fireEvent.mouseEnter(filmstrip);

    const right = await screen.findByRole("button", { name: "Scroll filmstrip right" });
    await fireEvent.click(right);
    expect(scrollBySpy).toHaveBeenCalled();
    const arg = scrollBySpy.mock.calls.at(-1)?.[0] as ScrollToOptions;
    expect(arg.left).toBeGreaterThan(0);
  });
});
