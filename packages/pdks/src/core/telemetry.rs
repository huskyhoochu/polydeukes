//! The telemetry log: the one place the judge modules touch a file.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    Passed,
    Blocked,
    Witnessed,
    Advised,
    Skipped,
    Unattributed,
}

impl Event {
    fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "passed",
            Self::Blocked => "blocked",
            Self::Witnessed => "witnessed",
            Self::Advised => "advised",
            Self::Skipped => "skipped",
            Self::Unattributed => "unattributed",
        }
    }

    /// `bypassed` is the name `witnessed` was written under in older logs.
    fn parse(text: &str) -> Option<Self> {
        match text {
            "passed" => Some(Self::Passed),
            "blocked" => Some(Self::Blocked),
            "witnessed" | "bypassed" => Some(Self::Witnessed),
            "advised" => Some(Self::Advised),
            "skipped" => Some(Self::Skipped),
            "unattributed" => Some(Self::Unattributed),
            _ => None,
        }
    }
}

pub struct Record {
    pub timestamp: String,
    pub event: Event,
    pub subject: String,
}

const SKIP_REASONS: [&str; 3] = ["no-observation", "config-fault", "supply-pass"];

/// A tab or line break inside a field would fabricate fields or lines.
fn sanitize(value: &str) -> String {
    value.replace(['\t', '\n', '\r'], " ")
}

/// Append one timestamped row, creating the log's directory. A logging failure never
/// changes a verdict, so it is dropped here.
pub fn append(path: &Path, event: Event, label: &str, subject: &str) {
    append_row(path, event, label, subject, "");
}

/// A `skipped` row carries its skip reason as the fifth field.
pub fn append_skipped(path: &Path, label: &str, subject: &str, reason: &str) {
    append_row(path, Event::Skipped, label, subject, &format!("\t{reason}"));
}

fn append_row(path: &Path, event: Event, label: &str, subject: &str, tail: &str) {
    let line = format!(
        "{}\t{}\t{}\t{}{tail}\n",
        iso_utc(now_ms()),
        event.as_str(),
        sanitize(label),
        sanitize(subject)
    );
    #[expect(
        clippy::let_underscore_must_use,
        reason = "telemetry is fail-open: a missing row must not alter the verdict"
    )]
    let _ = write_line(path, &line);
}

fn write_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)?
        .write_all(line.as_bytes())
}

fn parse_line(line: &str) -> Option<Record> {
    let fields: Vec<&str> = line
        .strip_suffix('\n')
        .unwrap_or(line)
        .split('\t')
        .collect();
    let (timestamp, event, subject, fifth) = match fields.as_slice() {
        [timestamp, event, _, subject] => (*timestamp, *event, *subject, None),
        [timestamp, event, _, subject, fifth] => (*timestamp, *event, *subject, Some(*fifth)),
        _ => return None,
    };
    let event = Event::parse(event)?;
    if let Some(fifth) = fifth {
        let valid = if event == Event::Skipped {
            SKIP_REASONS.contains(&fifth)
        } else {
            serde_json::from_str::<Value>(fifth).is_ok_and(|value| value.is_array())
        };
        if !valid {
            return None;
        }
    }
    Some(Record {
        timestamp: timestamp.to_string(),
        event,
        subject: subject.to_string(),
    })
}

/// Every well-formed row; an absent or unreadable log is an empty one.
pub fn read_records(path: &Path) -> Vec<Record> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    String::from_utf8_lossy(&bytes)
        .split('\n')
        .filter(|line| !line.is_empty())
        .filter_map(parse_line)
        .collect()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// `Date.prototype.toISOString` for a millisecond instant.
pub fn iso_utc(ms: i64) -> String {
    const DAY_MS: i64 = 86_400_000;
    let (year, month, day) = civil_from_days(ms.div_euclid(DAY_MS));
    let in_day = ms.rem_euclid(DAY_MS);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!(
            "{}{:06}",
            if year < 0 { '-' } else { '+' },
            year.unsigned_abs()
        )
    };
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        in_day / 3_600_000,
        in_day / 60_000 % 60,
        in_day / 1000 % 60,
        in_day % 1000
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
