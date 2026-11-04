# `polydeukes-sdk` (Python)

[English](README.md) · **한국어**

Python 3.12 이상에서 Polydeukes 판정기와 기억(memory) 명령을 호출합니다. 동기 동사 세 개가 실행 파일
해석기와 프로세스 실행기 하나를 공유합니다. 런타임 의존성은 없습니다.

```sh
python -m pip install polydeukes-sdk
```

[GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)에서
`pdks-<target>-v<version>.tar.gz`를 받아 압축을 풀고 실행 파일에 실행 권한을 부여한 뒤, 절대 `PATH`
디렉터리에 `pdks`라는 이름으로 두거나 `executable`에 경로를 지정합니다. SDK와 실행 파일의 minor
버전을 맞춥니다. 미리 빌드한 실행 파일의 대상은 Linux x64·arm64와 macOS arm64입니다. macOS에서
브라우저로 받았다면 `xattr -d com.apple.quarantine /path/to/pdks`가 필요할 수 있습니다.

예제는 설정이 있는 프로젝트 루트에서 실행합니다. 새 예제 프로젝트라면 먼저 `pdks init`을 실행하세요.
기억 예제를 실행하려면 [기억 사용 안내](../../docs/how-to/use-memory.ko.md)에 따라 확장과 문서
모음도 준비합니다. 판정 불가나 검색 불가를 성공으로 처리하지 마세요.

```python
from polydeukes_sdk import (
    CheckCovenantSpec,
    CovenantInput,
    Upheld,
    check_covenant,
    CheckChangeSetSpec,
    check_change_set,
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
recall = memory_search(MemorySearchSpec(root=".", query="설계 결정", limit=5, timeout=10))
match recall:
    case Found(hits=hits):
        print(hits[0]["sectionTitle"])
    case Empty():
        print("검색 결과 없음")
    case Unavailable(reason=reason):
        print("기억을 사용할 수 없음:", reason)
```

호스트는 IR 증거를 제공하고 제안한 작업의 실행 여부를 결정합니다. 이 예시는 `Upheld`일 때만 실행을
허용합니다. 자식 프로세스가 설정을 읽고 규율(discipline)을 판정하며 텔레메트리와 기억 검색을
관리합니다.

기억 검색은 `pdks memory ...`를 통해 SDK 프로세스의 `PATH`에 있는 `pdks-memory`를 실행합니다.
[설치 안내](../../docs/how-to/install.ko.md)에 따라 확장을 설치하고, 로컬 npm 설치라면 SDK를
실행하기 전에 프로젝트의 `node_modules/.bin` 절대 경로를 `PATH`에 추가하세요. 실행 파일이 없으면
`pdks`가 출력한 이유와 함께 `Unavailable`을 반환합니다.

[Python SDK
참조](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-python.ko.md)에서
모든 spec, 결과, 기한과 주입 가능한 `spawn` 경계를 설명합니다.

[전체 설치 안내](../../docs/how-to/install.ko.md) · [기억 사용](../../docs/how-to/use-memory.ko.md)
·
[이행
안내](../../docs/how-to/migrate-to-rust.ko.md)
