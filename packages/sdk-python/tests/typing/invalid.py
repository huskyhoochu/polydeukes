from typing import assert_never

from polydeukes_sdk import Blocked, CheckCovenantVerdict, CovenantInput, Upheld

wrong_kind: CovenantInput = {
    "toolCalls": [
        {
            "name": "fixture-edit",
            "fileChange": {"kind": "rewrite", "path": "sample.txt", "post": "text"},
        }
    ],
    "subagentSpawns": [],
    "userMessages": [],
}
missing_post: CovenantInput = {
    "toolCalls": [{"name": "fixture-edit", "fileChange": {"kind": "create", "path": "sample.txt"}}],
    "subagentSpawns": [],
    "userMessages": [],
}


def incomplete(verdict: CheckCovenantVerdict) -> bool:
    match verdict:
        case Upheld():
            return True
        case Blocked():
            return False
        case _:
            assert_never(verdict)
