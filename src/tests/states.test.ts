import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

import { ipc } from "./ipc-mock";
import EmptyState from "../lib/components/states/EmptyState.svelte";
import LoadingState from "../lib/components/states/LoadingState.svelte";
import ErrorState from "../lib/components/states/ErrorState.svelte";
import ImageViewer from "../lib/components/ImageViewer.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import { folder } from "../lib/stores/folder.svelte";

beforeEach(() => {
  vi.restoreAllMocks();
  viewer.reset();
  folder.reset();
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
});

describe("ImageViewer state routing", () => {
  it("renders EmptyState when idle", () => {
    render(ImageViewer, { props: { onOpen: vi.fn() } });
    expect(screen.getByText("Open an image to get started")).toBeInTheDocument();
  });

  it("renders LoadingState while loading", () => {
    viewer.load("asset://photo.jpg", "photo.jpg");
    render(ImageViewer);
    expect(screen.getByRole("status", { name: "Loading image" })).toBeInTheDocument();
  });

  it("renders ErrorState on error", () => {
    viewer.load("", "broken.heic");
    viewer.setError();
    render(ImageViewer);
    expect(screen.getByText("Could not open this image")).toBeInTheDocument();
  });

  it("Try Again re-opens the failed path", async () => {
    ipc.override("scan_folder", () => [
      { path: "/photos/broken.heic", name: "broken.heic", modified: 1 },
    ]);
    viewer.load("", "broken.heic");
    viewer.path = "/photos/broken.heic";
    viewer.setError();
    render(ImageViewer);

    await fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await waitFor(() => {
      expect(ipc.calls("scan_folder").length).toBeGreaterThan(0);
    });
  });

  it("Open Another forwards to the onOpen handler", async () => {
    const onOpen = vi.fn();
    viewer.load("", "broken.heic");
    viewer.setError();
    render(ImageViewer, { props: { onOpen } });

    await fireEvent.click(screen.getByRole("button", { name: "Open Another" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps the previous image visible after a ready image then a reload", async () => {
    viewer.load("asset://first.jpg", "first.jpg");
    render(ImageViewer);
    const img = screen.getByRole("img", { name: "first.jpg" }) as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 100, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 100, configurable: true });
    await fireEvent.load(img);

    viewer.name = "next.heic";
    viewer.status = "loading";

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Loading image" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "first.jpg" })).toHaveAttribute(
        "src",
        "asset://first.jpg",
      );
    });
  });
});

describe("LoadingState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows 'Decoding…' only after 1.5s", async () => {
    render(LoadingState, { props: { previousSource: "" } });
    expect(screen.queryByText("Decoding…")).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1499);
    expect(screen.queryByText("Decoding…")).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByText("Decoding…")).toBeInTheDocument();
  });

  it("renders the ghosted previous image when provided", () => {
    render(LoadingState, {
      props: { previousSource: "asset://prev.jpg", previousName: "prev.jpg" },
    });
    const img = screen.getByRole("img", { name: "prev.jpg" }) as HTMLImageElement;
    expect(img).toHaveAttribute("src", "asset://prev.jpg");
    expect(img).toHaveClass("opacity-50");
  });
});

describe("ErrorState", () => {
  it("invokes the supplied callbacks", async () => {
    const onRetry = vi.fn();
    const onOpenAnother = vi.fn();
    render(ErrorState, { props: { onRetry, onOpenAnother } });

    await fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onRetry).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "Open Another" }));
    expect(onOpenAnother).toHaveBeenCalledOnce();
  });

  it("does not throw when callbacks are omitted", async () => {
    render(ErrorState);
    await fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    await fireEvent.click(screen.getByRole("button", { name: "Open Another" }));
    expect(screen.getByText("Could not open this image")).toBeInTheDocument();
  });
});

describe("EmptyState drag affordance", () => {
  it("shows the hint text and Open CTA", async () => {
    const onOpen = vi.fn();
    render(EmptyState, { props: { onOpen } });
    expect(screen.getByText("or drop an image here")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Open File" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("toggles the dropzone border on Tauri drag-enter / drag-leave", async () => {
    render(EmptyState);
    expect(screen.getByText("or drop an image here")).toBeInTheDocument();

    await ipc.emit("tauri://drag-enter");
    await waitFor(() => {
      expect(screen.getByText("Drop an image here")).toBeInTheDocument();
    });
    expect(screen.queryByText("or drop an image here")).not.toBeInTheDocument();

    await ipc.emit("tauri://drag-leave");
    await waitFor(() => {
      expect(screen.getByText("or drop an image here")).toBeInTheDocument();
    });
  });
});
