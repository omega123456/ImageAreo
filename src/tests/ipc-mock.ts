/**
 * IPC mock infrastructure for Vitest tests (Svelte adaptation of the sqllumen
 * pattern).
 *
 * The `src/lib/ipc/` layer is the single place `invoke()` is called in the app;
 * this seam intercepts every Tauri command so tests run deterministically with
 * no backend. Per-test overrides take precedence over the default fixtures.
 *
 * Usage:
 *   import { ipc } from "./ipc-mock";
 *
 *   ipc.override("scan_folder", () => [{ path: "/a.jpg", name: "a.jpg", modified: 0 }]);
 *   const result = await someStoreThatCallsScanFolder();
 *   expect(ipc.calls("scan_folder")).toHaveLength(1);
 *
 *   await ipc.emit("some-event", { value: 1 }); // requires shouldMockEvents
 *
 * `setupIpc()` is called at module scope in setup.ts — it registers the
 * beforeEach/afterEach hooks.
 */

import { afterEach, beforeEach } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { InvokeArgs } from "@tauri-apps/api/core";

import { IPC_FIXTURES, resetFixtureState, type IpcHandler } from "./fixtures";

/** Per-test command overrides — take precedence over IPC_FIXTURES. */
const _overrides = new Map<string, IpcHandler>();

/** Recorded call payloads per command, captured (deep-cloned) at call time. */
const _calls = new Map<string, unknown[]>();

export const ipc = {
  /**
   * Register a per-test override for a specific IPC command. The handler
   * receives the raw args and returns the mock response. Overrides are cleared
   * automatically after each test.
   */
  override(commandName: string, handlerFn: IpcHandler): void {
    if (commandName === "*") {
      throw new Error(
        "[ipc-mock] Wildcard override not allowed — use specific command names",
      );
    }
    _overrides.set(commandName, handlerFn);
  },

  /** Recorded call payloads for a command (deep-cloned snapshots). */
  calls(commandName: string): unknown[] {
    return _calls.get(commandName) ?? [];
  },

  /**
   * Emit a Tauri event to all registered listeners. Requires
   * `shouldMockEvents: true` (set in setupIpc).
   */
  emit<T = unknown>(eventName: string, payload?: T): Promise<void> {
    return emit(eventName, payload);
  },

  /** Clear all overrides and call records (called automatically by afterEach). */
  reset(): void {
    _overrides.clear();
    _calls.clear();
  },
} as const;

/** Register multiple per-test IPC overrides in one call. */
export function overrideIpcCommands(
  overrides: Record<string, IpcHandler>,
): void {
  for (const [cmd, handler] of Object.entries(overrides)) {
    ipc.override(cmd, handler);
  }
}

/**
 * Register beforeEach/afterEach hooks that install and tear down the IPC mock.
 * Resolution order per command: per-test override -> default fixture -> throw.
 */
export function setupIpc(): void {
  beforeEach(() => {
    resetFixtureState();
    mockIPC(
      (cmd: string, payload?: InvokeArgs) => {
        // Normalize the payload to a plain record; leave binary payloads as-is.
        const args =
          payload !== null &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          !(payload instanceof ArrayBuffer) &&
          !(payload instanceof Uint8Array)
            ? (payload as Record<string, unknown>)
            : undefined;

        const prev = _calls.get(cmd) ?? [];
        prev.push(
          args !== undefined ? JSON.parse(JSON.stringify(args)) : undefined,
        );
        _calls.set(cmd, prev);

        const override = _overrides.get(cmd);
        if (override) return override(args, cmd);

        const fixture = IPC_FIXTURES[cmd];
        if (fixture) return fixture(args, cmd);

        throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`);
      },
      { shouldMockEvents: true },
    );
  });

  afterEach(() => {
    ipc.reset();
    resetFixtureState();
    clearMocks();
  });
}
