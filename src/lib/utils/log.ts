/**
 * The single sanctioned logging sink for the frontend. Every other module must
 * route through these helpers — `src/tests/no-console.test.ts` fails the build
 * on raw `console` usage anywhere else under `src/lib/`.
 *
 * Lines are forwarded to the Rust `log_frontend` command, so they land in the
 * same daily log file as the backend's (target `frontend`). `console` is only a
 * last-resort sink when IPC is unavailable (e.g. before the Tauri runtime is
 * ready). `debug` is dev-only so production logs stay quiet; the backend's
 * minimum level filters the rest.
 */

import { logFrontend } from "../ipc";
import type { FrontendLogLevel } from "../ipc/commands";

export type LogContext = Record<string, unknown>;

/** Serialize a log context for the backend `details` field. */
export function serializeContext(context?: LogContext): string | undefined {
  if (context === undefined) return undefined;
  try {
    return JSON.stringify(context, (_key, value: unknown) =>
      value instanceof Error ? `${value.name}: ${value.message}` : value,
    );
  } catch {
    return String(context);
  }
}

function emit(level: FrontendLogLevel, message: string, context?: LogContext) {
  logFrontend({ level, message, details: serializeContext(context) }).catch(
    (error: unknown) => {
      const prefix = `[imageareo:${level}] ${message}`;
      if (context === undefined) {
        console[level](prefix, error);
      } else {
        console[level](prefix, context, error);
      }
    },
  );
}

export const log = {
  /** Verbose tracing. Suppressed entirely outside dev builds. */
  debug(message: string, context?: LogContext): void {
    if (!import.meta.env.DEV) return;
    emit("debug", message, context);
  },
  info(message: string, context?: LogContext): void {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext): void {
    emit("error", message, context);
  },
};
