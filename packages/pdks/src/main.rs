mod baseline;
mod check;
mod core;
mod covenant;
mod diff;
mod docs;
mod explain;
mod init;
mod load_config;

use std::env;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, ExitCode};

use check::{CheckSpec, Mode, run_covenant_check};
use covenant::run_covenant::Enforce;

const BUILTINS: [&str; 4] = ["explain", "init", "docs", "covenant"];

const USAGE: &str = "usage: pdks covenant check [--diff | --input-failure] [--enforce advise|block] [--config-layer <path>] [--telemetry-path <path>] | pdks explain | pdks init | pdks --version | pdks docs [topic | search <query> | show <document-id>] | pdks <extension> [args...]";

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

/// Write a finished report to stdout, or the failure to stderr, as the exit code.
fn emit(command: &str, report: Result<String, String>) -> ExitCode {
    match report {
        Ok(text) => match std::io::stdout().write_all(text.as_bytes()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("pdks {command}: {error}");
                ExitCode::from(2)
            }
        },
        Err(reason) => {
            eprintln!("pdks {command}: {reason}");
            ExitCode::from(2)
        }
    }
}

/// Run `pdks-<name>` from PATH when the first argument is a plain extension name that is not a
/// builtin, passing the remaining arguments through unchanged. `None` means the argv names no
/// extension.
fn run_extension(args: &[OsString]) -> Option<ExitCode> {
    let (first, rest) = args.split_first()?;
    let name = first.to_str()?;
    if BUILTINS
        .iter()
        .any(|builtin| builtin.eq_ignore_ascii_case(name))
        || name.is_empty()
        || name.starts_with('-')
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let mut command = Command::new(format!("pdks-{name}"));
    command.args(rest);
    // On Unix the extension replaces this process, so signals reach it and its exit status is the
    // caller's; `exec` returns only when it fails.
    #[cfg(unix)]
    let launched: std::io::Result<u8> = {
        use std::os::unix::process::CommandExt;
        Err(command.exec())
    };
    #[cfg(not(unix))]
    let launched: std::io::Result<u8> = command.status().map(|status| {
        status
            .code()
            .and_then(|code| u8::try_from(code).ok())
            .unwrap_or(2)
    });
    let code = match launched {
        Ok(code) => code,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            eprintln!(
                "pdks: '{name}' is not a pdks command and no pdks-{name} executable is on PATH; install pdks-{name} to add it"
            );
            eprintln!("{USAGE}");
            2
        }
        Err(error) => {
            eprintln!("pdks: cannot run pdks-{name}: {error}");
            2
        }
    };
    Some(ExitCode::from(code))
}

fn main() -> ExitCode {
    let os_args: Vec<OsString> = env::args_os().skip(1).collect();
    let args: Option<Vec<String>> = os_args
        .iter()
        .map(|arg| arg.to_str().map(String::from))
        .collect();
    let flags = match args.as_deref() {
        Some([command]) if command == "--version" => {
            let version = format!("pdks {}\n", env!("CARGO_PKG_VERSION"));
            return emit("--version", Ok(version));
        }
        Some([command]) if command == "explain" || command == "init" => {
            let report = env::current_dir()
                .map_err(|error| error.to_string())
                .and_then(|root| {
                    if command == "explain" {
                        explain::explain(&root)
                    } else {
                        init::init(&root)
                    }
                });
            return emit(command, report);
        }
        Some([command, rest @ ..]) if command == "docs" => {
            return emit("docs", docs::run(rest));
        }
        Some([command, subcommand, flags @ ..])
            if command == "covenant" && subcommand == "check" =>
        {
            parse_check_flags(flags)
        }
        _ => None,
    };
    let Some(flags) = flags else {
        if let Some(code) = run_extension(&os_args) {
            return code;
        }
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
