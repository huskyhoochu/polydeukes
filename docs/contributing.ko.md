# 문서에 기여하기

[English](./contributing.md) · **한국어**

`docs/`의 문서를 편집하고 유지하는 기준을 설명합니다. `pdks docs` 번들에는 포함하지 않습니다.
제품 동작은 안내와 참조 문서에서 설명하고, 여기서는 문서 관리 방법만 다룹니다.

<a id="bilingual-pairs"></a>
## 영어와 한국어를 쌍으로 유지합니다

`docs/` 아래의 마크다운 문서는 영어 파일과 한국어 번역본인 `.ko.md`가 한 쌍입니다.
두 파일을 함께 스테이징하세요. 한국어 어휘는 첫 언급에 번역과 영어 괄호 풀이(`약속(covenant)`)를 쓰고,
음차하지 않습니다. 검사만 통과하려고 내용 없는 한국어 파일을 만들지 말고, 쌍의 한쪽만
공개하지 마세요.

<a id="stable-ids"></a>
## 안정 절 ID

절 ID는 언어 쌍에서 같은 명시적 HTML 앵커입니다.

```md
<a id="section-id"></a>
## Heading
```

ID는 소문자 ASCII kebab-case입니다. `<a id>`는 제목 바로 앞 줄에 단독으로 둡니다.
따로 조회되는 H2/H3마다 안정 ID가 필요합니다. H1은 문서 제목이지 절이 아닙니다.
자동 헤딩 링크는 남겨도 됩니다. 옛 제목을 바꿀 때는 이전 슬러그 또는 명시적 id를
유지하세요.

<a id="catalog"></a>
## 카탈로그, 번들, 리다이렉트

`docs/catalog.json`이 유일한 목록입니다. `docs/` 아래 마크다운은 `documents` 항목입니다.

- `documents` 항목은 `id`, `category`, `order`, `bundled`, 그리고 `en`/`ko`의
  `{path,title,summary}`를 가집니다. 제목과 요약은 카탈로그에 두어 마크다운은 본문만
  남깁니다.
- `bundled: true` 파일은 설치된 `pdks docs` 라이브러리로 복사됩니다. `bundled: false`
  파일은 저장소와 문서 웹사이트에 표시되며 `pdks docs` 검색·조회 대상에서는 제외됩니다. 이 페이지와
  날짜별 개발 기록이 `bundled: false`입니다.

`docs/*.md` 파일을 추가할 때는 카탈로그에도 등록하세요.

<a id="website"></a>
## 문서 웹사이트

`packages/documentation`은 `bundled: false`를 포함한 모든 카탈로그 항목으로 웹사이트를 만듭니다.
`sync-docs.mjs`가 gitignore 대상인 `src/content/docs/`와 `src/generated/sidebar.json`을 생성합니다.
편집은 `docs/`의 원본에서 하세요. 생성 파일은 다음 빌드에서 교체됩니다.

동기화 과정은 문서 제목과 언어 전환 줄을 제거하고 카탈로그 메타데이터를 frontmatter에 넣은 뒤,
마크다운 링크를 사이트 경로로 바꿉니다. 영어 페이지는 `/docs/`, 한국어 페이지는 `/ko/docs/`를
사용합니다. `.ko.md` 링크는 한국어로, `.md` 링크는 영어로 연결됩니다. `docs/` 밖을 가리키는
링크는 GitHub으로 연결하며, 안정 절 ID와 버전 파일명의 점은 유지합니다.

`pnpm -F @polydeukes/documentation build`는 동기화와 Astro 빌드를 실행합니다.
Vercel도 이 명령으로 빌드한 `packages/documentation/dist`를 배포합니다.
변환 코드를 바꾼 뒤에는 두 언어의 렌더된 페이지를 확인하세요.

<a id="examples-and-checks"></a>
## 예제와 검사 명령

복사해 쓸 예제는 독자가 자기 프로젝트에서 실행할 수 있는 경로와 패턴으로 작성합니다.
이 저장소에서 실제 사용하는 설정을 인용할 때는 그 사실을 본문에 밝힙니다.

새 선언은 이 저장소의 보호 파일을 위반하지 말고 격리된 예제 프로젝트에서 실행합니다.
파일 예제는 `git diff HEAD | pdks covenant check --diff`, 세션 쓰기는
[첫 판정 튜토리얼](./tutorials/first-judgment.ko.md)의 훅 프로브를 씁니다.

TypeScript 예제에서는 패키지 계약이 공개하는 심볼만 가져옵니다. 우산은 TypeScript
진입점을 공개하지 않고 `pdks` 실행 파일로만 닿으므로, 그 심볼은 `@polydeukes/core`나
에이전트 어댑터에서 옵니다.

문서 변경을 커밋하기 전에 다음을 실행합니다.

```sh
node scripts/check-docs.mjs
```

검사기는 영어와 한국어 파일이 쌍을 이루고 카탈로그에 등록돼 있는지 확인합니다.
로컬 마크다운 링크는 실제 파일을 가리켜야 하며, 절을 지정한 링크라면 해당 제목의 슬러그나
명시적 ID도 존재해야 합니다.

<a id="historical-records"></a>
## 개발 기록

`docs/build-in-public/` 파일은 날짜가 있는 개발 기록입니다. 당시의 사건, 수치, 인용,
어휘를 유지합니다. 이동 안내로 축약하지 않습니다. 게시 당시에 맞았던 용어를 고쳐 쓰지
않습니다.

<a id="check-commands"></a>
## 실행할 명령

| 명령 | 확인하는 것 |
|---|---|
| `node scripts/check-docs.mjs` | 쌍, 카탈로그, 로컬 링크와 앵커 |
| `pnpm -F polydeukes exec vitest run __tests__/check-docs.test.ts` | 검사기 회귀 |
| `pdks docs search <query>` / `pdks docs show <id>` | `docs/`를 복사하는 빌드 뒤의 설치 번들 |
| `pnpm -F polydeukes exec vitest run __tests__/declaration-reference.test.ts __tests__/sync-docs.test.ts` | 전체 어휘 표와 웹사이트 변환 |
| `pnpm -F @polydeukes/documentation build` | 생성 문서, 경로, 정적 웹사이트 빌드 |
