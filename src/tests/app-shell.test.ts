import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openDialog } = vi.hoisted(() => ({
  openDialog: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
}));

vi.mock("../lib/utils/open-entry", async () => {
  const actual = await vi.importActual<typeof import("../lib/utils/open-entry")>(
    "../lib/utils/open-entry",
  );

  return {
    ...actual,
    registerEntryPoints: vi.fn(async () => () => {}),
  };
});

import App from "../App.svelte";
import { ui } from "../lib/stores/ui.svelte";
import { viewer } from "../lib/stores/viewer.svelte";
import { supportedExtensions } from "../lib/utils/format";

describe("App", () => {
  beforeEach(() => {
    openDialog.mockReset();
    openDialog.mockResolvedValue(null);
    ui.closeSettings();
    viewer.reset();
  });

  it("uses the full supported extension set for File > Open", async () => {
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Open image" }));

    expect(openDialog).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: supportedExtensions() }],
    });
  });

  it("blocks viewer shortcuts behind the settings drawer but still allows Escape", async () => {
    viewer.status = "ready";
    viewer.rotation = 0;
    ui.openSettings();
    render(App);

    const sortSelect = screen.getByLabelText("Sort order");
    sortSelect.focus();

    await fireEvent.keyDown(sortSelect, { key: "]", ctrlKey: true });
    expect(viewer.rotation).toBe(0);
    expect(ui.settingsOpen).toBe(true);

    await fireEvent.keyDown(sortSelect, { key: "Escape" });
    expect(ui.settingsOpen).toBe(false);
  });
});
