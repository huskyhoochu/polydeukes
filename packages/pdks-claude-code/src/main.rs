//! The Claude Code adapter: `init` registers the hook, `hook` judges one `PreToolUse` call.

mod file_change;
mod hook;
mod init;
mod paths;
mod session;
mod translate;

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::ExitCode;

const USAGE: &str = "usage: pdks-claude-code init | pdks-claude-code hook --project-root <absolute-path> --pdks <absolute-path>";

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
