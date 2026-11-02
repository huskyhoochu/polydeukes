//! The query log: one JSON line per answered `search`, `show`, or `obligations`, read back by `usage`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

const LOG_DIR: &str = ".polydeukes";
pub const LOG_PATH: &str = ".polydeukes/memory-log.jsonl";

/// Milliseconds since the epoch.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

/// `Date#toISOString` shape: `2026-09-28T00:00:00.000Z`.
fn iso_now() -> String {
    let millis = now_millis();
    let days = millis.div_euclid(86_400_000);
    let of_day = millis.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1000 % 60,
        of_day % 1000
    )
}

/// Appends one line in a single write; a log that cannot be written loses the line and leaves
/// the answer as it is.
pub fn append(command: &str, query: &str, results: &[Value]) {
    let entry = json!({ "at": iso_now(), "command": command, "query": query, "results": results });
    let write = || -> std::io::Result<()> {
        fs::create_dir_all(LOG_DIR)?;
        let mut file = OpenOptions::new()
            .append(true)
            .create(true)
            .open(LOG_PATH)?;
        file.write_all(format!("{entry}\n").as_bytes())
    };
    write().ok();
}

/// The log's entries, or `None` when there is no log or no line of it parses; a line that is not
/// JSON is the tail a process cut off mid-write and is skipped.
pub fn read() -> Option<Vec<Value>> {
    let bytes = fs::read(LOG_PATH).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let entries: Vec<Value> = text
        .split('\n')
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(Value::is_object)
        .collect();
    (!entries.is_empty()).then_some(entries)
}
