# 프로젝트 설정하기

[English](./configure-project.md) · **한국어**

프로젝트 루트에 설정 파일 하나를 두고, 제품 소스의 범위와 검증 명령을 정합니다.
위반이 생겼을 때 작업을 계속할지 차단할지도 선택합니다. 아직 설치하지 않았다면
[첫 판정 따라 하기](../tutorials/first-judgment.ko.md)부터 시작하세요.

<a id="find-the-config"></a>
## 설정 파일 찾기

Polydeukes는 프로젝트 루트 바로 아래에서 `polydeukes.config.yaml`, `polydeukes.config.yml`,
`polydeukes.config.json` 중 하나를 읽습니다. 상위 디렉터리까지 찾아 올라가지는 않습니다.

- 파일이 없으면 설정이 필요한 명령은 실패합니다. 기본값으로 대신 실행하지 않습니다.
- 파일이 여러 개면 필요한 내용을 합친 뒤 하나만 남깁니다.
- 발견한 설정 파일은 자동으로 `protectedPaths`에 포함됩니다. 설정 자체를 바꾸는 작업도
  보호 대상입니다.

`pdks docs`는 프로젝트 설정 없이 사용할 수 있습니다. 필드별 제약은
[설정 참조](../reference/configuration/index.ko.md)에서 확인하세요.

<a id="add-ide-support"></a>
## 편집기에서 스키마로 검사하기

YAML 파일에는 다음 줄을 넣어 설치된 스키마를 편집기에서 사용합니다.

```yaml
# yaml-language-server: $schema=node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

이 경로는 설정 파일을 기준으로 한 상대 경로이지 모듈 이름이 아닙니다. 설정 파일이 모노레포
하위 패키지에 있고 의존성은 워크스페이스 루트에 설치된 경우, 올라가는 층수를 직접 셉니다.

```yaml
# yaml-language-server: $schema=../../node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

`pdks init claude-code`는 생성한 설정 파일을 기준으로 기본 경로의 스키마를 찾을 수 있을 때만
스키마 줄을 넣습니다. 이 줄이 없다면 스키마 위치에 맞춰 상대 경로를 직접 추가하세요.
`$schema` 경로를 찾지 못하면 편집기에 오류가 표시되지 않은 채 스키마 검증이 중단될 수 있습니다.

우산이 아니라 `@polydeukes/core`를 직접 설치했다면 그 사본을 가리킵니다.

```yaml
# yaml-language-server: $schema=node_modules/@polydeukes/core/schema/polydeukes.schema.json
```

편집기가 정적으로 읽는 파일 경로입니다. 런타임에 스키마를 읽는 코드는 exports 서브패스
`@polydeukes/core/schema.json`을 씁니다. JSON 설정에는 `$schema` 속성을 쓸 수 있습니다.
로더는 이 속성을 허용하되 실제 사용할 설정에서는 제외합니다.

<a id="fill-the-language-block"></a>
## 언어 블록 채우기

`languages`에는 항목이 하나 이상 있어야 합니다. 각 항목에 제품 소스의 경로와 검증 명령을
적습니다.

```yaml
languages:
  typescript:
    productionGlob: 'src/**'
    testCmd: 'pnpm test'
```

언어 이름은 프로젝트에서 정하는 키입니다. 설치기가 만든 임시 값을 실제 경로와 명령으로
바꾸세요. 블록을 지우거나 비워 두면 유효하지 않은 설정이 됩니다. 이 설정을 읽는 것만으로
검증 명령이 실행되지는 않습니다.

<a id="choose-advise-or-block"></a>
## 권고와 차단 중 선택하기

| 설정 | 위반 시 동작 |
|---|---|
| `adapters.git.enforce: advise` | 권고를 기록하고 커밋을 계속합니다. 증인 입력은 요청하지 않습니다. |
| `adapters.git.enforce: block` | 차단 판정을 받은 작업을 거부합니다. 스테이징 검사에서는 TTY로 증인 입력을 받을 수 있습니다. |

일반 규율(discipline) 항목에도 자체 강제 수준이 있으며 기본값은 `advise`입니다.
**두 수준 중 더 관대한 쪽을 따릅니다.** 어댑터만 `block`으로 설정해도 일반 항목이 자동으로
차단 수준으로 바뀌지는 않습니다. 설정된 경로의 보호는 이 항목별 기본값과 별개입니다.
조립 단계에서 오류가 나면 어느 수준에서든 종료 코드 2를 반환합니다.

최상위 `protectedPaths`는 두 표면에 모두 적용합니다. `adapters.git.protectedPaths`에는
커밋할 때만 보호할 경로를 추가합니다. 세션 중에는 편집을 허용하되 커밋할 때 보호하려는
파일에 사용하세요. [표면 연결과 증인](./connect-surfaces.ko.md#witness-and-recovery)에서
자세히 설명합니다.

<a id="confirm-the-project"></a>
## 설정 확인하기

- `pdks explain`은 설정을 읽고 등록된 항목을 보여 줍니다. 변경을 판정하지는 않습니다.
- `pdks covenant check --worktree`는 HEAD와 디스크를 비교합니다. 아직 Git에 등록하지 않은
  파일도 무시 대상이 아니면 포함합니다.
- `pdks covenant check`는 스테이징한 변경을 관측합니다. 차단 결과가 나고 TTY를 사용할 수
  있을 때 증인 입력을 요청할 수 있습니다. 어댑터가 `block`이라는 이유만으로 묻지는 않습니다.

종료 코드와 함께 stderr와 텔레메트리도 확인하세요. 권고나 일부 미판정도 종료 코드 0을
반환합니다. 조립에 실패했다면 규율을 시험하기 전에 오류가 지목한 설정이나 빠진 패키지부터
확인하세요.
