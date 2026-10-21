use polydeukes_sdk::*;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::fs;
use std::io;
use std::num::NonZeroU32;
use std::path::Path;
use std::time::Duration;

fn verdict(value: CheckCovenantVerdict) -> Value {
    match value {
        CheckCovenantVerdict::Upheld { advisories } => {
            json!({"kind":"Upheld","advisories":advisories})
        }
        CheckCovenantVerdict::Blocked { reason } => json!({"kind":"Blocked","reason":reason}),
        CheckCovenantVerdict::Unjudged { reason } => json!({"kind":"Unjudged","reason":reason}),
    }
}

fn main() {
    let requests: Vec<Value> =
        serde_json::from_str(&fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap())
            .unwrap();
    let mut observations = Vec::new();
    for request in requests {
        let calls = RefCell::new(Vec::<Value>::new());
        let response = request.get("response");
        let spawn = |call: SpawnSpec| -> io::Result<SpawnOutcome> {
            calls.borrow_mut().push(json!({"args":call.args,"stdin":String::from_utf8(call.stdin).unwrap(),"timeoutMs":call.timeout.map(|v|v.as_millis() as u64)}));
            let data = response.unwrap();
            if let Some(error) = data["error"].as_str() {
                return Err(io::Error::new(
                    if error == "timeout" {
                        io::ErrorKind::TimedOut
                    } else {
                        io::ErrorKind::Other
                    },
                    error,
                ));
            }
            Ok(SpawnOutcome {
                status: data["status"].as_i64().map(|v| v as i32),
                stdout: match data.get("stdoutBytes") {
                    Some(v) => v
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|b| b.as_u64().unwrap() as u8)
                        .collect(),
                    None => data["stdout"].as_str().unwrap_or("").as_bytes().to_vec(),
                },
                stderr: data["stderr"].as_str().unwrap_or("").as_bytes().to_vec(),
            })
        };
        let seam = if response.is_some() {
            Some(&spawn as &dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>)
        } else {
            None
        };
        let root = Path::new(request["root"].as_str().unwrap());
        let executable = request["executable"].as_str().map(Path::new);
        let timeout = request["timeoutMs"].as_u64().map(Duration::from_millis);
        let enforce = request["enforce"].as_str().map(|v| {
            if v == "advise" {
                Enforce::Advise
            } else {
                Enforce::Block
            }
        });
        let config_layer = request["configLayer"].as_str().map(Path::new);
        let telemetry_path = request["telemetryPath"].as_str().map(Path::new);
        let value = match request["verb"].as_str().unwrap() {
            "check_covenant" => {
                let input = serde_json::from_value(request["input"].clone()).unwrap();
                verdict(check_covenant(CheckCovenantSpec {
                    repo_root: root,
                    input: &input,
                    enforce,
                    config_layer,
                    telemetry_path,
                    executable,
                    timeout,
                    spawn: seam,
                }))
            }
            "check_change_set" => verdict(check_change_set(CheckChangeSetSpec {
                repo_root: root,
                diff: request["diff"].as_str().unwrap(),
                enforce,
                config_layer,
                telemetry_path,
                executable,
                timeout,
                spawn: seam,
            })),
            "memory_ingest" => match memory_ingest(MemoryIngestSpec {
                root,
                executable,
                timeout,
                spawn: seam,
            }) {
                MemoryIngestOutcome::Ingested => json!({"kind":"Ingested"}),
                MemoryIngestOutcome::Unavailable { reason } => {
                    json!({"kind":"Unavailable","reason":reason})
                }
            },
            "memory_search" => match memory_search(MemorySearchSpec {
                root,
                query: request["query"].as_str().unwrap(),
                limit: request["limit"]
                    .as_u64()
                    .and_then(|n| NonZeroU32::new(n.try_into().unwrap())),
                executable,
                timeout,
                spawn: seam,
            }) {
                MemorySearchOutcome::Found { hits } => json!({"kind":"Found","hits":hits}),
                MemorySearchOutcome::Empty => json!({"kind":"Empty"}),
                MemorySearchOutcome::Unavailable { reason } => {
                    json!({"kind":"Unavailable","reason":reason})
                }
            },
            other => panic!("unknown verb {other}"),
        };
        observations.push(json!({"id":request["id"],"result":value,"calls":calls.into_inner()}));
    }
    println!("{}", serde_json::to_string(&observations).unwrap());
}
