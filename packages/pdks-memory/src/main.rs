//! `pdks-memory`: answers memory queries from the markdown files, computed on every run.

mod config;
mod corpus;
mod log;
mod normalize;
mod output;
mod parse;
mod search;

use std::io::Write;
use std::process::ExitCode;

use serde_json::{Value, json};

const USAGE: &str = "usage: pdks memory search <query…> [--json] [--limit <n>] | pdks memory show <id> [--json] | pdks memory obligations <key> [--json] | pdks memory supersession <doc> [--json] | pdks memory lint [--json] | pdks memory stats [--json] | pdks memory usage [--json]";
const NO_OBLIGATION_RULES: &str = "memory.obligations is not declared — add the line or section rules that mark an obligation to the project config";
const NO_LOG: &str = "no memory log at .polydeukes/memory-log.jsonl — run pdks memory search, show, or obligations first";

const DEFAULT_LIMIT: usize = 20;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

enum Command {
    Search { query: String, limit: usize },
    Show(String),
    Obligations(String),
    Supersession(String),
    Lint,
    Stats,
    Usage,
}

struct Outcome {
    text: String,
    violations: bool,
}

/// Takes `--limit <n>` out of the words after `search`, before `--json` is looked for, so a
/// `--json` in the value slot is read as the value.
fn take_limit(rest: &[String]) -> Result<(Vec<String>, usize), String> {
    let Some(at) = rest.iter().position(|arg| arg == "--limit") else {
        return Ok((rest.to_vec(), DEFAULT_LIMIT));
    };
    let value = rest.get(at + 1).map_or("", String::as_str);
    let valid = !value.starts_with('0') && value.bytes().all(|byte| byte.is_ascii_digit());
    let limit = value
        .parse::<u64>()
        .ok()
        .filter(|limit| valid && *limit <= MAX_SAFE_INTEGER)
        .and_then(|limit| usize::try_from(limit).ok())
        .ok_or_else(|| USAGE.to_string())?;
    let kept = rest
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != at && *index != at + 1)
        .map(|(_, arg)| arg.clone())
        .collect();
    Ok((kept, limit))
}

fn parse_args(args: &[String]) -> Result<(Command, bool), String> {
    let verb = args.first().map(String::as_str);
    let given = args.get(1..).unwrap_or_default();
    let (rest, limit) = if verb == Some("search") {
        take_limit(given)?
    } else {
        (given.to_vec(), DEFAULT_LIMIT)
    };
    let words: Vec<&str> = rest
        .iter()
        .map(String::as_str)
        .filter(|arg| *arg != "--json")
        .collect();
    let json = words.len() < rest.len();
    let command = match (verb, words.as_slice()) {
        _ if words.iter().any(|word| word.starts_with("--")) => None,
        (Some("search"), [_, ..]) => Some(Command::Search {
            query: words.join(" "),
            limit,
        }),
        (Some("show"), [id]) => Some(Command::Show((*id).to_string())),
        (Some("obligations"), [key]) => Some(Command::Obligations((*key).to_string())),
        (Some("supersession"), [id]) => Some(Command::Supersession((*id).to_string())),
        (Some("lint"), []) => Some(Command::Lint),
        (Some("stats"), []) => Some(Command::Stats),
        (Some("usage"), []) => Some(Command::Usage),
        _ => None,
    };
    command
        .map(|command| (command, json))
        .ok_or_else(|| USAGE.to_string())
}

fn run() -> Result<Outcome, String> {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let (command, json) = parse_args(&args)?;
    let root = std::env::current_dir().map_err(|error| error.to_string())?;
    let settings = config::load(&root)?;
    if matches!(command, Command::Obligations(_)) && settings.obligations.is_empty() {
        return Err(NO_OBLIGATION_RULES.to_string());
    }
    let corpus = corpus::build(&root, &settings)?;
    let answered = |text: String| Outcome {
        text,
        violations: false,
    };
    match command {
        Command::Search { query, limit } => {
            let hits = search::find(&corpus, &settings, &query, limit);
            let results: Vec<Value> = hits
                .iter()
                .map(|hit| json!({ "id": hit.id, "matchPath": hit.match_path }))
                .collect();
            log::append("search", &query, &results);
            Ok(answered(output::search(&hits, json)))
        }
        Command::Show(id) => {
            let text = output::show(&corpus, &id, json)
                .ok_or_else(|| format!("unknown memory id: {id}"))?;
            log::append("show", &id, &[json!({ "id": id })]);
            Ok(answered(text))
        }
        Command::Obligations(key) => {
            let (text, ids) = output::obligations(&corpus, &key, json);
            let results: Vec<Value> = ids.iter().map(|id| json!({ "id": id })).collect();
            log::append("obligations", &key, &results);
            Ok(answered(text))
        }
        Command::Supersession(id) => output::supersession(&corpus, &id, json)
            .map(answered)
            .ok_or_else(|| format!("unknown memory id: {id}")),
        Command::Lint => {
            let (text, violations) = output::lint(&corpus, json);
            Ok(Outcome { text, violations })
        }
        Command::Stats => Ok(answered(output::stats(&corpus, json))),
        Command::Usage => {
            let entries = log::read().ok_or_else(|| NO_LOG.to_string())?;
            Ok(answered(output::usage(&corpus, &entries, json)))
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(outcome) => {
            if std::io::stdout()
                .write_all(outcome.text.as_bytes())
                .is_err()
            {
                return ExitCode::from(2);
            }
            ExitCode::from(u8::from(outcome.violations))
        }
        Err(message) => {
            eprintln!("pdks memory: {message}");
            ExitCode::from(2)
        }
    }
}
