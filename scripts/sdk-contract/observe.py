"""Observe the Python SDK through the same request corpus as TS and Rust."""

import json
import sys

import polydeukes_sdk as sdk

observations = []
with open(sys.argv[1], encoding="utf-8") as request_file:
    requests = json.load(request_file)
for request in requests:
    calls = []
    options = {
        "executable": request.get("executable"),
        "timeout": request.get("timeoutMs", 0) / 1000
        if "timeoutMs" in request
        else None,
    }
    if "response" in request:

        def spawn(call, calls=calls, request=request):
            calls.append(
                {
                    "args": list(call.args),
                    "stdin": call.stdin.decode(),
                    "timeoutMs": call.timeout * 1000
                    if call.timeout is not None
                    else None,
                }
            )
            response = request["response"]
            if response.get("error"):
                raise (
                    TimeoutError("timeout")
                    if response["error"] == "timeout"
                    else OSError(response["error"])
                )
            return sdk.SpawnOutcome(
                status=response["status"],
                stdout=bytes(response["stdoutBytes"])
                if "stdoutBytes" in response
                else response.get("stdout", "").encode(),
                stderr=response.get("stderr", "").encode(),
            )

        options["spawn"] = spawn
    verb = request["verb"]
    if verb.startswith("check"):
        options.update(repo_root=request["root"])
        for source, target in (
            ("enforce", "enforce"),
            ("configLayer", "config_layer"),
            ("telemetryPath", "telemetry_path"),
        ):
            if source in request:
                options[target] = request[source]
        if verb == "check_covenant":
            spec = sdk.CheckCovenantSpec(input=request["input"], **options)
        else:
            spec = sdk.CheckChangeSetSpec(diff=request["diff"], **options)
    elif verb == "memory_ingest":
        spec = sdk.MemoryIngestSpec(root=request["root"], **options)
    else:
        spec = sdk.MemorySearchSpec(
            root=request["root"],
            query=request["query"],
            limit=request.get("limit"),
            **options,
        )
    result = getattr(sdk, verb)(spec)
    value = {"kind": type(result).__name__}
    for field in ("reason", "advisories", "hits"):
        if hasattr(result, field):
            value[field] = getattr(result, field)
    observations.append({"id": request["id"], "result": value, "calls": calls})
print(json.dumps(observations, ensure_ascii=False))
