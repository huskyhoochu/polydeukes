from typing import assert_never

from polydeukes_sdk import (
    Blocked,
    CheckCovenantSpec,
    CheckCovenantVerdict,
    CovenantInput,
    Unjudged,
    Upheld,
    check_covenant,
)

payload: CovenantInput = {
    "toolCalls": [
        {
            "name": "fixture-edit",
            "fileChange": {"kind": "create", "path": "sample.txt", "post": "text"},
        }
    ],
    "subagentSpawns": [],
    "userMessages": [],
}


def execute_only_when_upheld(verdict: CheckCovenantVerdict) -> bool:
    match verdict:
        case Upheld():
            return True
        case Blocked() | Unjudged():
            return False
        case _:
            assert_never(verdict)


def consumer() -> bool:
    return execute_only_when_upheld(check_covenant(CheckCovenantSpec(repo_root=".", input=payload)))
