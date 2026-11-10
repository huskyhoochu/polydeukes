# pdks

[English](./polydeukes.md) · **한국어**

<a id="polydeukes-entry-points"></a>
## 실행 파일

Rust `pdks`는 약속(covenant) 판정기입니다. Homebrew·crates.io·npm·PyPI는 같은 실행 파일을
배포합니다. npm의 패키지 이름은 `polydeukes`이며 소비자는 `pdks` 명령을 실행합니다.
[설치 안내](../../how-to/install.ko.md)를 참고하세요.

<a id="polydeukes-bin"></a>
## 명령

| Command                      | Purpose                 |
| ---------------------------- | ----------------------- |
| `pdks init`                  | Project configuration   |
| `pdks explain`               | Assembled registrations |
| `pdks covenant check`        | Input IR on stdin       |
| `pdks covenant check --diff` | Unified diff on stdin   |
| `pdks docs`                  | Embedded documentation  |
| `pdks --version`             | Executable version      |

각 명령의 [참조](../../README.ko.md#reference-cli)에서 인자·종료 코드를 확인합니다.

<a id="surface-from-input-mode"></a>
## 입력과 표면

IR 입력은 세션 표면이며 `disciplines`의 모든 항목을 컴파일한 다음 `sessionDisciplines`를
컴파일합니다. `changes`를 읽는 항목은 범위 안의 파일 변경에 대해 판정하는 대신 `skipped`로
기록합니다. 그 항목의 컴파일 오류는 두 표면 모두에서 로드 오류입니다. `--diff` 입력은 변경 집합
표면이며 결과 검증을 위해 `disciplines`만 컴파일합니다. `sessionDisciplines`는 세션 표면에만 과정과
사람의 증거를 제공합니다. IR의 session 필드는 표면을 선택하지 않고 관측한 이력을 전달합니다. 파일
도구와 diff가 제공하는 내용 범위는 다릅니다. [판정 모델](../../concepts/judgment.ko.md)을 읽으세요.

<a id="extensions"></a>
## 확장 실행

`pdks <name> [args...]`는 PATH에서 `pdks-<name>`을 찾아 인자를 전달하고 표준 입출력·오류를
상속합니다. 이름은 ASCII 문자·숫자·밑줄·하이픈으로 구성하며 하이픈으로 시작하지 않습니다. 내장
명령은 확장으로 대체하지 않습니다. `pdks memory search ...`, `pdks claude-code init`,
`pdks codex init`을 사용할 수 있습니다. 확장이 없으면 설치 안내와 오류를 반환합니다.

<a id="covenant-module"></a>
## 판정과 관측 범위

판정은 선언과 제공된 증거를 비교합니다. 파일 경로 보호, 셸의 보호 경로 언급, 대화 기록 보호는
세션에서 차단할 수 있습니다. 셸의 읽기 전용 명령이라도 보호 경로를 언급하면 차단될 수 있습니다. 내용
증거를 제공하지 못한 셸 쓰기는 내용 규율에서 no-observation으로 건너뜁니다. 완료된 변경은 diff로
다시 검사하세요.

<a id="ownership"></a>
## 조립과 기록

명령의 조립 단계는 설정과 선언이 이름 붙인 파일을 읽고 판정기에 증거를 공급합니다. 텔레메트리는
`.polydeukes/roi.log`에 기록합니다. 조립 오류, 위반, 건너뛴 관측은 서로 다릅니다.
[문제 해결](../../troubleshooting.ko.md#reading-verdict)에서 결과를 해석하세요.

<a id="schema-export"></a>
## 스키마와 프로그램 연동

저장소의 `schema/`에 설정·선언·입력 IR·기억 검색 스키마가 있습니다. TypeScript·Rust·Python SDK는
프로세스 호출과 결과 처리를 제공합니다.
[입력
계약](./core.ko.md)에서
시작하세요.
