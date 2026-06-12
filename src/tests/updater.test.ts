import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(async () => {}),
}));

import {
  updater,
  UPDATE_CHECK_DELAY_MS,
  type PendingUpdate,
} from "../lib/stores/updater.svelte";
import UpdateToast from "../lib/components/UpdateToast.svelte";
import Toolbar from "../lib/components/Toolbar.svelte";
import SettingsDrawer from "../lib/components/SettingsDrawer.svelte";
import { ui } from "../lib/stores/ui.svelte";
import { settings } from "../lib/stores/settings.svelte";
import { ipc } from "./ipc-mock";

function fakeUpdate(version: string): {
  update: PendingUpdate;
  install: ReturnType<typeof vi.fn>;
} {
  const install = vi.fn(async () => {});
  return { update: { version, downloadAndInstall: install }, install };
}

describe("updater store", () => {
  beforeEach(() => {
    updater.resetForTests();
  });

  afterEach(() => {
    updater.resetForTests();
    ui.closeSettings();
  });

  it("flips to available when the checker resolves an update", async () => {
    const { update } = fakeUpdate("1.2.0");
    updater.configure({ checker: async () => update });

    await updater.checkForUpdate();

    expect(updater.updateAvailable).toBe(true);
    expect(updater.updateVersion).toBe("1.2.0");
    expect(updater.showToast).toBe(true);
    expect(updater.showBadge).toBe(false);
  });

  it("stays clear when no update is available", async () => {
    updater.configure({ checker: async () => null });

    await updater.checkForUpdate();

    expect(updater.updateAvailable).toBe(false);
    expect(updater.updateVersion).toBeNull();
    expect(updater.showToast).toBe(false);
  });

  it("swallows checker failures without surfacing an update", async () => {
    updater.configure({
      checker: async () => {
        throw new Error("offline");
      },
    });

    await updater.checkForUpdate();

    expect(updater.updateAvailable).toBe(false);
    expect(updater.updateVersion).toBeNull();
  });

  it("dismiss hides the toast but keeps the badge", async () => {
    const { update } = fakeUpdate("2.0.0");
    updater.configure({ checker: async () => update });
    await updater.checkForUpdate();

    updater.dismissUpdate();

    expect(updater.dismissed).toBe(true);
    expect(updater.showToast).toBe(false);
    expect(updater.showBadge).toBe(true);
  });

  it("installs and relaunches via the injected seams", async () => {
    const { update, install } = fakeUpdate("3.0.0");
    const relauncher = vi.fn(async () => {});
    updater.configure({ checker: async () => update, relauncher });
    await updater.checkForUpdate();

    await updater.installUpdate();

    expect(install).toHaveBeenCalledOnce();
    expect(relauncher).toHaveBeenCalledOnce();
  });

  it("is a no-op to install without a pending update", async () => {
    const relauncher = vi.fn(async () => {});
    updater.configure({ relauncher });

    await updater.installUpdate();

    expect(relauncher).not.toHaveBeenCalled();
    expect(updater.installing).toBe(false);
  });

  it("clears the installing flag if install fails", async () => {
    const install = vi.fn(async () => {
      throw new Error("download failed");
    });
    updater.configure({
      checker: async () => ({ version: "4.0.0", downloadAndInstall: install }),
    });
    await updater.checkForUpdate();

    await updater.installUpdate();

    expect(install).toHaveBeenCalledOnce();
    expect(updater.installing).toBe(false);
  });

  it("schedules the launch check after the configured delay", async () => {
    vi.useFakeTimers();
    try {
      const { update } = fakeUpdate("5.0.0");
      updater.configure({ checker: async () => update });

      const cancel = updater.scheduleLaunchCheck();
      expect(updater.updateAvailable).toBe(false);

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);
      expect(updater.updateAvailable).toBe(true);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the launch check when disposed before firing", async () => {
    vi.useFakeTimers();
    try {
      const checker = vi.fn(async () => null);
      updater.configure({ checker });

      const cancel = updater.scheduleLaunchCheck();
      cancel();
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);

      expect(checker).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("UpdateToast", () => {
  beforeEach(() => {
    updater.resetForTests();
  });

  afterEach(() => {
    updater.resetForTests();
  });

  it("renders nothing when no update is available", () => {
    render(UpdateToast);
    expect(screen.queryByTestId("update-toast")).not.toBeInTheDocument();
  });

  it("shows the toast with the target version when available", async () => {
    const { update } = fakeUpdate("1.5.0");
    updater.configure({ checker: async () => update });
    await updater.checkForUpdate();

    render(UpdateToast);

    expect(screen.getByTestId("update-toast")).toBeInTheDocument();
    expect(screen.getByText(/1\.5\.0/)).toBeInTheDocument();
    expect(screen.getByText(/is\s+available/)).toBeInTheDocument();
  });

  it("Later dismisses and hides the toast", async () => {
    const { update } = fakeUpdate("1.5.0");
    updater.configure({ checker: async () => update });
    await updater.checkForUpdate();
    render(UpdateToast);

    await fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(updater.dismissed).toBe(true);
    expect(updater.showToast).toBe(false);
  });

  it("Update Now triggers the install flow", async () => {
    const { update, install } = fakeUpdate("1.5.0");
    const relauncher = vi.fn(async () => {});
    updater.configure({ checker: async () => update, relauncher });
    await updater.checkForUpdate();
    render(UpdateToast);

    await fireEvent.click(screen.getByRole("button", { name: "Update Now" }));

    await waitFor(() => expect(install).toHaveBeenCalledOnce());
    expect(relauncher).toHaveBeenCalledOnce();
  });
});

describe("Toolbar update badge", () => {
  beforeEach(() => {
    updater.resetForTests();
  });

  afterEach(() => {
    updater.resetForTests();
  });

  it("shows no badge until the update is dismissed", async () => {
    const { update } = fakeUpdate("2.1.0");
    updater.configure({ checker: async () => update });
    await updater.checkForUpdate();

    const { rerender } = render(Toolbar);
    expect(screen.queryByTestId("update-badge")).not.toBeInTheDocument();

    updater.dismissUpdate();
    await rerender({});
    expect(screen.getByTestId("update-badge")).toBeInTheDocument();
  });
});

describe("SettingsDrawer update entry", () => {
  beforeEach(async () => {
    updater.resetForTests();
    settings.resetForTests();
    ui.closeSettings();
    ipc.override("plugin:store|get", () => [undefined, false]);
    await settings.initialize();
  });

  afterEach(() => {
    updater.resetForTests();
    settings.resetForTests();
    ui.closeSettings();
  });

  it("shows the update entry and install button once dismissed", async () => {
    const { update, install } = fakeUpdate("2.2.0");
    const relauncher = vi.fn(async () => {});
    updater.configure({ checker: async () => update, relauncher });
    await updater.checkForUpdate();
    updater.dismissUpdate();

    ui.openSettings();
    render(SettingsDrawer, { props: { version: "2.1.0" } });

    expect(screen.getByText(/Update available/)).toBeInTheDocument();
    expect(screen.getByText(/v2\.2\.0/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
  });

  it("hides the update entry when nothing is pending", async () => {
    ui.openSettings();
    render(SettingsDrawer, { props: { version: "2.1.0" } });
    expect(screen.queryByText(/Update available/)).not.toBeInTheDocument();
  });
});
