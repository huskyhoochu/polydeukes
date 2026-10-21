# `polydeukes-sdk` (Python)

[English](sdk-python.md) · **한국어**

`pdks covenant check`와 `pdks memory`를 호출하는 Python 3.12+ 동기 클라이언트입니다.
[설치와 네 동사 예시](../../../packages/sdk-python/README.ko.md)를 참고하세요.

<a id="contract"></a>
## 계약

동사는 keyword-only frozen dataclass spec 하나를 받아 동결된 결과 값을 반환합니다.
경로는 `str | os.PathLike[str]`를 받습니다. 생성된 `TypedDict` 입력은 CLI의 camelCase
전송 필드를 유지합니다. `py.typed`를 포함하며 런타임 의존성은 없습니다.

| 동사 | 필수 spec 필드 | 결과 |
| --- | --- | --- |
| `check_covenant(CheckCovenantSpec(...))` | `repo_root`, `input: CovenantInput` | `Upheld(advisories)`, `Blocked(reason)`, `Unjudged(reason)` |
| `check_change_set(CheckChangeSetSpec(...))` | `repo_root`, `diff: str` | 같은 `CheckCovenantVerdict` 합집합 |
| `memory_ingest(MemoryIngestSpec(...))` | `root` | `Ingested()` 또는 `Unavailable(reason)` |
| `memory_search(MemorySearchSpec(...))` | `root`, `query: str` | `Found(hits)`, `Empty()`, `Unavailable(reason)` |

모든 spec은 `executable=None`, `timeout=None`, `spawn=None`을 갖습니다. 약속(covenant)
spec은 `enforce='block'`, `config_layer=None`, `telemetry_path=None`도 갖습니다. 검색은
`limit=None`을 더하며, 지정한 limit은 양의 정수여야 합니다. `enforce`는 `'advise'` 또는
`'block'`입니다. 모든 결과 변종을 처리했는지 검사하려면 완전한 class pattern 분기 뒤에
`typing.assert_never`를 사용합니다. 동결은 얕으며 중첩 입력 사전은 호출자가 소유합니다.

<a id="execution"></a>
## 실행 파일과 프로세스

네 동사는 해석기와 실행기 하나를 사용합니다. 지정한 `executable`은 단순한 이름이어도
호출자 cwd 기준 파일 경로이며 symlink 표기를 보존합니다. 없으면 절대 `PATH` 디렉터리에서
처음 발견한 실행 가능한 일반 파일 `pdks`를 실행합니다. 비거나 상대적인 항목은 건너뜁니다.
선택한 실행 파일이 실패하면 실패 결과를 반환합니다.

자식 cwd는 호출자 cwd 기준으로 절대화한 `repo_root` 또는 `root`입니다. 설정과 텔레메트리
경로는 그대로 전달하며, 자식이 상대 값을 그 root 기준으로 해석합니다. SDK는 호출자의 IR을
UTF-8 JSON(`allow_nan=False`)으로, diff를 줄바꿈이 보존된 UTF-8 바이트로 보냅니다.
SDK가 자체 증거를 더하지 않습니다. query는 argv 한 항목입니다. 표준 스트림을 파이프로
연결하고 파일 디스크립터를 닫으며 셸이 명령을 평가하지 않습니다.

| 동사 | 실행 파일 뒤 인자 | stdin |
| --- | --- | --- |
| `check_covenant` | `covenant check --enforce <level>` | JSON |
| `check_change_set` | `covenant check --diff --enforce <level>` | 통합 diff |
| `memory_ingest` | `memory ingest` | 빈 바이트 |
| `memory_search` | `memory search <query> --json [--limit <n>]` | 빈 바이트 |

두 약속 동사는 지정한 `--config-layer`와 `--telemetry-path`를 덧붙입니다. diff는
`git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD`로 만듭니다.
추적하지 않는 파일은 먼저 `git add -N`이 필요합니다. SDK가 git을 실행하지 않습니다.

`timeout`은 유한한 0 이상의 초입니다. `0`은 즉시 기한이며 `None`은 기다립니다. 프로세스
생성 뒤 통신 중에 시작합니다. 기한을 넘기면 직접 자식을 죽이고 회수합니다. 후손은 계속
실행되며 Linux x64와 macOS arm64에서 상속한 파이프가 기한 반환을 늦추지 않습니다.
직렬화와 실행 파일 해석은 기한 앞입니다. 비동기 호출자는
`await asyncio.to_thread(check_covenant, spec)`를 사용합니다.

<a id="outcomes"></a>
## 결과

약속 종료 `0`은 `Upheld`, `2`는 `Blocked`이며 다른 status, 시그널, 해석·직렬화·실행·기한
실패는 `Unjudged`입니다. 자식 stderr를 `advisories` 또는 `reason`에 보존합니다. CLI 설정
실패도 종료 `2`에 포함됩니다. 결과 계약은 status를 따르며 실제 판정한 규율(discipline)은
텔레메트리로 식별합니다. `Unjudged`는 실행 허가가 아닙니다.

기억(memory)의 0 아닌 종료, 시그널, 실행 실패, 기한 초과는 `Unavailable`입니다. Ingest
종료 `0`은 `Ingested`입니다. 검색은 문자열 `ingestedAt`과 `results` 배열이 있는 유효한
UTF-8 JSON을 요구합니다. 각 hit의 필수 필드·타입과 `trust`/`matchPath` enum을 검사하고
추가 필드는 허용합니다. 유효한 빈 배열만 `Empty`입니다. `Found.hits`는 CLI 순서를 유지하는
비지 않은 tuple이며 hit 필드는 camelCase입니다. 없는 색인과 잘못된 응답은 `Unavailable`입니다.
검색은 절을 찾으며 의무 조회는 별도 CLI 명령입니다.

<a id="spawn"></a>
## Spawn 주입

선택적인 동기 함수는 `SpawnSpec(command: str, args: tuple[str, ...], cwd: str, stdin: bytes,
timeout: float | None)`을 받아 `SpawnOutcome(status: int | None, stdout: bytes, stderr: bytes)`를
반환합니다. `None` status는 시그널입니다. 주입 함수는 전달받은 기한을 직접 집행합니다.
일반 예외는 동사의 실패 결과로 바뀌며 `KeyboardInterrupt`와 `SystemExit`는 전파됩니다.

<a id="development"></a>
## 개발과 릴리스

저장소 루트에서 실행합니다.

```sh
uv sync --project packages/sdk-python --locked
uv run --project packages/sdk-python --locked python -m unittest discover -s packages/sdk-python/tests
uv run --project packages/sdk-python --locked python packages/sdk-python/scripts/generate_types.py --check
uv run --project packages/sdk-python --locked pyright --project packages/sdk-python/pyproject.toml
uv run --project packages/sdk-python --locked ruff check packages/sdk-python
uv build --project packages/sdk-python
```

타입은 core의 JSON 스키마 두 개와 고정한 개발 생성기로 결정적으로 생성합니다. wheel과 sdist는
런타임 의존성 없이 설치됩니다. 릴리스 자동화는 저장소와 함께 `project.version`을 올리고
태그·패키지 버전을 확인하며 Linux 실행 파일 artifact를 검사합니다. 실행 파일 빌드가 통과한
뒤 OIDC로 PyPI에 출판합니다. 재실행은 이미 출판된 버전을 건너뜁니다.

첫 릴리스 전에 소유자가 PyPI pending trusted publisher에 프로젝트 `polydeukes-sdk`, 소유자
`huskyhoochu`, 저장소 `polydeukes`, 워크플로 `publish.yml`, 환경 `pypi`를 등록하고 일치하는
GitHub 환경을 확인해야 합니다. 첫 릴리스의 선행 조건이며 저장소 배선만으로 외부 설정의
존재가 확인되지는 않습니다.

기존 릴리스 버전으로 Python만 출판할 때는 SDK가 들어 있는 커밋에 annotated
`sdk-python-v<version>` 태그를 만들고, 그 태그의 `publish.yml`을 `python_only=true`로
실행합니다. 다른 패키지의 소스와 manifest가 `v<version>`과 같은지 확인하고, 해당 릴리스의
Linux 실행 파일을 받아 digest를 대조한 뒤 같은 Python 배포물 검사와 PyPI 업로드를 수행합니다.
npm/crate와 실행 파일 릴리스 작업은 건너뜁니다. 일반 통합 릴리스는 `v<version>`과
`python_only=false`를 사용합니다.

<a id="sdk-contract"></a>
## 세 언어의 공통 계약

TS·Rust·Python SDK는 명시 실행 파일 → 절대 PATH의 pdks, 네 동사와 닫힌 결과,
기한의 같은 의미를 사용합니다. TS는 Promise와 밀리초, Rust는 동기 함수와 Duration,
Python은 동기 함수와 초를 사용합니다. 두 core schema가 전송 타입의 원본이며
언어별 생성 타입과 검색 응답 검증을 구분합니다.

저장소에서 `node scripts/verify-sdk-contract.mjs --executable <absolute-pdks>`를 실행하면
세 SDK가 같은 fixture를 관측한 결과·실제 판정·telemetry·검색 순서를 비교합니다.
[TS 계약](sdk-ts.ko.md)과 [Rust 계약](sdk-rust.ko.md)을 참고하세요.
