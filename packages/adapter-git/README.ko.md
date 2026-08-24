# @polydeukes/adapter-git

**한국어** · [English](./README.md)

> git의 어휘가 번역되어 사라지는 경계입니다. `staged diff`는 커밋 시점에 에이전트 중립적인 약속(covenant) 입력 IR로 바뀝니다. AI든 인간이든 어느
> 손이 만든 편집이든 같은 판정을 받습니다.

**알파(alpha) 단계입니다.** 이 패키지는 제2 어댑터이고, 그 존재 자체가 IR 중립성의 증명입니다. Claude Code 어댑터가 가상 적용으로 채우는 것과 같은 호출별
`fileChange` 증거를 git blob에서 채우는데, 코어는 한 줄의 수정 없이 둘 다 소비했습니다.

## 여기 담긴 것

- **변경 수집, 관측 셋.** `collectStagedChanges(repoRoot)`는 스테이징 영역을, `collectWorktreeChanges(repoRoot)`는
  작업 트리를(`post`는 디스크, 미추적·무시되지 않은 파일은 `added`), `collectRangeChanges(repoRoot, '<base>..<head>')`는 두
  ref를 읽습니다(`...`는 base를 merge-base로 해소). 셋 다 같은 형태를 돌려주고 `--no-renames`를 강제합니다. 이름 바꾸기(rename)는 삭제
  하나와 추가 하나로 나눠 판정합니다. 보호 파일을 `git mv`로 옮기는 일이 불투명한 rename 엔트리 하나로 빠져나가면 안 되기 때문입니다. `pre`는 HEAD의
  blob에서, `post`는 인덱스에 담긴 blob에서 옵니다. `git add` 뒤에 달라졌을 수 있는 워크트리는 결코 읽지 않습니다. 바이너리 blob(NUL 휴리스틱)은
  깨진 디코드 결과 대신 null 내용을 내고, HEAD가 없는 첫 커밋은 예외 대신 전부 추가로 좁혀 판정합니다.
- **순수 번역.** `covenantInputFromStagedChanges(changes)`가 수집한 변경을 하나의 `CovenantInput`으로 접습니다. 변경마다 어댑터
  소유 이름(`staged-write`/`staged-delete`)의 도구 호출이 하나씩 실리고, 각 호출은 자기 판별 유니온(discriminated union)
  증거(`fileChange`, `create`/`modify`/`delete`)를 싣습니다. 삭제도 1급 증거이며, HEAD blob이 바이너리일 때만 선택 `pre` 기준선이
  빠집니다. 커밋 표면에는 세션이 없으니 세션 컬렉션 두 개는 정직하게 빈 배열이고, 키를 날조하지 않습니다.
- **어댑터 자신의 어휘.** `resolveGitAdapterSettings(namespace)`가 이 어댑터의 설정 네임스페이스(`adapters.git`)를 검증합니다.
  `enforce: block | advise`는 커밋 표면의 시행 수위이고, `protectedPaths`는 커밋 표면의 가산 관측 범위입니다. 공통 목록 위에 커밋 시점에만
  더해 판정하는 항목들이고, 세션 표면은 읽지 않습니다(수위가 관측자의 것이듯 범위도 그렇습니다). 코어는 컨테이너 구조(어댑터당 설정 객체 하나)만 검증하고 내용은 원형 그대로
  넘기므로, 어휘와 검증기와 기본값은 전부 여기 삽니다. 부재는 `block`과 빈 목록으로 채워지고, 미지 키와 미지 값은 전체 필드 경로를 담아 즉시 거부됩니다.
- **이것뿐인 이유.** 이 패키지는 순수 라이브러리입니다. git diff라는 페이로드 형식만 알고, 설치·훅 러너·밸브는 모릅니다. umbrella의 `pdks
  covenant check`가 이것을 pre-commit 표면으로 조립하고, 훅 러너에 거는 일은 이 모듈 밖의 배포 행위입니다.

아키텍처 청사진과 설계 근거는 [프로젝트 저장소](https://github.com/huskyhoochu/polydeukes)에 있습니다.

## 라이선스

MIT
