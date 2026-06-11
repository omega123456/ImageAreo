import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";

import { ipc } from "./ipc-mock";
import FilmstripThumb from "../lib/components/FilmstripThumb.svelte";
import { galleryThumbnails } from "../lib/stores/gallery-thumbnails.svelte";
import type { ImageEntry } from "../lib/ipc/commands";

const entry: ImageEntry = { path: "/photos/a.jpg", name: "a.jpg", modified: 1 };

describe("FilmstripThumb", () => {
  beforeEach(() => {
    galleryThumbnails.clear();
  });

  it("requests its thumbnail at the density pixel size and labels itself", async () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    render(FilmstripThumb, {
      props: { entry, index: 0, size: 192, active: false, onSelect: vi.fn() },
    });

    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "asset:///tmp/a.jpg",
    );
    const option = screen.getByRole("option");
    expect(option).toHaveAttribute("aria-label", "a.jpg");
    expect(ipc.calls("generate_thumbnail")).toEqual([
      { path: "/photos/a.jpg", size: 192 },
    ]);
  });

  it("re-requests at a new size when density changes (size-keyed cache)", async () => {
    ipc.override("generate_thumbnail", (args) => ({
      path: `/tmp/${args?.size}.jpg`,
    }));

    const { rerender } = render(FilmstripThumb, {
      props: { entry, index: 0, size: 128, active: false, onSelect: vi.fn() },
    });
    await screen.findByRole("img");

    await rerender({ entry, index: 0, size: 192, active: false, onSelect: vi.fn() });

    await vi.waitFor(() => {
      expect(ipc.calls("generate_thumbnail")).toContainEqual({
        path: "/photos/a.jpg",
        size: 192,
      });
    });
  });

  it("shows a pulsing placeholder while pending", () => {
    let resolve: ((value: { path: string }) => void) | undefined;
    ipc.override(
      "generate_thumbnail",
      () => new Promise((r) => (resolve = r)),
    );

    const { container } = render(FilmstripThumb, {
      props: { entry, index: 0, size: 192, active: false, onSelect: vi.fn() },
    });

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    resolve?.({ path: "/tmp/x.jpg" });
  });

  it("applies the lift/scale treatment and aria-current when active", () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    render(FilmstripThumb, {
      props: { entry, index: 2, size: 192, active: true, onSelect: vi.fn() },
    });

    const option = screen.getByRole("option");
    expect(option).toHaveAttribute("aria-current", "true");
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(option).toHaveClass("relative");
    expect(option).toHaveClass("z-10");
    expect(option).toHaveClass("scale-110");
    expect(option).toHaveClass("-translate-y-2");
    expect(option).toHaveClass("ring-2");
    expect(option).toHaveClass("ring-primary-500");
    expect(option).toHaveClass("ring-offset-2");
    expect(option).toHaveClass("shadow-2xl");
  });

  it("exposes a keyboard focus ring distinct from the active lift", () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    render(FilmstripThumb, {
      props: { entry, index: 0, size: 192, active: false, onSelect: vi.fn() },
    });

    expect(screen.getByRole("option")).toHaveClass("focus-visible:ring-primary-500");
  });

  it("is tab-focusable only when marked tabbable (roving tabindex)", () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));

    render(FilmstripThumb, {
      props: {
        entry,
        index: 0,
        size: 192,
        active: false,
        tabbable: true,
        onSelect: vi.fn(),
      },
    });

    expect(screen.getByRole("option")).toHaveAttribute("tabindex", "0");
  });

  it("invokes onSelect with its index when clicked", () => {
    ipc.override("generate_thumbnail", () => ({ path: "/tmp/a.jpg" }));
    const onSelect = vi.fn();

    render(FilmstripThumb, {
      props: { entry, index: 3, size: 192, active: false, onSelect },
    });

    screen.getByRole("option").click();
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("renders the broken-image icon when generation fails", async () => {
    ipc.override("generate_thumbnail", () => {
      throw new Error("nope");
    });

    render(FilmstripThumb, {
      props: { entry, index: 0, size: 192, active: false, onSelect: vi.fn() },
    });

    await vi.waitFor(() => {
      expect(galleryThumbnails.get("/photos/a.jpg", 192)?.status).toBe("error");
    });
    expect(screen.queryByRole("img")).toBeNull();
  });
});
