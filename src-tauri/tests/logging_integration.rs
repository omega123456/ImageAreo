//! Application logger: level handling, daily file naming and pruning, line
//! format, dir/level resolution, the panic hook, and the logging IPC commands.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use imageareo_lib::commands::logging::{
    apply_log_level, format_frontend_log, frontend_log_level, log_frontend, set_log_level,
};
use imageareo_lib::logging::{
    self, daily_log_file_name, describe_panic, escape_message, format_log_line, format_timestamp,
    initial_level, initial_level_from_settings, logger, parse_log_file_date, prune_old_logs,
    resolve_config_dir, resolve_log_dir, FileLogger, LogLevel, LoggingState, APP_IDENTIFIER,
    LOG_DIR_ENV, RETENTION_DAYS, SETTINGS_FILE_NAME,
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;
use time::{Date, Duration, Month, OffsetDateTime, UtcOffset};

const ALL_LEVELS: [LogLevel; 5] = [
    LogLevel::Error,
    LogLevel::Warn,
    LogLevel::Info,
    LogLevel::Debug,
    LogLevel::Trace,
];

fn os(value: &str) -> Option<OsString> {
    Some(OsString::from(value))
}

fn date(year: i32, month: u8, day: u8) -> Date {
    Date::from_calendar_date(year, Month::try_from(month).unwrap(), day).unwrap()
}

fn at(day: Date, hour: u8, minute: u8, offset: UtcOffset) -> OffsetDateTime {
    day.with_hms_milli(hour, minute, 0, 250)
        .unwrap()
        .assume_offset(offset)
}

fn read_log(dir: &Path, day: Date) -> String {
    fs::read_to_string(dir.join(daily_log_file_name(day))).unwrap_or_default()
}

fn pid_tag() -> String {
    format!("[pid {}]", std::process::id())
}

#[test]
fn log_level_parses_case_insensitively_and_rejects_unknown_names() {
    assert_eq!(LogLevel::parse(" WARN "), Some(LogLevel::Warn));
    assert_eq!(LogLevel::parse("Trace"), Some(LogLevel::Trace));
    assert_eq!(LogLevel::parse("verbose"), None);
}

#[test]
fn log_level_conversions_round_trip() {
    let filters = [
        log::LevelFilter::Error,
        log::LevelFilter::Warn,
        log::LevelFilter::Info,
        log::LevelFilter::Debug,
        log::LevelFilter::Trace,
    ];
    let tokens = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
    for (index, level) in ALL_LEVELS.into_iter().enumerate() {
        assert_eq!(LogLevel::parse(level.as_str()), Some(level));
        assert_eq!(level.token(), tokens[index]);
        assert_eq!(level.to_level_filter(), filters[index]);
        assert_eq!(
            LogLevel::from_log_level(filters[index].to_level().unwrap()),
            level
        );
        assert_eq!(LogLevel::from_index(level as u8), level);
    }
    assert_eq!(LogLevel::from_index(99), LogLevel::Info);
    assert!(LogLevel::Error < LogLevel::Trace);
}

#[test]
fn resolve_config_dir_uses_platform_locations() {
    assert_eq!(
        resolve_config_dir("windows", os("C:/Users/u/AppData/Roaming"), os("/home")),
        Some(PathBuf::from("C:/Users/u/AppData/Roaming").join(APP_IDENTIFIER))
    );
    assert_eq!(
        resolve_config_dir("macos", None, os("/Users/u")),
        Some(PathBuf::from("/Users/u/Library/Application Support").join(APP_IDENTIFIER))
    );
    assert_eq!(resolve_config_dir("windows", os(""), None), None);
    assert_eq!(resolve_config_dir("macos", None, None), None);
    assert_eq!(resolve_config_dir("linux", os("x"), os("/home/u")), None);
}

#[test]
fn resolve_log_dir_prefers_override_then_config_then_temp() {
    let config = PathBuf::from("/cfg");
    let temp = PathBuf::from("/tmp");
    assert_eq!(
        resolve_log_dir(os("/elsewhere"), Some(&config), &temp),
        PathBuf::from("/elsewhere")
    );
    assert_eq!(
        resolve_log_dir(os(""), Some(&config), &temp),
        config.join("logs")
    );
    assert_eq!(
        resolve_log_dir(None, None, &temp),
        temp.join(APP_IDENTIFIER).join("logs")
    );
}

#[test]
fn process_environment_resolution_honours_the_log_dir_override() {
    if let Some(dir) = logging::config_dir() {
        assert!(dir.ends_with(APP_IDENTIFIER));
    }
    let override_dir = tempfile::tempdir().unwrap();
    std::env::set_var(LOG_DIR_ENV, override_dir.path());
    assert_eq!(logging::log_dir(None), override_dir.path());
    std::env::remove_var(LOG_DIR_ENV);
}

#[test]
fn initial_level_reads_the_settings_store_json() {
    assert_eq!(
        initial_level_from_settings(Some(r#"{"theme":"dark","logLevel":"debug"}"#)),
        LogLevel::Debug
    );
    for fallback in [
        Some(r#"{"logLevel":"loud"}"#),
        Some(r#"{"logLevel":3}"#),
        Some(r#"{"theme":"dark"}"#),
        Some("not json"),
        None,
    ] {
        assert_eq!(initial_level_from_settings(fallback), LogLevel::Info);
    }

    let config = tempfile::tempdir().unwrap();
    assert_eq!(initial_level(Some(config.path())), LogLevel::Info);
    fs::write(
        config.path().join(SETTINGS_FILE_NAME),
        r#"{"logLevel":"error"}"#,
    )
    .unwrap();
    assert_eq!(initial_level(Some(config.path())), LogLevel::Error);
    assert_eq!(initial_level(None), LogLevel::Info);
}

#[test]
fn format_timestamp_renders_rfc3339_with_offset() {
    let day = date(2026, 10, 31);
    assert_eq!(
        format_timestamp(at(day, 13, 14, UtcOffset::from_hms(1, 0, 0).unwrap())),
        "2026-10-31T13:14:00.250+01:00"
    );
    assert_eq!(
        format_timestamp(at(day, 9, 5, UtcOffset::from_hms(-5, -30, 0).unwrap())),
        "2026-10-31T09:05:00.250-05:30"
    );
    assert_eq!(
        format_timestamp(at(day, 0, 0, UtcOffset::UTC)),
        "2026-10-31T00:00:00.250+00:00"
    );
}

#[test]
fn daily_file_names_round_trip() {
    let day = date(2026, 1, 5);
    assert_eq!(daily_log_file_name(day), "imageareo-2026-01-05.log");
    assert_eq!(parse_log_file_date("imageareo-2026-01-05.log"), Some(day));
    for invalid in [
        "imageareo-2026-13-01.log",
        "imageareo-2026-02-30.log",
        "imageareo-2026-10.log",
        "imageareo-2026-10-31-extra.log",
        "imageareo-x-10-31.log",
        "imageareo-2026-10-31.txt",
        "axopane-2026-10-31.log",
    ] {
        assert_eq!(parse_log_file_date(invalid), None, "{invalid}");
    }
}

#[test]
fn prune_removes_files_at_or_past_retention_and_keeps_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let today = date(2026, 10, 31);
    let expired = today - Duration::days(RETENTION_DAYS);
    let kept = today - Duration::days(RETENTION_DAYS - 1);
    for day in [expired, kept, today] {
        fs::write(dir.path().join(daily_log_file_name(day)), "x").unwrap();
    }
    fs::write(dir.path().join("notes.txt"), "x").unwrap();

    prune_old_logs(dir.path(), today, RETENTION_DAYS);

    assert!(!dir.path().join(daily_log_file_name(expired)).exists());
    assert!(dir.path().join(daily_log_file_name(kept)).exists());
    assert!(dir.path().join(daily_log_file_name(today)).exists());
    assert!(dir.path().join("notes.txt").exists());

    // A missing directory is a no-op rather than an error.
    prune_old_logs(&dir.path().join("missing"), today, RETENTION_DAYS);
}

#[test]
fn log_lines_stay_on_one_line_and_carry_the_pid() {
    assert_eq!(escape_message("a\\b\nc\rd"), "a\\\\b\\nc\\rd");
    assert_eq!(
        format_log_line(
            "2026-10-31T13:14:00.250+01:00",
            LogLevel::Warn,
            42632,
            "startup",
            "line one\nline two"
        ),
        "2026-10-31T13:14:00.250+01:00 [WARN] [pid 42632] startup :: line one\\nline two"
    );
}

#[test]
fn describe_panic_reads_str_string_and_other_payloads() {
    let location = std::panic::Location::caller();
    let static_payload: &str = "boom";
    let text = describe_panic(&static_payload, Some(location), Some("main"), &"<bt>");
    assert!(text.starts_with("thread=main at "), "{text}");
    assert!(text.contains(&format!("{}:{}:", location.file(), location.line())));
    assert!(text.ends_with(": boom\nbacktrace:\n<bt>"), "{text}");

    let owned_payload = String::from("Failed to setup app: webview");
    assert_eq!(
        describe_panic(&owned_payload, None, None, &""),
        "thread=<unnamed> at <unknown location>: Failed to setup app: webview\nbacktrace:\n"
    );

    let text = describe_panic(&7_u32, None, Some("worker"), &"");
    assert!(text.contains("thread=worker") && text.contains("<non-string panic payload>"));
}

#[test]
fn file_logger_creates_its_dir_and_prunes_stale_files_on_open() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("nested").join("logs");
    fs::create_dir_all(&dir).unwrap();
    let stale = dir.join(daily_log_file_name(date(2000, 1, 1)));
    fs::write(&stale, "old").unwrap();

    let logger = FileLogger::new(&dir, LogLevel::Info, UtcOffset::UTC).unwrap();

    assert_eq!(logger.dir(), dir);
    assert!(!stale.exists());
    assert_eq!(logger.now().offset(), UtcOffset::UTC);
}

#[test]
fn file_logger_open_fails_when_the_dir_is_a_file() {
    let root = tempfile::tempdir().unwrap();
    let blocker = root.path().join("file");
    fs::write(&blocker, "").unwrap();
    assert!(FileLogger::new(&blocker, LogLevel::Info, UtcOffset::UTC).is_err());
}

#[test]
fn write_entry_appends_and_rolls_over_at_midnight() {
    let dir = tempfile::tempdir().unwrap();
    let offset = UtcOffset::from_hms(2, 0, 0).unwrap();
    let logger = FileLogger::new(dir.path(), LogLevel::Info, offset).unwrap();
    let day_one = date(2026, 10, 30);
    let day_two = date(2026, 10, 31);
    // Exactly RETENTION_DAYS before day two, so the rollover must prune it.
    let expired = day_two - Duration::days(RETENTION_DAYS);
    fs::write(dir.path().join(daily_log_file_name(expired)), "old").unwrap();

    logger.write_entry(
        at(day_one, 23, 58, offset),
        LogLevel::Info,
        "startup",
        "first",
    );
    logger.write_entry(
        at(day_one, 23, 59, offset),
        LogLevel::Warn,
        "startup",
        "second",
    );
    logger.write_entry(at(day_two, 0, 1, offset), LogLevel::Error, "panic", "third");

    let first_day = read_log(dir.path(), day_one);
    let lines: Vec<&str> = first_day.lines().collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(
        lines[0],
        format!(
            "2026-10-30T23:58:00.250+02:00 [INFO] {} startup :: first",
            pid_tag()
        )
    );
    assert!(lines[1].contains("[WARN]") && lines[1].ends_with("startup :: second"));
    let second_day = read_log(dir.path(), day_two);
    assert_eq!(second_day.lines().count(), 1);
    assert!(second_day.contains("[ERROR]") && second_day.ends_with("panic :: third\n"));
    assert!(!dir.path().join(daily_log_file_name(expired)).exists());
}

#[test]
fn write_entry_is_silent_when_the_dir_disappears() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("logs");
    let logger = FileLogger::new(&dir, LogLevel::Info, UtcOffset::UTC).unwrap();
    fs::remove_dir_all(&dir).unwrap();
    // Recreate the dir path as a file so the per-day open cannot succeed.
    fs::write(&dir, "").unwrap();

    logger.write_entry(
        at(date(2026, 10, 31), 1, 0, UtcOffset::UTC),
        LogLevel::Info,
        "startup",
        "lost",
    );
    assert!(dir.is_file());
}

#[test]
fn level_filter_applies_to_records() {
    use log::Log;

    let dir = tempfile::tempdir().unwrap();
    let logger = FileLogger::new(dir.path(), LogLevel::Warn, UtcOffset::UTC).unwrap();
    assert_eq!(logger.level(), LogLevel::Warn);
    assert!(logger.enabled_for(log::Level::Error));
    assert!(!logger.enabled_for(log::Level::Info));

    let record = |level, message| {
        logger.log(
            &log::Record::builder()
                .level(level)
                .target("frontend")
                .args(format_args!("{message}"))
                .build(),
        );
    };
    record(log::Level::Info, "dropped");
    record(log::Level::Warn, "kept");
    logger.set_level(LogLevel::Trace);
    assert!(logger.enabled(&log::Metadata::builder().level(log::Level::Trace).build()));
    record(log::Level::Debug, "now kept");
    logger.flush();

    let contents = read_log(dir.path(), logger.now().date());
    assert!(!contents.contains("dropped"));
    assert!(contents.contains("[WARN]") && contents.contains("frontend :: kept"));
    assert!(contents.contains("[DEBUG]") && contents.contains("now kept"));
}

#[test]
fn frontend_log_helpers_map_levels_and_append_details() {
    assert_eq!(frontend_log_level("error"), log::Level::Error);
    assert_eq!(frontend_log_level("warn"), log::Level::Warn);
    assert_eq!(frontend_log_level("info"), log::Level::Info);
    assert_eq!(frontend_log_level("debug"), log::Level::Debug);
    assert_eq!(frontend_log_level("trace"), log::Level::Trace);
    assert_eq!(frontend_log_level("shout"), log::Level::Info);

    assert_eq!(format_frontend_log("failed", None), "failed");
    assert_eq!(
        format_frontend_log("failed", Some(r#"{"path":"/a.jpg"}"#)),
        r#"failed {"path":"/a.jpg"}"#
    );
}

#[test]
fn set_log_level_updates_the_managed_logger() {
    let dir = tempfile::tempdir().unwrap();
    let logger = FileLogger::new(dir.path(), LogLevel::Info, UtcOffset::UTC).unwrap();
    let app = mock_builder()
        .manage(LoggingState {
            logger: Some(Arc::clone(&logger)),
        })
        .build(mock_context(noop_assets()))
        .expect("mock app should build");

    set_log_level("debug".into(), app.state()).unwrap();
    assert_eq!(logger.level(), LogLevel::Debug);

    let err = set_log_level("loud".into(), app.state()).unwrap_err();
    assert_eq!(err, "invalid log level: loud");
    assert_eq!(logger.level(), LogLevel::Debug);

    // Without a logger (init failed) a valid level is accepted as a no-op.
    assert_eq!(apply_log_level(&LoggingState::default(), "warn"), Ok(()));
}

#[test]
fn global_logger_records_frontend_lines_and_panics() {
    // The global logger and panic hook are per process (nextest runs each test
    // in its own process), so the whole lifecycle lives in this one test.
    let dir = tempfile::tempdir().unwrap();
    let file_logger = FileLogger::new(dir.path(), LogLevel::Info, UtcOffset::UTC).unwrap();
    assert!(logger::install_global(Arc::clone(&file_logger)));
    assert!(!logger::install_global(Arc::clone(&file_logger)));
    logger::install_panic_hook();

    log::info!(target: "startup", "launch");
    log::debug!(target: "startup", "filtered");
    log_frontend(
        "warn".into(),
        "upgrade failed".into(),
        Some(r#"{"path":"/a.jpg"}"#.into()),
    );
    let joined = std::thread::Builder::new()
        .name("panicker".into())
        .spawn(|| panic!("startup exploded"))
        .unwrap()
        .join();
    assert!(joined.is_err());
    log::logger().flush();
    let metadata = |level| log::Metadata::builder().level(level).build();
    assert!(log::logger().enabled(&metadata(log::Level::Warn)));
    assert!(!log::logger().enabled(&metadata(log::Level::Debug)));

    let contents = read_log(dir.path(), file_logger.now().date());
    let pid = pid_tag();
    assert!(contents.contains(&format!("[INFO] {pid} startup :: launch")));
    assert!(!contents.contains("filtered"));
    assert!(contents.contains(&format!(
        r#"[WARN] {pid} frontend :: upgrade failed {{"path":"/a.jpg"}}"#
    )));
    assert!(
        contents.contains(&format!("[ERROR] {pid} panic :: thread=panicker at ")),
        "{contents}"
    );
    assert!(contents.contains("startup exploded\\nbacktrace:\\n"));
}
