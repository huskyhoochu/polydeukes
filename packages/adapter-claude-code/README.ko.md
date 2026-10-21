# `@polydeukes/adapter-claude-code`

[English](./README.md) · **한국어**

Claude Code의 이벤트를 약속(covenant) 입력 IR로 번역하는 모듈입니다. 설치된 `pdks`에 포함되며 프로젝트 연결은 다음 명령으로 수행합니다.

```sh
pdks adapter claude-code init
```

단일 실행 파일에는 세 어댑터와 Node 런타임이 포함됩니다. 별도 Node·npm·어댑터 설치 없이 사용할 수 있습니다. npm 배포본은 JavaScript 모듈 통합용입니다.

<a id="overview"></a>
## 개요

세 어댑터는 같은 세 함수를 제공합니다. 각 함수는 하나의 spec 객체를 받고 명명된 outcome을 반환합니다.

| 함수 | 역할 |
|---|---|
| `prepareHook` | 호스트 이벤트 번역과 사용 가능한 증거 수집 |
| `registerHook` | 프로젝트 훅 등록 병합 |
| `renderHookResponse` | 호스트의 허용·거부 응답 생성 |

공통 `pdks` 실행 경로가 현재 실행 파일로 `covenant check`를 호출합니다. 판정과 telemetry는 공통 판정기가 소유합니다. 어댑터는 실행 파일 탐색이나
판정을 수행하지 않습니다.

<a id="examples"></a>
## 예제

```ts
import { prepareHook } from '@polydeukes/adapter-claude-code';

const outcome = prepareHook({
  repoRoot: process.cwd(),
  rawPayload: JSON.stringify(event),
});
```

`event`는 호스트에서 받은 완전한 이벤트입니다. 번역 결과는 `check`·`recorded`·`unavailable` 중 하나이며, 이 호출은 도구를 실행하지 않습니다.

<a id="see-also"></a>
## 관련 문서

- [패키지 참조](../../docs/reference/packages/adapter-claude-code.ko.md)
