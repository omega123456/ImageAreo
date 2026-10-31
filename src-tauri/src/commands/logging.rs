//! IPC commands for the application logger: frontend log forwarding and the
//! runtime minimum-level change. Persisting the level is the frontend settings
//! store's job; the backend re-reads it from `settings.json` on the next launch.

use crate::logging::{LogLevel, LoggingState};

/// Map a frontend level name onto a `log::Level`. Unknown values become `Info`.
pub fn frontend_log_level(level: &str) -> log::Level {
    match LogLevel::parse(level) {
        Some(LogLevel::Error) => log::Level::Error,
        Some(LogLevel::Warn) => log::Level::Warn,
        Some(LogLevel::Debug) => log::Level::Debug,
        Some(LogLevel::Trace) => log::Level::Trace,
        Some(LogLevel::Info) | None => log::Level::Info,
    }
}

/// Compose a frontend log message; serialized `details` (when present) are
/// appended to the message.
pub fn format_frontend_log(message: &str, details: Option<&str>) -> String {
    match details {
        Some(details) => format!("{message} {details}"),
        None => message.to_string(),
    }
}

/// Forward a frontend log line into the application logger under the
/// `frontend` target (`src/lib/utils/log.ts` routes every frontend log here).
#[tauri::command]
pub fn log_frontend(level: String, message: String, details: Option<String>) {
    log::log!(
        target: "frontend",
        frontend_log_level(&level),
        "{}",
        format_frontend_log(&message, details.as_deref())
    );
}

/// Apply a new minimum capture level to the live logger. A no-op when the
/// logger failed to initialise; an error for an unknown level name.
pub fn apply_log_level(state: &LoggingState, level: &str) -> Result<(), String> {
    let parsed = LogLevel::parse(level).ok_or_else(|| format!("invalid log level: {level}"))?;
    if let Some(logger) = &state.logger {
        logger.set_level(parsed);
    }
    Ok(())
}

#[tauri::command]
pub fn set_log_level(level: String, state: tauri::State<'_, LoggingState>) -> Result<(), String> {
    apply_log_level(&state, &level)
}
