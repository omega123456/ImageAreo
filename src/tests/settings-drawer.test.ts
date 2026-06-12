import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

import { ipc } from "./ipc-mock";
import SettingsDrawer from "../lib/components/SettingsDrawer.svelte";
import { folder } from "../lib/stores/folder.svelte";
import { settings } from "../lib/stores/settings.svelte";
import { ui } from "../lib/stores/ui.svelte";

async function initSettings() {
  ipc.override("plugin:store|get", () => [undefined, false]);
  await settings.initialize();
}

describe("SettingsDrawer", () => {
  beforeEach(async () => {
    ui.closeSettings();
    folder.reset();
    settings.resetForTests();
    await initSettings();
  });

  afterEach(() => {
    ui.closeSettings();
    folder.reset();
    settings.resetForTests();
  });

  it("renders nothing while closed and the dialog once opened", async () => {
    const { rerender } = render(SettingsDrawer, { props: { version: "1.0.0" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    ui.openSettings();
    await rerender({ version: "1.0.0" });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("resolves the version from Tauri when no prop is given", async () => {
    ipc.override("plugin:app|version", () => "9.9.9");
    ui.openSettings();
    render(SettingsDrawer);
    expect(await screen.findByText(/v9\.9\.9/)).toBeInTheDocument();
  });

  it("leaves the version blank when Tauri lookup fails", async () => {
    ipc.override("plugin:app|version", () => {
      throw new Error("no tauri");
    });
    ui.openSettings();
    render(SettingsDrawer);
    // Renders the product name without a version suffix.
    expect(screen.getByText("ImageAreo")).toBeInTheDocument();
  });

  it("shows the app version in the About section", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "2.3.4" } });
    expect(screen.getByText(/v2\.3\.4/)).toBeInTheDocument();
  });

  it("renders the update-available slot only when flagged", async () => {
    ui.openSettings();
    const { rerender } = render(SettingsDrawer, {
      props: { version: "1.0.0", updateAvailable: false },
    });
    expect(screen.queryByText(/Update available/)).not.toBeInTheDocument();

    await rerender({ version: "1.0.0", updateAvailable: true, updateVersion: "1.2.0" });
    expect(screen.getByText(/Update available/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.2\.0/)).toBeInTheDocument();
  });

  it("closes on the X button", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });
    await fireEvent.click(screen.getByRole("button", { name: "Close settings panel" }));
    expect(ui.settingsOpen).toBe(false);
  });

  it("closes on backdrop click", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });
    await fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(ui.settingsOpen).toBe(false);
  });

  it("closes on Escape", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });
    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(ui.settingsOpen).toBe(false);
  });

  it("traps focus with Tab and Shift+Tab inside the drawer", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    // Wait for the async association load to render its checkboxes so the
    // focusable set is stable before we capture first/last.
    await screen.findByRole("checkbox", {
      name: "Associate .jpg with ImageAreo",
    });

    const dialog = screen.getByRole("dialog");
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    const first = items[0];
    const last = items[items.length - 1];

    // Wrap forward from last -> first focusable.
    last.focus();
    await fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first wraps to the last.
    first.focus();
    await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("changes theme and persists it live", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    await fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(settings.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(ipc.calls("plugin:store|set")).toContainEqual(
      expect.objectContaining({ key: "theme", value: "dark" }),
    );
  });

  it("does not render the removed count/size controls", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    expect(screen.queryByLabelText("Thumbnail count")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Thumbnail size")).not.toBeInTheDocument();
  });

  it("changes density via the dropdown and persists it", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    const density = screen.getByLabelText("Density");
    await fireEvent.change(density, { target: { value: "small" } });
    expect(settings.galleryDensity).toBe("small");

    expect(ipc.calls("plugin:store|set")).toContainEqual(
      expect.objectContaining({ key: "galleryDensity", value: "small" }),
    );
  });

  it("renders the file type checklist from the live association query", async () => {
    ipc.override("query_file_associations", () => [
      { ext: "jpg", isDefault: true },
      { ext: "png", isDefault: false },
      { ext: "webp", isDefault: false },
    ]);
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    expect(
      await screen.findByRole("checkbox", {
        name: "Associate .jpg with ImageAreo",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Associate .png with ImageAreo",
      }),
    ).not.toBeChecked();
  });

  it("applies the selected file types through IPC", async () => {
    let queryCount = 0;
    ipc.override("query_file_associations", () => {
      queryCount += 1;

      if (queryCount === 1) {
        return [
          { ext: "jpg", isDefault: true },
          { ext: "png", isDefault: false },
        ];
      }

      return [
        { ext: "jpg", isDefault: true },
        { ext: "png", isDefault: true },
      ];
    });

    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    const png = await screen.findByRole("checkbox", {
      name: "Associate .png with ImageAreo",
    });
    await fireEvent.click(png);
    await fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(ipc.calls("set_default_associations")).toEqual([
        { exts: ["jpg", "png"] },
      ]);
    });
  });

  it("changes sort and persists it", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    const sort = screen.getByLabelText("Sort order");
    await fireEvent.change(sort, { target: { value: "date" } });
    expect(settings.sortOrder).toBe("date");

    expect(ipc.calls("plugin:store|set")).toContainEqual(
      expect.objectContaining({ key: "sortOrder", value: "date" }),
    );
  });

  it("reapplies the current folder listing when sort changes", async () => {
    ipc.override("scan_folder", (args) =>
      args?.sortOrder === "date"
        ? [{ path: "/photos/b.jpg", name: "b.jpg", modified: 2 }]
        : [{ path: "/photos/a.jpg", name: "a.jpg", modified: 1 }],
    );
    await folder.open("/photos/a.jpg");

    ui.openSettings();
    render(SettingsDrawer, { props: { version: "1.0.0" } });

    const sort = screen.getByLabelText("Sort order");
    await fireEvent.change(sort, { target: { value: "date" } });

    await waitFor(() => {
      expect(ipc.calls("scan_folder")).toContainEqual({
        path: "/photos/a.jpg",
        sortOrder: "date",
      });
    });
  });
});
