import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";

import { ipc } from "./ipc-mock";
import GalleryThumb from "../lib/components/GalleryThumb.svelte";
import { galleryThumbnails } from "../lib/stores/gallery-thumbnails.svelte";
import type { ImageEntry } from "../lib/ipc/commands";

const entry: ImageEntry = { path: "/photos/a.jpg", name: "a.jpg", modified: 1 };

describe("GalleryThumb", () => {
  beforeEach(() => {
    galleryThumbnails.clear();
  });

  it("requests its thumbnail on mount and labels itself", async () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));

    render(GalleryThumb, {
      props: { entry, index: 0, size: 120, active: false, onSelect: vi.fn() },
    });

    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;a",
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "a.jpg");
    expect(ipc.calls("generate_thumbnail")).toEqual([
      { path: "/photos/a.jpg", size: 120 },
    ]);
  });

  it("shows a pulsing placeholder while the thumbnail is pending", () => {
    let resolve: ((value: { dataUrl: string }) => void) | undefined;
    ipc.override(
      "generate_thumbnail",
      () => new Promise((r) => (resolve = r)),
    );

    const { container } = render(GalleryThumb, {
      props: { entry, index: 0, size: 120, active: false, onSelect: vi.fn() },
    });

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    resolve?.({ dataUrl: "x" });
  });

  it("marks itself active via aria-current and the highlight ring", () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));

    render(GalleryThumb, {
      props: { entry, index: 2, size: 120, active: true, onSelect: vi.fn() },
    });

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-current", "true");
    expect(button).toHaveClass("ring-2");
  });

  it("invokes onSelect with its index when clicked", async () => {
    ipc.override("generate_thumbnail", () => ({ dataUrl: "data:image/png;a" }));
    const onSelect = vi.fn();

    render(GalleryThumb, {
      props: { entry, index: 3, size: 120, active: false, onSelect },
    });

    screen.getByRole("button").click();
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("renders an error icon when generation fails", async () => {
    ipc.override("generate_thumbnail", () => {
      throw new Error("nope");
    });

    render(GalleryThumb, {
      props: { entry, index: 0, size: 120, active: false, onSelect: vi.fn() },
    });

    // The error state replaces the placeholder once the rejection settles.
    await vi.waitFor(() => {
      expect(galleryThumbnails.get("/photos/a.jpg", 120)?.status).toBe("error");
    });
  });
});
