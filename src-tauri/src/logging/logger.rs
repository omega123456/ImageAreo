//! The file-backed [`log::Log`] implementation, its global install, and the
//! panic hook.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use time::{Date, OffsetDateTime, UtcOffset};

use super::{
    daily_log_file_name, describe_panic, format_log_line, format_timestamp, prune_old_logs,
    LogLevel, RETENTION_DAYS,
};

/// Append-only writer that keeps one open file per calendar day and rolls over
/// (pruning stale files) when the day changes.
struct DailyWriter {
    open: Option<(Date, File)>,
}

impl DailyWriter {
    fn new() -> Self {
        Self { open: None }
    }

    fn write_line(&mut self, dir: &Path, date: Date, line: &str) -> std::io::Result<()> {
        let needs_roll = !matches!(self.open, Some((open_date, _)) if open_date == date);
        if needs_roll {
            std::fs::create_dir_all(dir)?;
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(daily_log_file_name(date)))?;
            self.open = Some((date, file));
            prune_old_logs(dir, date, RETENTION_DAYS);
        }
        if let Some((_, file)) = self.open.as_mut() {
            // One write per line: other instances append to the same file, and
            // a single append keeps their lines from interleaving mid-line.
            file.write_all(format!("{line}\n").as_bytes())?;
        }
        Ok(())
    }
}

/// A `log::Log` sink that writes to a daily file and to stdout, with a
/// runtime-adjustable minimum level.
pub struct FileLogger {
    dir: PathBuf,
    offset: UtcOffset,
    pid: u32,
    level: AtomicU8,
    writer: Mutex<DailyWriter>,
}

impl FileLogger {
    /// Create the logger, ensuring the log directory exists and pruning any
    /// already-stale daily files.
    ///
    /// `offset` is the local UTC offset, captured once by the caller while the
    /// process is still single-threaded: the `time` crate refuses to read it
    /// later on macOS, which would silently turn every timestamp into UTC.
    pub fn new(dir: &Path, level: LogLevel, offset: UtcOffset) -> std::io::Result<Arc<Self>> {
        std::fs::create_dir_all(dir)?;
        let logger = Self {
            dir: dir.to_path_buf(),
            offset,
            pid: std::process::id(),
            level: AtomicU8::new(level as u8),
            writer: Mutex::new(DailyWriter::new()),
        };
        prune_old_logs(dir, logger.now().date(), RETENTION_DAYS);
        Ok(Arc::new(logger))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The current wall-clock time in the captured local offset.
    pub fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc().to_offset(self.offset)
    }

    /// The current minimum capture level.
    pub fn level(&self) -> LogLevel {
        LogLevel::from_index(self.level.load(Ordering::Relaxed))
    }

    /// Change the minimum capture level; takes effect immediately for both the
    /// file sink and the global `log` filter.
    pub fn set_level(&self, level: LogLevel) {
        self.level.store(level as u8, Ordering::Relaxed);
        log::set_max_level(level.to_level_filter());
    }

    /// Whether a record at `level` passes the current filter.
    pub fn enabled_for(&self, level: log::Level) -> bool {
        LogLevel::from_log_level(level) <= self.level()
    }

    /// Write a single entry with an injected timestamp (the deterministic core
    /// used by tests and by [`log::Log::log`]).
    pub fn write_entry(&self, at: OffsetDateTime, level: LogLevel, target: &str, message: &str) {
        let line = format_log_line(&format_timestamp(at), level, self.pid, target, message);
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.write_line(&self.dir, at.date(), &line);
        }
        println!("{line}");
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        self.enabled_for(metadata.level())
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            self.write_entry(
                self.now(),
                LogLevel::from_log_level(record.level()),
                record.target(),
                &record.args().to_string(),
            );
        }
    }

    // Every line is written straight to the file (no userspace buffer).
    fn flush(&self) {}
}

/// Install `logger` as the process-global `log` sink and set the initial
/// filter. Returns `false` when a global logger was already installed.
pub fn install_global(logger: Arc<FileLogger>) -> bool {
    struct Global(Arc<FileLogger>);

    impl log::Log for Global {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            self.0.enabled(metadata)
        }
        fn log(&self, record: &log::Record<'_>) {
            self.0.log(record);
        }
        fn flush(&self) {
            self.0.flush();
        }
    }

    let filter = logger.level().to_level_filter();
    let installed = log::set_boxed_logger(Box::new(Global(logger))).is_ok();
    if installed {
        log::set_max_level(filter);
    }
    installed
}

/// Chain a panic hook that logs the panic (with a backtrace) at `error`, then
/// defers to the previously installed hook (the default one prints to stderr).
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!(
            target: "panic",
            "{}",
            describe_panic(
                info.payload(),
                info.location(),
                std::thread::current().name(),
                &backtrace,
            )
        );
        previous(info);
    }));
}
