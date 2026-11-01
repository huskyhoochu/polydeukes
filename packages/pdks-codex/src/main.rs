//! The Codex adapter: `init` registers the hooks, `hook` judges one `PreToolUse` call and records
//! the session's tool calls.

mod apply_patch;
mod evidence;
mod hook;
mod init;
mod paths;
mod translate;

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::ExitCode;

const USAGE: &str = "usage: pdks-codex init | pdks-codex hook --project-root <absolute-path> --pdks <absolute-path>";

fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().collect();
    let rest: Vec<&OsStr> = args.iter().skip(1).map(OsString::as_os_str).collect();
    match rest.as_slice() {
        [command] if *command == "init" => init::run(args.first().map(OsString::as_os_str)),
        [command, root_flag, root, pdks_flag, pdks]
            if *command == "hook"
                && *root_flag == "--project-root"
                && *pdks_flag == "--pdks"
                && Path::new(root).is_absolute()
                && Path::new(pdks).is_absolute() =>
        {
            hook::run(Path::new(root), Path::new(pdks))
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
