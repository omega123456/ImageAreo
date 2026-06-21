import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

import { ipc } from "./ipc-mock";
import PrintDialog from "../lib/components/PrintDialog.svelte";
import { print } from "../lib/stores/print.svelte";
import { viewer } from "../lib/stores/viewer.svelte";

/** Load a native image so `viewer.source` is set (enables the Print button). */
function loadImage(): void {
  viewer.load("asset://a.jpg", "a.jpg");
  viewer.path = "/photos/a.jpg";
}

describe("PrintDialog", () => {
  beforeEach(() => {
    print.closeWindow();
    print.setTemplate("full");
    print.setPaperSize("letter");
    print.setOrientation("portrait");
    viewer.reset();
  });

  afterEach(() => {
    print.reset();
    viewer.reset();
  });

  it("renders nothing while closed and the dialog once opened", async () => {
    loadImage();
    const { rerender } = render(PrintDialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    print.openWindow();
    await rerender({});
    const dialog = screen.getByRole("dialog", { name: "Print" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("composes the preview, template picker, and controls", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    // Picker: the layout-template radiogroup.
    expect(screen.getByRole("radiogroup", { name: "Layout template" })).toBeInTheDocument();
    // Controls: the orientation group is the layout-only control surface.
    expect(screen.getByRole("group", { name: "Orientation" })).toBeInTheDocument();
  });

  it("places initial focus on the first template card", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    const radiogroup = screen.getByRole("radiogroup", { name: "Layout template" });
    const firstCard = radiogroup.querySelector("button");
    await waitFor(() => expect(document.activeElement).toBe(firstCard));
  });

  it("traps focus with Tab and Shift+Tab", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    const dialog = screen.getByRole("dialog");
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    await fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape and returns focus to the prior element", async () => {
    loadImage();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    print.openWindow();
    render(PrintDialog);

    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(print.open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it("closes on backdrop click", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    await fireEvent.click(screen.getByRole("button", { name: "Close print window" }));
    expect(print.open).toBe(false);
  });

  it("closes on the Cancel button", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(print.open).toBe(false);
  });

  it("closes on the header close button", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(print.open).toBe(false);
  });

  it("disables Print when no image is loaded", async () => {
    // viewer.reset() left source empty.
    print.openWindow();
    render(PrintDialog);

    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  });

  it("invokes print_current_view with the computed paper args, then closes", async () => {
    loadImage();
    print.setPaperSize("a4");
    print.setOrientation("landscape");
    print.openWindow();
    render(PrintDialog);

    await fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() =>
      expect(ipc.calls("print_current_view")).toHaveLength(1),
    );
    // A4 landscape swaps the portrait dims (210 x 297 -> 297 x 210).
    expect(ipc.calls("print_current_view")[0]).toEqual({
      paperWidthMm: 297,
      paperHeightMm: 210,
      orientation: "landscape",
    });
    expect(print.open).toBe(false);
  });

  it("keeps the print layer in flight after dismissing the modal", async () => {
    loadImage();
    print.openWindow();
    render(PrintDialog);

    await fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() =>
      expect(ipc.calls("print_current_view")).toHaveLength(1),
    );
    // The modal is dismissed, but the print-only layer must persist for the
    // async OS dialog (it is torn down lazily on the next open/reset).
    expect(print.open).toBe(false);
    expect(print.printing).toBe(true);
  });

  it("uses the asymmetric two-column layout (preview-dominant) that stacks below md", async () => {
    loadImage();
    print.openWindow();
    const { container } = render(PrintDialog);

    const body = container.querySelector(".md\\:grid");
    expect(body).not.toBeNull();
    // 5-col grid: preview spans 3 (~60%), controls span 2 (~40%).
    expect(body?.className).toContain("md:grid-cols-5");
    expect(container.querySelector(".md\\:col-span-3")).not.toBeNull();
    expect(container.querySelector(".md\\:col-span-2")).not.toBeNull();
    // Stacks (flex-col) at the base breakpoint.
    expect(body?.className).toContain("flex-col");
  });

  it("marks the modal print:hidden so it never prints", async () => {
    loadImage();
    print.openWindow();
    const { container } = render(PrintDialog);

    const overlay = container.querySelector(".print\\:hidden");
    expect(overlay).not.toBeNull();
  });
});
