//! The execution wrapper: translate a judgment by enforce level, consult the witness valve,
//! write the break reason to stderr, and record exactly one telemetry row per call.

use std::path::Path;

use super::ttl_witness::Valve;
use crate::core::telemetry::{self, Event};

/// Whether a person takes part in the call; `session.userMessages` is read as human
/// utterances only when one does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attendance {
    Attended,
    Unattended,
}

/// The observer's posture. `Advise` records a break without stopping it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Enforce {
    Advise,
    Block,
}

pub enum Judgment {
    Upheld,
    Broken(String),
    /// A break a declaration found: its witnesses are the row's fifth field, and its own
    /// witness block (`opens`) can relax a block like the valve does.
    Declared {
        reason: String,
        witnesses: String,
        opens: bool,
    },
    /// A declaration that could not read a source. It blocks whatever the enforce level is.
    Unjudgeable(String),
    /// A declaration whose absent source its own supply policy let pass.
    SupplyPass,
    /// A declaration that reads human utterances in a call no human is part of.
    Unobserved,
}

/// What one wrapped judgment recorded. `valve_refused` is set when the valve was asked to
/// relax a block and kept it.
pub struct Verdict {
    pub event: Event,
    pub valve_refused: bool,
}

impl Verdict {
    pub fn is_blocked(&self) -> bool {
        self.event == Event::Blocked
    }
}

/// The order is judge, translate, valve: only a break that would block is put to the valve,
/// and what remains is recorded once, so a witnessed break leaves no `blocked` row.
pub fn run_covenant(
    judgment: &Judgment,
    label: &str,
    subject: &str,
    enforce: Enforce,
    valve: Option<&Valve>,
    telemetry_path: &Path,
) -> Verdict {
    let (reason, witnesses, declared_opens, enforce) = match judgment {
        Judgment::Upheld => {
            telemetry::append(telemetry_path, Event::Passed, label, subject);
            return Verdict {
                event: Event::Passed,
                valve_refused: false,
            };
        }
        Judgment::SupplyPass => {
            telemetry::append_skipped(telemetry_path, label, subject, "supply-pass");
            return Verdict {
                event: Event::Skipped,
                valve_refused: false,
            };
        }
        Judgment::Unobserved => return record_skip(label, subject, telemetry_path),
        Judgment::Broken(reason) => (reason, None, false, enforce),
        Judgment::Declared {
            reason,
            witnesses,
            opens,
        } => (reason, Some(witnesses), *opens, enforce),
        Judgment::Unjudgeable(reason) => (reason, None, false, Enforce::Block),
    };
    let mut valve_refused = false;
    let event = match enforce {
        Enforce::Advise => Event::Advised,
        Enforce::Block if declared_opens || valve.is_some_and(Valve::opens) => Event::Witnessed,
        Enforce::Block => {
            valve_refused = valve.is_some();
            Event::Blocked
        }
    };
    eprintln!("{reason}");
    match witnesses {
        Some(witnesses) => {
            telemetry::append_witnesses(telemetry_path, event, label, subject, witnesses);
        }
        None => telemetry::append(telemetry_path, event, label, subject),
    }
    Verdict {
        event,
        valve_refused,
    }
}

/// A registration with nothing to judge records the no-op: there is no verdict to relax, so
/// the valve is not consulted.
pub fn record_skip(label: &str, subject: &str, telemetry_path: &Path) -> Verdict {
    telemetry::append_skipped(telemetry_path, label, subject, "no-observation");
    Verdict {
        event: Event::Skipped,
        valve_refused: false,
    }
}
