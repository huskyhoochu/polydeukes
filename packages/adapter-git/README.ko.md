# @polydeukes/adapter-git

**한국어** · [English](./README.md)

> git의 어휘가 번역되어 사라지는 경계입니다. `staged diff`는 커밋 시점에 에이전트 중립적인 약속(covenant) 입력 IR로 바뀝니다. AI든 인간이든 어느 손이 만든 편집이든 같은 판정을 받습니다.

**pre-alpha 단계입니다.** npm에는 아직 공개되지 않았습니다. 이 패키지는 제2 어댑터이고, 그 존재 자체가 IR 중립성의 증명입니다. Claude Code 어댑터가 가상 적용으로 채우는 것과 같은 `fileChanges` 증거를 git blob에서 채우는데, 코어는 한 줄의 수정 없이 둘 다 소비했습니다.

## 여기 담긴 것

- **스테이징 변경 수집.** `collectStagedChanges(repoRoot)`가 `--no-renames`를 강제해 스테이징 영역을 읽습니다. 이름 바꾸기(rename)는 삭제 하나와 추가 하나로 갈라 판정합니다. 보호 파일을 `git mv`로 옮기는 일이 불투명한 rename 엔트리 하나로 빠져나가면 안 되기 때문입니다. `pre`는 HEAD의 blob에서, `post`는 인덱스에 담긴 blob에서 옵니다. `git add` 뒤에 달라졌을 수 있는 워크트리는 결코 읽지 않습니다. 바이너리 blob(NUL 휴리스틱)은 깨진 디코드 결과 대신 null 내용을 내고, HEAD가 없는 첫 커밋은 예외 대신 전부 추가로 좁혀 판정합니다.
- **순수 번역.** `covenantInputFromStagedChanges(changes)`가 수집한 변경을 하나의 `CovenantInput`으로 접습니다. 변경마다 어댑터 소유 이름(`staged-write`/`staged-delete`)의 도구 호출이 하나씩 실리고, 쓰기에는 `fileChanges`의 pre/post 쌍이 붙습니다. 삭제는 post 내용이 없으므로 원소를 생략하되 도구 호출은 남깁니다. 커밋 표면에는 세션이 없으니 세션 컬렉션 두 개는 정직하게 빈 배열이고, 키를 날조하지 않습니다.
- **이것뿐인 이유.** 이 패키지는 순수 라이브러리입니다. `staged diff`라는 페이로드 형식만 알고, 설치·훅 러너·밸브는 모릅니다. umbrella의 `pdks covenant check`가 이것을 pre-commit 표면으로 조립하고, 훅 러너에 거는 일은 이 모듈 밖의 배포 행위입니다.

아키텍처 청사진과 설계 근거는 [프로젝트 저장소](https://github.com/huskyhoochu/polydeukes)에 있습니다.

## 라이선스

MIT
