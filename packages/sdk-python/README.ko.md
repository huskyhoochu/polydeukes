# `polydeukes-sdk` (Python)

[English](README.md) · **한국어**

Python 3.12 이상에서 Polydeukes 판정기와 기억(memory) 명령을 호출합니다. 동기 동사 네 개가
실행 파일 해석기와 프로세스 실행기 하나를 공유합니다. 런타임 의존성은 없습니다.

```sh
python -m pip install polydeukes-sdk
```

[GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)에서 `pdks-linux-x64` 또는
`pdks-darwin-arm64`를 받아 실행 권한을 부여하고, 절대 `PATH` 디렉터리에 `pdks`라는 이름으로
두거나 `executable`에 경로를 지정합니다. SDK와 실행 파일의 minor 버전을 맞춥니다. 지원 플랫폼은
Linux x64와 macOS arm64입니다. macOS에서 브라우저로 받았다면
`xattr -d com.apple.quarantine /path/to/pdks`가 필요할 수 있습니다.

```python
from polydeukes_sdk import (
    CheckCovenantSpec,
    CovenantInput,
    Upheld,
    check_covenant,
    CheckChangeSetSpec,
    check_change_set,
    MemoryIngestSpec,
    memory_ingest,
    MemorySearchSpec,
    memory_search,
    Found,
    Empty,
    Unavailable,
)

payload: CovenantInput = {"toolCalls": [], "subagentSpawns": [], "userMessages": []}
verdict = check_covenant(CheckCovenantSpec(repo_root=".", input=payload, timeout=10))
if isinstance(verdict, Upheld):
    print("제안한 작업을 진행할 수 있습니다", verdict.advisories)

verdict = check_change_set(CheckChangeSetSpec(repo_root=".", diff="", timeout=10))
ingest = memory_ingest(MemoryIngestSpec(root=".", timeout=30))
recall = memory_search(MemorySearchSpec(root=".", query="설계 결정", limit=5, timeout=10))
match recall:
    case Found(hits=hits):
        print(hits[0]["sectionTitle"])
    case Empty():
        print("검색 결과 없음")
    case Unavailable(reason=reason):
        print("기억을 사용할 수 없음:", reason)
```

호스트는 IR 증거를 제공하고 제안한 작업의 실행 여부를 결정합니다. 이 예시는 `Upheld`일 때만
실행을 허용합니다. 자식 프로세스가 설정을 읽고 규율(discipline)을 판정하며 텔레메트리와 기억
색인을 관리합니다.

[Python SDK 참조](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-python.ko.md)에서
모든 spec, 결과, 기한과 주입 가능한 `spawn` 경계를 설명합니다.
