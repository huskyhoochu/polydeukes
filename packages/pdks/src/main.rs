mod baseline;
mod check;
mod core;
mod covenant;
mod load_config;

use std::env;
use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

use check::{CheckSpec, Mode, run_covenant_check};
use covenant::run_covenant::Enforce;

const USAGE: &str = "usage: pdks covenant check [--diff | --input-failure] [--enforce advise|block] [--config-layer <path>] [--telemetry-path <path>]";

struct Flags {
    mode: Mode,
    enforce: Enforce,
    config_layer: Option<String>,
    telemetry_path: Option<String>,
}

/// The `covenant check` flags, or `None` for any argv outside the finite table: one of
/// `--diff` or `--input-failure` at most once, `--enforce` at most once with `advise` or
/// `block`, `--config-layer` and `--telemetry-path` at most once each with a non-empty path
/// that does not start with `--`, in any order, and nothing else.
fn parse_check_flags(flags: &[String]) -> Option<Flags> {
    let mut mode = Mode::Ir;
    let mut enforce: Option<Enforce> = None;
    let mut config_layer: Option<String> = None;
    let mut telemetry_path: Option<String> = None;
    let mut remaining = flags.iter();
    while let Some(flag) = remaining.next() {
        match flag.as_str() {
            "--diff" if mode == Mode::Ir => mode = Mode::Diff,
            "--input-failure" if mode == Mode::Ir => mode = Mode::InputFailure,
            "--enforce" if enforce.is_none() => {
                enforce = Some(match remaining.next()?.as_str() {
                    "advise" => Enforce::Advise,
                    "block" => Enforce::Block,
                    _ => return None,
                });
            }
            "--config-layer" | "--telemetry-path" => {
                let slot = if flag == "--config-layer" {
                    &mut config_layer
                } else {
                    &mut telemetry_path
                };
                let path = remaining.next()?;
                if slot.is_some() || path.is_empty() || path.starts_with("--") {
                    return None;
                }
                *slot = Some(path.clone());
            }
            _ => return None,
        }
    }
    Some(Flags {
        mode,
        enforce: enforce.unwrap_or(Enforce::Advise),
        config_layer,
        telemetry_path,
    })
}

fn main() -> ExitCode {
    let args: Option<Vec<String>> = env::args_os()
        .skip(1)
        .map(|arg| arg.into_string().ok())
        .collect();
    let flags = match args.as_deref() {
        Some([command, subcommand, flags @ ..])
            if command == "covenant" && subcommand == "check" =>
        {
            parse_check_flags(flags)
        }
        _ => None,
    };
    let Some(flags) = flags else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };

    let mut bytes = Vec::new();
    if let Err(error) = std::io::stdin().read_to_end(&mut bytes) {
        eprintln!("covenant check failed closed: {error}");
        return ExitCode::from(2);
    }
    let root = match env::current_dir() {
        Ok(root) => root,
        Err(error) => {
            eprintln!("covenant check failed closed: {error}");
            return ExitCode::from(2);
        }
    };
    let telemetry_path = flags.telemetry_path.map(PathBuf::from);
    let exit = run_covenant_check(&CheckSpec {
        root: &root,
        mode: flags.mode,
        stdin: &String::from_utf8_lossy(&bytes),
        enforce: flags.enforce,
        config_layer: flags.config_layer.as_deref(),
        telemetry_path: telemetry_path.as_deref(),
    });
    ExitCode::from(exit.code())
}
