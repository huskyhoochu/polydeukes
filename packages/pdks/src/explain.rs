//! `pdks explain` — render both surfaces' assembled registrations without judging.
//!
//! The registrations come from the same assembly the judge uses, so the text reports the table
//! that would judge. Nothing is written: no telemetry row, no baseline.

use std::fs;
use std::path::Path;

use crate::check::{assemble, staged_roster};
use crate::core::config::{Entry, Level, Surface};
use crate::core::declaration::{ALL_AXES, ALL_RELATIONS, Binding};
use crate::covenant::dispatch::{Judge, Registration};
use crate::load_config::{discover_config_path, parse_config_source};

/// Names the session evidence path; the assembly needs a present value to build the
/// conditional registration, and nothing prints it.
const EVIDENCE_PATH_KEY: &str = "session.evidencePath";

fn declare_description(entry: &Entry) -> String {
    let declaration = &entry.declaration;
    let (axes, relations) = declaration.shape();
    let axes = ALL_AXES.iter().filter(|axis| axes.contains(axis));
    let relations = ALL_RELATIONS
        .iter()
        .filter(|relation| relations.contains(relation));
    let relate: Vec<&str> = declaration
        .relate
        .iter()
        .map(|relate| relate.id.as_str())
        .collect();
    let (scope, include, exclude) = declaration.scope.as_ref().map_or_else(
        || ("scope every world".to_string(), 0, 0),
        |scope| {
            (
                format!("scope {}", scope.source),
                scope.include.len(),
                scope.exclude.len(),
            )
        },
    );
    let sidecar = declaration
        .sources
        .iter()
        .filter(|(_, binding)| matches!(binding, Binding::Sidecar))
        .count();
    let transcript = declaration
        .sources
        .iter()
        .filter(|(_, binding)| matches!(binding, Binding::Transcript))
        .count();
    let kinds: Vec<String> = [("sidecar", sidecar), ("transcript", transcript)]
        .into_iter()
        .filter(|(_, count)| *count > 0)
        .map(|(kind, count)| format!("{kind} {count}"))
        .collect();
    let counted = if kinds.is_empty() {
        String::new()
    } else {
        format!(" ({})", kinds.join(", "))
    };
    let valve = if declaration.witness.is_some() {
        "✓"
    } else {
        "—"
    };
    let why = if entry.why.is_some() { "✓" } else { "—" };
    let level = if entry.level == Level::Block {
        " · enforce: block"
    } else {
        ""
    };
    format!(
        "{} · {} · {} {} · {scope} · include {include} · exclude {exclude} · sources {}{counted} \
         · valve {valve} · why {why}{level}",
        declaration.mechanism,
        axes.copied().collect::<Vec<_>>().join(","),
        relations.copied().collect::<Vec<_>>().join(","),
        relate.join(", "),
        declaration.sources.len(),
    )
}

fn row(kind: &str, label: &str, width: usize, description: &str) -> String {
    format!("  {kind:<8} {label:<width$} {description}")
}

fn render_surface(header: &str, registrations: &[Registration], drafts: &[String]) -> String {
    let width = registrations
        .iter()
        .map(|registration| &registration.label)
        .chain(drafts)
        .map(|label| label.chars().count())
        .max()
        .unwrap_or(0);
    let (mut declare, mut skip, mut meta) = (0, 0, 0);
    let mut lines = Vec::new();
    for registration in registrations {
        let label = &registration.label;
        match &registration.judge {
            Judge::DisciplineSkip(_) | Judge::ShellMod { .. } => {}
            Judge::SelfMod {
                protected_paths, ..
            } => {
                meta += 1;
                let description = format!(
                    "paths {} (includes the config file itself)",
                    protected_paths.len()
                );
                lines.push(row("meta", label, width, &description));
            }
            Judge::TranscriptMod(_) => {
                meta += 1;
                let description = format!("content predicate · conditional: {EVIDENCE_PATH_KEY}");
                lines.push(row("meta", label, width, &description));
            }
            Judge::ShellUnjudgeable => {
                skip += 1;
                let description = "a shell command whose write target this layer cannot determine";
                lines.push(row("skip", label, width, description));
            }
            Judge::Discipline(entry) => {
                declare += 1;
                lines.push(row("declare", label, width, &declare_description(entry)));
            }
        }
    }
    for draft in drafts {
        lines.push(row("draft", draft, width, "unpromoted — no judgment"));
    }
    let tally = format!(
        "  registrations {} · declare {declare} · skip {skip} · meta {meta} · draft {}",
        meta + declare + skip,
        drafts.len()
    );
    let mut all = vec![header.to_string(), tally];
    all.extend(lines);
    all.join("\n")
}

pub fn explain(root: &Path) -> Result<String, String> {
    let config_path = discover_config_path(root)?;
    let source = fs::read(root.join(&config_path)).map_err(|error| error.to_string())?;
    let config = parse_config_source(&String::from_utf8_lossy(&source), &config_path, None)?;

    let session = assemble(
        root,
        &config,
        config.entries(Surface::Session),
        &staged_roster(),
        &[],
        Some(EVIDENCE_PATH_KEY),
    );
    let change_set = assemble(
        root,
        &config,
        config.entries(Surface::ChangeSet),
        &staged_roster(),
        &[],
        None,
    );

    let shared = config.shared_count;
    let session_only = config.entries(Surface::Session).len() - shared;
    let change_set_only = config.entries(Surface::ChangeSet).len() - shared;
    let session_header = format!(
        "input: call IR (one call, stdin) · disciplines {shared} · sessionDisciplines \
         {session_only} · disciplines: advise unless enforce: block · meta: block"
    );
    let change_set_header = format!(
        "input: --diff (change set, stdin) · disciplines {shared} · changeSetDisciplines \
         {change_set_only} · disciplines: advise unless enforce: block"
    );
    Ok(format!(
        "pdks explain — {config_path}\n\n{}\n\n{}\n",
        render_surface(&session_header, &session, &config.drafts),
        render_surface(&change_set_header, &change_set, &config.drafts)
    ))
}
