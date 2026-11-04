# 프로젝트 기억 사용하기

[English](./use-memory.md) · **한국어**

기억(memory)은 프로젝트의 마크다운에서 결정과 근거를 찾습니다. 문서를 수정하면 다음 질의가 그 내용을
읽습니다. 판정 규율과 별도로 시작할 수 있으며, 먼저
[기억 확장을
설치](./install.ko.md)하세요.

<a id="configure"></a>
## 문서 모음 설정

새 예제 디렉터리에서 실행합니다. 기존 프로젝트라면 현재 설정에 `memory`만 합칩니다. 설정 파일은
세션에서 보호되므로 이 편집은 소유자 터미널에서 합니다.


```sh
mkdir pdks-memory-example
cd pdks-memory-example
mkdir notes
cat > polydeukes.config.yaml <<'YAML'
memory:
  include: ["notes/**/*.md"]
YAML
```

<a id="write"></a>
## 결정 기록

제목과 H2 절은 검색 결과의 위치가 됩니다. 안정적인 절 식별자를 두면 나중에도 같은 근거를 열 수
있습니다.

```sh
cat > notes/storage.md <<'MARKDOWN'
---
title: Storage decision
type: adr
---
# Storage decision

## Local files {#local-files}

We store project decisions in Markdown so they can be reviewed with code.
MARKDOWN
```

<a id="retrieve"></a>
## 찾고 원문 읽기

`search` 결과에서 `notes/storage#local-files`를 찾고 `show`로 원문을 엽니다. 검색은 답을 생성하지
않습니다.

```sh
pdks memory search Markdown
pdks memory show notes/storage#local-files
pdks memory stats
pdks memory lint
```

<a id="maintain"></a>
## 작업 과정에서 사용하기

작업 전에는 검색 결과를 열어 이전 결정의 전제를 확인합니다. 작업 후에는 바뀐 결정과 실행한 검증을
마크다운에 기록하고 관련 문서를 상대 링크로 연결합니다. `lint`가 exit 1이면 출력의 문서 식별자와
링크를 고칩니다. 검색 결과가 없으면 `memory.include`가 파일에 맞는지, 질의의 낱말이 본문에 있는지
확인하세요.

문서의 `type`, `status`, 출처와 검증 정보는 결과 해석을 돕습니다. `unverified`는 사람의 검증 정보가
없다는 뜻이며 내용의 거짓을 뜻하지 않습니다. 교체된 결정은 `supersession`으로 추적하고, 프로젝트가
정한 미완료 항목은 `obligations` 추출 설정으로 조회합니다. 두 기능의 설정은
[설정
참조](../reference/configuration/index.ko.md#memory)에
있습니다.

`search`, `show`, `obligations` 사용은 `.polydeukes/memory-log.jsonl`에 남습니다.
`pdks memory usage`로 자주 찾은 문서와 검색 실패 후보를 확인하세요. 문서는 Git으로 공유할 수 있지만
이 로컬 사용 이력은 문서에서 복구할 수 없으므로 필요한 경우 별도로 보관합니다.

명령별 JSON 형식과 종료 코드는 [CLI 참조](../reference/cli/memory.ko.md)를, 프로그램 호출은
[SDK
참조](../README.ko.md#reference-packages)를
읽으세요.
