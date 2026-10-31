//! Application logging: a custom `log::Log` sink that writes one file per day
//! under `<app config dir>/logs`, prunes files older than [`RETENTION_DAYS`],
//! and exposes a runtime-reconfigurable minimum level.
//!
//! The logger is installed at the very top of `lib::run`, before the Tauri
//! builder, so a launch that hangs or dies before its window appears still
//! leaves a trace (a release build on Windows has no console). That is why the
//! config dir and the persisted level are resolved here without Tauri's path
//! API. Several ImageAreo instances can run at once and share one daily file, so
//! every line carries the process id.
//!
//! The pure helpers here (level parsing, file naming, pruning, line formatting,
//! dir/level resolution, panic description) are tested directly. The global
//! logger + panic hook install in [`logger`] is the only process-global side
//! effect.

use std::any::Any;
use std::ffi::OsString;
use std::fmt::Display;
use std::panic::Location;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use time::{Date, Month, OffsetDateTime};

pub mod logger;

pub use logger::FileLogger;

/// Number of daily log files to keep (today plus the previous six days).
pub const RETENTION_DAYS: i64 = 7;

/// Overrides the log directory (used by tests; also handy for support).
pub const LOG_DIR_ENV: &str = "IMAGEAREO_LOG_DIR";

/// Matches `identifier` in `tauri.conf.json`, so the logs land beside the app's
/// other per-user data (`settings.json`, `.window-state.json`).
pub const APP_IDENTIFIER: &str = "app.imageareo.viewer";

/// The frontend settings store file (see `src/lib/stores/settings.svelte.ts`).
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// The settings-store key holding the persisted minimum level.
pub const SETTINGS_LOG_LEVEL_KEY: &str = "logLevel";

const LOG_FILE_PREFIX: &str = "imageareo-";
const LOG_FILE_SUFFIX: &str = ".log";

/// Separator between the target and the (escaped) message in a log line. The
/// surrounding spaces disambiguate it from the `::` inside Rust module paths
/// used as targets.
const TARGET_MESSAGE_SEP: &str = " :: ";

/// Minimum capture level, ordered most-severe (`Error`) to least (`Trace`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl LogLevel {
    /// Parse a case-insensitive level name. Returns `None` for unknown values.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "error" => Some(Self::Error),
            "warn" => Some(Self::Warn),
            "info" => Some(Self::Info),
            "debug" => Some(Self::Debug),
            "trace" => Some(Self::Trace),
            _ => None,
        }
    }

    /// Lowercase wire name (matches the frontend `LogLevel` union).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
            Self::Trace => "trace",
        }
    }

    /// Uppercase token written into the log line (`[INFO]`).
    pub fn token(self) -> &'static str {
        match self {
            Self::Error => "ERROR",
            Self::Warn => "WARN",
            Self::Info => "INFO",
            Self::Debug => "DEBUG",
            Self::Trace => "TRACE",
        }
    }

    /// The global `log` filter that admits this level and everything more severe.
    pub fn to_level_filter(self) -> log::LevelFilter {
        match self {
            Self::Error => log::LevelFilter::Error,
            Self::Warn => log::LevelFilter::Warn,
            Self::Info => log::LevelFilter::Info,
            Self::Debug => log::LevelFilter::Debug,
            Self::Trace => log::LevelFilter::Trace,
        }
    }

    /// Map a `log::Level` onto our level enum.
    pub fn from_log_level(level: log::Level) -> Self {
        match level {
            log::Level::Error => Self::Error,
            log::Level::Warn => Self::Warn,
            log::Level::Info => Self::Info,
            log::Level::Debug => Self::Debug,
            log::Level::Trace => Self::Trace,
        }
    }

    /// Round-trip through the `u8` discriminant stored in the logger's atomic.
    pub fn from_index(index: u8) -> Self {
        match index {
            0 => Self::Error,
            1 => Self::Warn,
            3 => Self::Debug,
            4 => Self::Trace,
            _ => Self::Info,
        }
    }
}

/// Shared logging handle managed by Tauri for runtime level changes. `None`
/// when the log directory could not be created — the app still launches.
#[derive(Clone, Default)]
pub struct LoggingState {
    pub logger: Option<Arc<FileLogger>>,
}

/// Resolve the app config dir for `os` (a `std::env::consts::OS` value),
/// mirroring Tauri's `app_config_dir`: `%APPDATA%\<id>` on Windows and
/// `~/Library/Application Support/<id>` on macOS. `None` when unknown.
pub fn resolve_config_dir(
    os: &str,
    appdata: Option<OsString>,
    home: Option<OsString>,
) -> Option<PathBuf> {
    let non_empty = |value: Option<OsString>| value.filter(|dir| !dir.is_empty());
    match os {
        "windows" => non_empty(appdata).map(|dir| PathBuf::from(dir).join(APP_IDENTIFIER)),
        "macos" => non_empty(home).map(|dir| {
            PathBuf::from(dir)
                .join("Library")
                .join("Application Support")
                .join(APP_IDENTIFIER)
        }),
        _ => None,
    }
}

/// The log directory: a non-empty override, else `<config dir>/logs`, else a
/// temp-dir fallback when the platform config dir is unknown.
pub fn resolve_log_dir(
    override_dir: Option<OsString>,
    config_dir: Option<&Path>,
    temp_dir: &Path,
) -> PathBuf {
    if let Some(dir) = override_dir.filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    match config_dir {
        Some(dir) => dir.join("logs"),
        None => temp_dir.join(APP_IDENTIFIER).join("logs"),
    }
}

/// The app config dir for the current process environment.
pub fn config_dir() -> Option<PathBuf> {
    resolve_config_dir(
        std::env::consts::OS,
        std::env::var_os("APPDATA"),
        std::env::var_os("HOME"),
    )
}

/// The log directory for the current process environment.
pub fn log_dir(config_dir: Option<&Path>) -> PathBuf {
    resolve_log_dir(
        std::env::var_os(LOG_DIR_ENV),
        config_dir,
        &std::env::temp_dir(),
    )
}

/// The persisted minimum level from the frontend settings store's JSON,
/// defaulting to `Info` when the file, key, or value is missing or invalid.
pub fn initial_level_from_settings(settings_json: Option<&str>) -> LogLevel {
    settings_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|value| {
            value
                .get(SETTINGS_LOG_LEVEL_KEY)
                .and_then(serde_json::Value::as_str)
                .and_then(LogLevel::parse)
        })
        .unwrap_or(LogLevel::Info)
}

/// Read the persisted level from `<config dir>/settings.json`.
pub fn initial_level(config_dir: Option<&Path>) -> LogLevel {
    let json =
        config_dir.and_then(|dir| std::fs::read_to_string(dir.join(SETTINGS_FILE_NAME)).ok());
    initial_level_from_settings(json.as_deref())
}

/// Format a timestamp as RFC 3339 with millisecond precision and the numeric
/// offset, e.g. `2026-10-31T13:14:00.123+01:00`.
pub fn format_timestamp(at: OffsetDateTime) -> String {
    let offset = at.offset();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}{}{:02}:{:02}",
        at.year(),
        u8::from(at.month()),
        at.day(),
        at.hour(),
        at.minute(),
        at.second(),
        at.millisecond(),
        if offset.is_negative() { '-' } else { '+' },
        offset.whole_hours().unsigned_abs(),
        offset.minutes_past_hour().unsigned_abs(),
    )
}

/// Daily file name for `date`, e.g. `imageareo-2026-10-31.log`.
pub fn daily_log_file_name(date: Date) -> String {
    format!(
        "{LOG_FILE_PREFIX}{:04}-{:02}-{:02}{LOG_FILE_SUFFIX}",
        date.year(),
        u8::from(date.month()),
        date.day(),
    )
}

/// Inverse of [`daily_log_file_name`]; `None` for anything that isn't a daily log.
pub fn parse_log_file_date(name: &str) -> Option<Date> {
    let stem = name
        .strip_prefix(LOG_FILE_PREFIX)?
        .strip_suffix(LOG_FILE_SUFFIX)?;
    let mut parts = stem.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u8 = parts.next()?.parse().ok()?;
    let day: u8 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
}

/// Delete daily log files whose date is at least `retention_days` older than
/// `today`. Unparseable names and IO errors (e.g. another instance deleting the
/// same file first) are ignored.
pub fn prune_old_logs(dir: &Path, today: Date, retention_days: i64) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(date) = name.to_str().and_then(parse_log_file_date) else {
            continue;
        };
        if (today - date).whole_days() >= retention_days {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Escape a message so the whole entry stays on a single line.
pub fn escape_message(message: &str) -> String {
    message
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

/// Compose a single log line (without the trailing newline).
pub fn format_log_line(
    timestamp: &str,
    level: LogLevel,
    pid: u32,
    target: &str,
    message: &str,
) -> String {
    format!(
        "{timestamp} [{}] [pid {pid}] {target}{TARGET_MESSAGE_SEP}{}",
        level.token(),
        escape_message(message),
    )
}

/// Describe a panic for the log: thread, location, message, and backtrace.
pub fn describe_panic(
    payload: &(dyn Any + Send),
    location: Option<&Location<'_>>,
    thread_name: Option<&str>,
    backtrace: &dyn Display,
) -> String {
    let message = payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("<non-string panic payload>");
    let location = location
        .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
        .unwrap_or_else(|| "<unknown location>".to_string());
    let thread = thread_name.unwrap_or("<unnamed>");

    format!("thread={thread} at {location}: {message}\nbacktrace:\n{backtrace}")
}
