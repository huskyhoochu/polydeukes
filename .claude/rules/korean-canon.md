---
paths:
  - "**/*.ko.md"
  - "_docs/**"
---

# Korean canon — one fact, one word

The Korean mirrors are not free translations. English polysemy that context disambiguates becomes
ambiguity Korean cannot resolve (measured 2026-08-27: `judge` / `verdict` / `judgment` had all
collapsed into 판정, and `gate` was spelled three ways), so the mapping is fixed here.

| English                | Korean         | Note                                                                                                                    |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| covenant               | 약속           | First mention per document may gloss as 약속(covenant).                                                                 |
| discipline             | 규율           | Same gloss rule.                                                                                                        |
| witness (valve)        | 증인           | The verb is 증언하다; the valve is 증인 밸브.                                                                           |
| judge (the component)  | 판정기         | The thing that decides.                                                                                                 |
| judgment (the act)     | 판정           | The act of deciding.                                                                                                    |
| verdict (the result)   | 판정 결과      | Never bare 판정 — that is the act.                                                                                      |
| gate                   | 관문           | Never 게이트, never bare 문.                                                                                            |
| surface                | 표면           | Reserved for the session/change-set surfaces. Never for "the public API of a document" — write 진입점 or 공개 면 there. |
| change-set surface     | 변경 집합 표면 | `pdks covenant check --diff` judging a finished change set from any producer.                                           |
| transcript             | 대화 기록      | Never 전사, never 트랜스크립트.                                                                                         |
| family (discipline)    | 계열           | Never 족.                                                                                                               |
| enforce level          | 강제 수준      | Never 수위.                                                                                                             |
| posture                | 기본 자세      | Bare 자세 reads as a body posture.                                                                                      |
| assembly               | 조립           | Always as 조립 단계 or 조립이 만드는 표.                                                                                |
| head (of a shell line) | 첫 낱말        | 머리 is undefined in Korean; say what it is.                                                                            |
| domain (of a check)    | 관측 범위      | Never 정의역 — that is the mathematical sense.                                                                          |

**Verbs carry facts, so one English verb maps to several Korean ones.**

| English use                   | Fact                     | Korean               |
| ----------------------------- | ------------------------ | -------------------- |
| fail-closed / the gate closes | The call is refused      | 차단한다             |
| close a defect                | The defect is fixed      | 고친다               |
| close the ungoverned cases    | They come under judgment | 판정 범위에 넣는다   |
| close a milestone             | The milestone ends       | 마감한다             |
| tests pass                    | The tests succeed        | 통과한다             |
| a call passes                 | Judged and upheld        | 판정을 받고 지나간다 |
| sailed through, never judged  | No judgment happened     | 판정에 이르지 못한다 |
| runs through the covenants    | Every call is judged     | 약속의 판정을 거친다 |

"약속을 통과합니다" reads as "everything passes", which contradicts the block counts beside it.

**No clipped Sino-Korean compounds.** Write `실제 측정`, never `실측`. This applies to living
documents; archived PRDs and measurement records keep the wording they shipped with.
