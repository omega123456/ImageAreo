import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";

import { ipc } from "./ipc-mock";
import GalleryStrip from "../lib/components/GalleryStrip.svelte";
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

describe("GalleryStrip", () => {
  beforeEach(() => {
    folder.reset();
    settings.resetForTests();
    galleryThumbnails.clear();
    ipc.override("generate_thumbnail", (args) => ({
      dataUrl: `data:${args?.path}`,
    }));
  });

  it("renders nothing when the folder is empty", () => {
    const { container } = render(GalleryStrip);
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders a labelled strip with the folder images", async () => {
    seedFolder(5);
    render(GalleryStrip);

    expect(screen.getByRole("region", { name: "Gallery" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "img0.jpg" })).toBeInTheDocument();
  });

  it("requests thumbnails for the rendered items via the IPC seam", async () => {
    seedFolder(5);
    render(GalleryStrip);

    await screen.findByRole("button", { name: "img0.jpg" });
    const calls = ipc.calls("generate_thumbnail");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toContainEqual({ path: "/photos/img0.jpg", size: 120 });
  });

  it("does not re-request thumbnails already in the session cache", async () => {
    seedFolder(3);
    // Pre-warm the cache for img0 at the default size.
    await galleryThumbnails.request("/photos/img0.jpg", 120);
    ipc.reset();
    ipc.override("generate_thumbnail", (args) => ({
      dataUrl: `data:${args?.path}`,
    }));

    render(GalleryStrip);
    await screen.findByRole("button", { name: "img0.jpg" });

    expect(ipc.calls("generate_thumbnail")).not.toContainEqual({
      path: "/photos/img0.jpg",
      size: 120,
    });
  });

  it("marks the current image's thumbnail active", async () => {
    seedFolder(4);
    folder.currentIndex = 2;
    render(GalleryStrip);

    const active = await screen.findByRole("button", { name: "img2.jpg" });
    expect(active).toHaveAttribute("aria-current", "true");
    const inactive = screen.getByRole("button", { name: "img0.jpg" });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("clicking a thumbnail routes selection through the supplied handler", async () => {
    seedFolder(4);
    const onSelect = vi.fn((index: number) => {
      folder.selectIndex(index);
    });
    render(GalleryStrip, { props: { onSelect } });

    const thumb = await screen.findByRole("button", { name: "img1.jpg" });
    thumb.click();
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(folder.currentIndex).toBe(1);
  });

  it("follows the thumbnail size from settings", async () => {
    seedFolder(2);
    settings.thumbnailSize = 64;
    render(GalleryStrip);

    await screen.findByRole("button", { name: "img0.jpg" });
    expect(ipc.calls("generate_thumbnail")).toContainEqual({
      path: "/photos/img0.jpg",
      size: 64,
    });
  });

  it("shows a right scroll chevron on overflow and advances the visible window on click", async () => {
    seedFolder(40);
    settings.thumbnailCount = 3;
    render(GalleryStrip);
    await screen.findByRole("button", { name: "img0.jpg" });

    const right = screen.getByRole("button", { name: "Scroll gallery right" });
    right.click();
    expect(folder.currentIndex).toBe(3);
  });

  it("reveals the left chevron when the current window is no longer at the start", async () => {
    seedFolder(40);
    settings.thumbnailCount = 3;
    render(GalleryStrip);
    expect(
      screen.queryByRole("button", { name: "Scroll gallery left" }),
    ).toBeNull();

    folder.currentIndex = 4;
    await tick();

    expect(
      screen.getByRole("button", { name: "Scroll gallery left" }),
    ).toBeInTheDocument();
  });

  it("keeps the active thumbnail in the rendered window when the index changes", async () => {
    seedFolder(40);
    settings.thumbnailCount = 3;
    render(GalleryStrip);
    await screen.findByRole("button", { name: "img0.jpg" });

    folder.currentIndex = 30;
    await tick();

    expect(screen.getByRole("button", { name: "img30.jpg" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "img0.jpg" })).toBeNull();
  });

  it("uses thumbnailCount as the visible window size", async () => {
    seedFolder(20);
    settings.thumbnailSize = 64;
    settings.thumbnailCount = 3;
    render(GalleryStrip);

    await screen.findByRole("button", { name: "img0.jpg" });
    expect(screen.getAllByRole("button", { name: /img\d+\.jpg/ })).toHaveLength(3);

    settings.thumbnailCount = 5;
    await tick();

    expect(screen.getAllByRole("button", { name: /img\d+\.jpg/ })).toHaveLength(5);
  });
});
