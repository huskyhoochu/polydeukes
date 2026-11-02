//! `pdks-memory`: answers memory queries from the markdown files, computed on every run.

mod config;
mod corpus;
mod log;
mod output;
mod parse;

use std::io::Write;
use std::process::ExitCode;

const USAGE: &str = "usage: pdks memory show <id> [--json] | pdks memory obligations <key> [--json] | pdks memory supersession <doc> [--json] | pdks memory lint [--json] | pdks memory stats [--json] | pdks memory usage [--json]";
const NO_OBLIGATION_RULES: &str = "memory.obligations is not declared — add the line or section rules that mark an obligation to the project config";
const NO_LOG: &str = "no memory log at .polydeukes/memory-log.jsonl — run pdks memory search, show, or obligations first";

enum Command {
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

fn parse_args(args: &[String]) -> Result<(Command, bool), String> {
    let rest = args.get(1..).unwrap_or_default();
    let words: Vec<&str> = rest
        .iter()
        .map(String::as_str)
        .filter(|arg| *arg != "--json")
        .collect();
    let json = words.len() < rest.len();
    let command = match (args.first().map(String::as_str), words.as_slice()) {
        _ if words.iter().any(|word| word.starts_with("--")) => None,
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
        Command::Show(id) => {
            let text = output::show(&corpus, &id, json)
                .ok_or_else(|| format!("unknown memory id: {id}"))?;
            log::append("show", &id, std::slice::from_ref(&id));
            Ok(answered(text))
        }
        Command::Obligations(key) => {
            let (text, ids) = output::obligations(&corpus, &key, json);
            log::append("obligations", &key, &ids);
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
