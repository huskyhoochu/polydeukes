# `@polydeukes/adapter-git`

[English](./README.md) · **한국어**

이 어댑터는 Git 스테이징 영역의 관측을 약속(covenant) 입력 IR로 변환합니다.
Git 어댑터 설정 검증기와 관측 자료를 읽는 함수도 제공합니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `collectStagedChanges`
- `collectWorktreeChanges`
- `collectRangeChanges`
- `observationSourceReader`
- `resolveGitAdapterSettings`
- `covenantInputFromStagedChanges`
- `STAGED_WRITE`
- `STAGED_DELETE`

<a id="examples"></a>
## 예제

```ts
import { collectStagedChanges, resolveGitAdapterSettings } from '@polydeukes/adapter-git';

const settings = resolveGitAdapterSettings({ namespace: { enforce: 'advise' } });
const staged = collectStagedChanges({ repoRoot: process.cwd() });
```

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/adapter-git` 패키지 레퍼런스](../../docs/reference/packages/adapter-git.ko.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.ko.md)
- [`설정 레퍼런스`](../../docs/reference/configuration/index.ko.md#adapters-git)
