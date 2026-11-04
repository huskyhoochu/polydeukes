# 프로젝트 설정하기

[English](./configure-project.md) · **한국어**

프로젝트 루트에 설정 파일 하나를 두고, 위반이 생겼을 때 작업을 계속할지 차단할지 선택합니다. 아직
설치하지 않았다면
[첫 판정 따라
하기](../tutorials/first-judgment.ko.md)부터
시작하세요.

<a id="find-the-config"></a>
## 설정 파일 찾기

Polydeukes는 프로젝트 루트 바로 아래에서 `polydeukes.config.yaml`, `polydeukes.config.yml`,
`polydeukes.config.json` 중 하나를 읽습니다. 상위 디렉터리까지 찾아 올라가지는 않습니다.

- 파일이 없으면 설정이 필요한 명령은 실패합니다. 기본값으로 대신 실행하지 않습니다.
- 파일이 여러 개면 필요한 내용을 합친 뒤 하나만 남깁니다.
- 발견한 설정 파일은 자동으로 `protectedPaths`에 포함됩니다. 설정 자체를 바꾸는 작업도 보호
  대상입니다.

`pdks docs`는 프로젝트 설정 없이 사용할 수 있습니다. 필드별 제약은
[설정 참조](../reference/configuration/index.ko.md)에서 확인하세요.

<a id="add-ide-support"></a>
## 편집기 스키마 연결

사용하는 릴리스와 같은 저장소의 [설정 스키마](../../schema/polydeukes.schema.json)를 편집기에
연결합니다. 스키마 파일을 프로젝트에 복사했다면 그 위치를 설정 파일 기준 상대 경로로 적습니다.

```yaml
# yaml-language-server: $schema=./schema/polydeukes.schema.json
```

이 예제는 `schema/polydeukes.schema.json`을 복사한 경우입니다. `pdks init`은 스키마 파일이나 이
주석을 설치하지 않습니다. 편집기에서 경로가 해소되는지 확인하고 `pdks explain`으로 실제 판정기의
설정 검증도 실행하세요. JSON 설정의 `$schema`는 판정에 사용하지 않습니다.

<a id="choose-advise-or-block"></a>
## 권고와 차단 중 선택하기

| 설정                                     | 위반 시 동작                                          |
| ---------------------------------------- | ----------------------------------------------------- |
| 항목의 `enforce: advise`(또는 적지 않음) | 권고를 기록하고 호출을 진행합니다. 종료 코드 0입니다. |
| 항목의 `enforce: block`                  | 판정한 호출을 거부합니다. 종료 코드 2입니다.          |

**적지 않으면 `advise`입니다.** 설정에는 표면 단위의 강제 수준 키가 없습니다. 강제 수준은 각 항목이
가지며 적지 않은 항목을 승격하는 설정도 없습니다. 설정된 경로의 보호는 이 항목별 기본값과
별개입니다. 세션 표면에서는 차단하고, 변경 집합 표면에서는 명령을 `--enforce block`으로 실행하지
않는 한 `advised`로 기록합니다. 조립 단계에서 오류가 나면 종료 코드 2를 반환합니다.

`protectedPaths`는 두 표면에 모두 적용하는 최상위 목록 하나입니다. 변경 집합 표면에서 판정기는 종료
코드만 내므로, 커밋을 멈출지는 훅 배선이 정합니다.
[표면
연결과 증인](./connect-surfaces.ko.md#witness-and-recovery)에서
자세히 설명합니다.

<a id="confirm-the-project"></a>
## 설정 확인하기

- `pdks explain`은 설정을 읽고 등록된 항목을 보여 줍니다. 변경을 판정하지는 않습니다.
- `git diff HEAD | pdks covenant check --diff`는 아직 커밋하지 않은 변경 전부를 판정합니다.
- `git diff --cached | pdks covenant check --diff`는 스테이징한 변경을 관측합니다. pre-commit 훅이
  쓰는 형태입니다. 이 명령은 사람에게 묻지 않고 종료 코드 0, 2, 3(입력을 읽지 못함) 중 하나만 내며,
  커밋을 멈출지는 훅 배선이 정합니다.

종료 코드와 함께 stderr와 텔레메트리도 확인하세요. 권고나 일부 미판정도 종료 코드 0을 반환합니다.
조립에 실패했다면 규율을 시험하기 전에 오류가 지목한 설정이나 빠진 패키지부터 확인하세요.
