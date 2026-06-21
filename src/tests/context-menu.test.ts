import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

import ImageViewer from "../lib/components/ImageViewer.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import { print } from "../lib/stores/print.svelte";
import { ipc } from "./ipc-mock";

/** Render the viewer with a loaded native image and return the canvas container. */
function renderWithImage(path = "/photos/a.jpg"): HTMLElement {
  viewer.load("asset://a.jpg", "a.jpg");
  viewer.path = path;
  const { container } = render(ImageViewer);
  return container.querySelector('[role="presentation"]') as HTMLElement;
}

/** Open the context menu via a right-click on the canvas. */
async function openMenu(canvas: HTMLElement): Promise<HTMLElement> {
  await fireEvent.contextMenu(canvas, { clientX: 120, clientY: 80 });
  return await screen.findByRole("menu", { name: "Image actions" });
}

describe("ContextMenu", () => {
  beforeEach(() => {
    viewer.reset();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it("does not render the menu before any right-click", () => {
    renderWithImage();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens at the cursor on right-click and lists all six items", async () => {
    const canvas = renderWithImage();
    const menu = await openMenu(canvas);

    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("80px");

    expect(screen.getByRole("menuitem", { name: /Rotate Left/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Rotate Right/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy Image/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy File Path/ })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Reveal in Finder\/Explorer/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Print/ })).toBeInTheDocument();

    // Two dividers: before the copy group and before Print.
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("does NOT open when no image is loaded", async () => {
    viewer.reset();
    const { container } = render(ImageViewer);
    // No image: container is idle, but the presentation role still exists.
    const canvas = container.querySelector('[role="presentation"]') as HTMLElement;
    await fireEvent.contextMenu(canvas, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const canvas = renderWithImage();
    const menu = await openMenu(canvas);
    await fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("closes on an outside pointerdown", async () => {
    const canvas = renderWithImage();
    await openMenu(canvas);
    await fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("stays open on a pointerdown inside the menu", async () => {
    const canvas = renderWithImage();
    const menu = await openMenu(canvas);
    await fireEvent.pointerDown(menu);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("stops menu pointerdowns from reaching the canvas container", async () => {
    // Regression: the canvas ZoomPanController calls setPointerCapture on
    // pointerdown, which would steal the click from a menu item. The menu must
    // stop pointerdown from bubbling out so item clicks still fire.
    const canvas = renderWithImage();
    const onCanvasPointerDown = vi.fn();
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    await openMenu(canvas);

    const item = screen.getByRole("menuitem", { name: /Rotate Left/ });
    await fireEvent.pointerDown(item);
    expect(onCanvasPointerDown).not.toHaveBeenCalled();
  });

  it("rotates left when the Rotate Left item is clicked", async () => {
    const canvas = renderWithImage();
    await openMenu(canvas);
    expect(viewer.rotation).toBe(0);
    await fireEvent.click(screen.getByRole("menuitem", { name: /Rotate Left/ }));
    expect(viewer.rotation).toBe(270);
    // Menu closes after a selection.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("rotates right when the Rotate Right item is clicked", async () => {
    const canvas = renderWithImage();
    await openMenu(canvas);
    await fireEvent.click(screen.getByRole("menuitem", { name: /Rotate Right/ }));
    expect(viewer.rotation).toBe(90);
  });

  it("calls copy_image_to_clipboard with the current path", async () => {
    const canvas = renderWithImage("/photos/cat.jpg");
    await openMenu(canvas);
    await fireEvent.click(screen.getByRole("menuitem", { name: /Copy Image/ }));
    await waitFor(() =>
      expect(ipc.calls("copy_image_to_clipboard")).toHaveLength(1),
    );
    expect(ipc.calls("copy_image_to_clipboard")[0]).toEqual({
      path: "/photos/cat.jpg",
    });
  });

  it("writes the file path to the clipboard as text", async () => {
    const canvas = renderWithImage("/photos/dog.png");
    await openMenu(canvas);
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /Copy File Path/ }),
    );
    await waitFor(() =>
      expect(ipc.calls("plugin:clipboard-manager|write_text")).toHaveLength(1),
    );
    expect(ipc.calls("plugin:clipboard-manager|write_text")[0]).toMatchObject({
      text: "/photos/dog.png",
    });
    // The copy-image backend command must NOT be used for copy-path.
    expect(ipc.calls("copy_image_to_clipboard")).toHaveLength(0);
  });

  it("calls reveal_in_file_manager with the current path", async () => {
    const canvas = renderWithImage("/photos/bird.jpg");
    await openMenu(canvas);
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /Reveal in Finder\/Explorer/ }),
    );
    await waitFor(() =>
      expect(ipc.calls("reveal_in_file_manager")).toHaveLength(1),
    );
    expect(ipc.calls("reveal_in_file_manager")[0]).toEqual({
      path: "/photos/bird.jpg",
    });
  });

  it("opens the in-app print window when the Print item is clicked", async () => {
    print.closeWindow();
    const canvas = renderWithImage("/photos/poster.jpg");
    await openMenu(canvas);
    await fireEvent.click(screen.getByRole("menuitem", { name: /Print/ }));
    // Phase 7: the menu trigger opens the in-app dialog rather than invoking the
    // native print directly. No IPC fires from the menu itself.
    await waitFor(() => expect(print.open).toBe(true));
    expect(ipc.calls("print_current_view")).toHaveLength(0);
    // Menu closes after a selection.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("navigates items with ArrowDown/ArrowUp and selects with Enter", async () => {
    const canvas = renderWithImage();
    const menu = await openMenu(canvas);

    const first = screen.getByRole("menuitem", { name: /Rotate Left/ });
    expect(document.activeElement).toBe(first);

    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /Rotate Right/ }),
    );

    await fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);

    // ArrowUp from the first item wraps to the last.
    await fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /Print/ }),
    );

    // Enter selects the focused (Print) item, opening the in-app dialog.
    print.closeWindow();
    await fireEvent.keyDown(menu, { key: "Enter" });
    await waitFor(() => expect(print.open).toBe(true));
  });

  it("supports Home/End jumps and Space selection", async () => {
    const canvas = renderWithImage();
    const menu = await openMenu(canvas);

    await fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: /Print/ }),
    );

    await fireEvent.keyDown(menu, { key: "Home" });
    const first = screen.getByRole("menuitem", { name: /Rotate Left/ });
    expect(document.activeElement).toBe(first);

    await fireEvent.keyDown(menu, { key: " " });
    expect(viewer.rotation).toBe(270);
  });

  it("does not surface an unhandled rejection when an action's IPC call rejects", async () => {
    ipc.override("reveal_in_file_manager", () => {
      throw new Error("reveal failed");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const canvas = renderWithImage("/photos/gone.jpg");
    await openMenu(canvas);

    // The click handler discards the select() promise; a rejection here would
    // otherwise become an unhandled rejection. Assert it is caught/logged and
    // the menu still closes.
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /Reveal in Finder\/Explorer/ }),
    );

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("hover over an item updates the active index", async () => {
    const canvas = renderWithImage();
    await openMenu(canvas);
    const reveal = screen.getByRole("menuitem", {
      name: /Reveal in Finder\/Explorer/,
    });
    await fireEvent.pointerEnter(reveal);
    expect(reveal).toHaveAttribute("tabindex", "0");
  });
});
