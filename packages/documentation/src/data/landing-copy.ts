/** Every visible string of the landing page in one language. */
export interface LandingCopy {
  metaTitle: string;
  metaDescription: string;
  ogAlt: string;
  navDocs: string;
  navRecipes: string;
  navLanguage: string;
  navTheme: string;
  navGithub: string;
  heroTitle: string;
  heroLede: string;
  copyLabel: string;
  copiedLabel: string;
  heroDocsLink: string;
  chartMyth: string;
  chartMore: string;
  nameHeading: string;
  nameTwins: string;
  nameDiscipline: string;
  nameRecord: string;
  /** What the stars and dotted lines of the first-screen chart stand for; shown above the cases. */
  casesLegend: string;
  casesHeading: string;
  /** One sentence per case, in the order the cases are shown. */
  caseCaptions: string[];
  caseExitLabel: string;
  caseRecipeLink: string;
  recipesHeading: string;
  /** Title and one line for each featured recipe, in the order they are shown. */
  recipeCards: { title: string; text: string }[];
  recipesListLink: string;
  recipeEntryLabel: string;
  installHeading: string;
  installHomebrew: string;
  installCargo: string;
  installNpm: string;
  installPypi: string;
  installRecommended: string;
  installGuideLink: string;
  chooseHeading: string;
  chooseText: string;
  chooseAuto: string;
  chooseLink: string;
  furtherHeading: string;
  furtherNaming: string;
  furtherWhy: string;
  furtherDocs: string;
  footer: string;
}

/** The landing page's strings by language; both languages must define every key. */
export const copy: { en: LandingCopy; ko: LandingCopy } = {
  en: {
    metaTitle: 'Polydeukes — Declare development disciplines',
    metaDescription:
      'Declare checks for edits and commands in configuration, record their verdicts, and choose advice or blocking with Polydeukes.',
    ogAlt:
      'A dark card with the Polydeukes logo, an English headline, and the Gemini constellation figure',
    navDocs: 'Documentation',
    navRecipes: 'Browse recipes',
    navLanguage: '한국어',
    navTheme: 'Change color theme',
    navGithub: 'View Polydeukes on GitHub',
    heroTitle: 'Agents keep getting smarter. Your harness should keep up.',
    heroLede:
      "With Polydeukes you declare your harness as disciplines in configuration instead of coding it: one typed vocabulary, validated by a schema. The host's hook judges each call with the same result for the same input, and a discipline is a configuration entry you can copy into another repository.",
    copyLabel: 'Copy installation command',
    copiedLabel: 'Command copied',
    heroDocsLink: 'Open documentation',
    chartMyth:
      'Polydeukes takes its name from the Greek myth of twins Castor and Polydeukes (Pollux in Latin). Castor was mortal; Polydeukes was immortal. When Castor died, Polydeukes shared half his immortality with his brother. The twins became Gemini. On northern winter evenings, find two bright stars together northeast of Orion.',
    chartMore: 'What this name means for the product',
    nameHeading: 'What the name means',
    nameTwins:
      'The brothers represent two colleagues working together: a human and an AI. The human brings practiced experience; the AI brings its capabilities. They contribute to shared work as partners with different abilities and limits.',
    nameDiscipline:
      'The shared immortality stands for discipline. A person shares practices they already follow—writing tests, verifying before commits, recording decisions—as covenants to keep together. Polydeukes puts that discipline in configuration and judges each call on connected surfaces.',
    nameRecord:
      'Each judgment leaves a record. Code, like Castor, is replaced; the record, like Polydeukes, remains. Carrying it into the next implementation preserves what we learned.',
    casesLegend:
      'In the opening chart, stars on the Castor side hold files edited by the agent; dotted lines connect them to stars on the Pollux side holding the verdicts for those calls.',
    casesHeading: 'Calls and verdicts',
    caseCaptions: [
      'This discipline requires version and API lookups before dependency edits because memory may be outdated. The agent upgrades hono and adds @hono/zod-validator in package.json without npm view or documentation lookups earlier in the session. The edit proceeds, and pdks records the verdict as advised.',
      'This discipline keeps comments short because longer explanations belong in a pull request or design document. In one edit, the agent adds four consecutive // comment lines narrating the code inside a function. The edit proceeds, and pdks records the verdict as advised.',
      'This discipline leaves migration files to drizzle-kit because manual edits can make the recorded migration order disagree with the database. The agent directly edits SQL in an automatically generated migration file. pdks blocks the call with exit code 2 and records blocked.',
      'This discipline requires public package entry points so moving internal files does not break other packages. The agent imports the internal file @acme/billing/src/money/round directly instead of using the public entry point @acme/billing. pdks blocks the call with exit code 2 and records blocked.',
    ],
    caseExitLabel: 'Exit status',
    caseRecipeLink: 'View this recipe',
    recipesHeading: 'Declare a discipline',
    recipeCards: [
      {
        title: 'Read the design document first',
        text: 'Checks that the design document was read before source files are edited.',
      },
      {
        title: 'Few test runs per edit',
        text: 'Detects repeated test runs without an edit between them.',
      },
      {
        title: 'Tests are written by the test writer',
        text: 'Detects when an implementer subagent edits tests.',
      },
    ],
    recipeEntryLabel: 'The entry behind the second case',
    recipesListLink: 'Browse all recipes',
    installHeading: 'Install Polydeukes',
    installHomebrew: 'Homebrew',
    installCargo: 'crates.io',
    installNpm: 'npm',
    installPypi: 'PyPI',
    installRecommended: 'Recommended route',
    installGuideLink: 'Installation instructions',
    chooseHeading: 'Choose your tools',
    chooseText:
      'Choose by the evidence a check needs and when it should run: file contents, command text, or earlier session calls. The guide compares Polydeukes with linters, commit hooks, and host permissions.',
    chooseAuto:
      'Claude Code auto mode uses a model to judge calls and handles approval for you. Polydeukes judges calls from declarations and does not grant approval. You can use them together.',
    chooseLink: 'Compare tools for your checks',
    furtherHeading: 'Understand the design',
    furtherNaming:
      'The industry calls this layer a harness; Polydeukes calls each check a discipline. These practices began as commitments developers kept themselves and apply equally to people and agents on connected surfaces.',
    furtherWhy: 'Read why Polydeukes exists',
    furtherDocs: 'Explore the documentation',
    footer: 'Available under the MIT license.',
  },
  ko: {
    metaTitle: 'Polydeukes — 개발 규율을 선언하세요',
    metaDescription:
      '편집과 명령을 검사할 규율을 설정에 선언하세요. Polydeukes가 판정 결과를 기록하고, 선택한 강제 수준에 따라 권고하거나 차단합니다.',
    ogAlt: '어두운 바탕에 Polydeukes 로고, 한국어 제목, 쌍둥이자리 별자리 도형이 그려진 카드',
    navDocs: '문서 보기',
    navRecipes: '레시피 보기',
    navLanguage: 'English',
    navTheme: '화면 테마 바꾸기',
    navGithub: 'GitHub에서 Polydeukes 보기',
    heroTitle: '에이전트가 똑똑해지는 만큼, 하네스도 함께 진화해야 합니다.',
    heroLede:
      'Polydeukes에서는 하네스를 코드로 개발하지 않고 설정 파일에 규율(discipline)로 선언합니다. 유형화된 어휘 하나로 적고 스키마로 검증합니다. 호스트의 훅이 호출을 판정해 같은 입력에 같은 결과를 내고, 규율은 설정 항목 그대로 다른 저장소에 옮겨 쓸 수 있습니다.',
    copyLabel: '설치 명령 복사하기',
    copiedLabel: '명령을 복사했습니다',
    heroDocsLink: '문서로 시작하기',
    chartMyth:
      '폴리데우케스라는 제품명은 그리스 신화 속 쌍둥이 카스토르와 폴리데우케스(폴룩스) 이야기에서 따왔습니다. 카스토르는 죽을 운명이었고, 폴리데우케스는 불멸의 존재였습니다. 카스토르가 죽자 폴리데우케스는 자기 불멸의 절반을 형제에게 나눠 주었습니다. 형제는 쌍둥이자리가 되었습니다. 북반구 겨울 저녁 오리온자리 북동쪽(왼쪽 위)에 나란한 밝은 두 별을 찾으세요.',
    chartMore: '이 이름이 제품에서 뜻하는 것',
    nameHeading: '이 이름에 담긴 뜻',
    nameTwins:
      '형제는 함께 일하는 두 동료, 사람과 AI를 뜻합니다. 사람은 익힌 경험을, AI는 역량을 공동 작업에 보탭니다. 둘은 서로 다른 능력과 한계를 지닌 동료입니다.',
    nameDiscipline:
      '폴리데우케스가 나눈 불멸은 규율을 뜻합니다. 사람은 스스로 지키던 테스트, 커밋 전 검증, 결정의 기록을 함께 지킬 약속으로 나눕니다. Polydeukes는 그 규율을 설정에 적고 연결된 표면의 호출마다 판정합니다.',
    nameRecord:
      '판정마다 기록이 남습니다. 코드는 카스토르처럼 교체되어도 기록은 폴리데우케스처럼 남습니다. 기록을 다음 구현으로 가져가면 배운 것은 사라지지 않습니다.',
    casesLegend:
      '첫 화면의 카스토르 쪽 별에는 에이전트가 편집한 파일이, 점선으로 이어진 폴룩스 쪽 별에는 그 호출의 판정 결과가 놓입니다.',
    casesHeading: '호출과 판정 결과',
    caseCaptions: [
      '이 규율은 낡은 기억에 의존하지 않도록 버전과 API를 먼저 조회하게 합니다. 에이전트는 npm view와 문서 조회 없이 hono를 올리고 @hono/zod-validator를 더했습니다. 편집은 진행되고 판정 결과는 advised로 기록됩니다.',
      '이 규율은 긴 설명을 PR이나 설계 문서에 두도록 주석을 짧게 쓰게 합니다. 에이전트는 함수 안에 코드를 풀어 말하는 // 주석 네 줄을 한 번에 이어 붙였습니다. 편집은 진행되고 판정 결과는 advised로 기록됩니다.',
      '이 규율은 순서 기록과 데이터베이스가 어긋나지 않도록 마이그레이션 파일을 drizzle-kit에 맡깁니다. 에이전트는 자동 생성된 마이그레이션 파일의 SQL을 직접 고쳤습니다. pdks는 종료 코드 2로 호출을 차단합니다(blocked).',
      '이 규율은 파일 이동으로 다른 패키지가 깨지지 않게 공개 진입점만 쓰게 합니다. 에이전트는 @acme/billing을 거치지 않고 내부 파일 @acme/billing/src/money/round를 가져왔습니다. pdks는 종료 코드 2로 호출을 차단합니다(blocked).',
    ],
    caseExitLabel: '종료 코드',
    caseRecipeLink: '이 레시피 보기',
    recipesHeading: '규율 선언하기',
    recipeCards: [
      {
        title: '편집 전에 설계 문서 읽기',
        text: '소스 파일을 편집하기 전에 설계 문서를 읽었는지 확인합니다.',
      },
      {
        title: '편집 없는 테스트 반복 감지',
        text: '사이에 편집 없이 테스트를 되풀이 실행하는 것을 감지합니다.',
      },
      {
        title: '테스트는 테스트 작성자가',
        text: '구현 서브에이전트가 테스트를 편집하는 것을 감지합니다.',
      },
    ],
    recipeEntryLabel: '두 번째 사례를 판정한 항목',
    recipesListLink: '모든 레시피 보기',
    installHeading: '설치하기',
    installHomebrew: 'Homebrew',
    installCargo: 'crates.io',
    installNpm: 'npm',
    installPypi: 'PyPI',
    installRecommended: '권장 설치 방법',
    installGuideLink: '설치 방법 자세히 보기',
    chooseHeading: '도구 고르기',
    chooseText:
      '파일 내용, 명령 텍스트, 앞선 세션 호출 중 무엇을 언제 검사할지에 따라 도구를 고르세요. 선택 안내에서 Polydeukes를 린터, 커밋 훅, 호스트 권한 설정과 비교합니다.',
    chooseAuto:
      'Claude Code auto mode에서는 모델이 호출을 판정하고 승인을 대신합니다. Polydeukes는 선언으로 호출을 판정하며 승인하지 않습니다. 두 도구를 함께 쓸 수 있습니다.',
    chooseLink: '검사할 대상에 맞는 도구 찾기',
    furtherHeading: '설계 이해하기',
    furtherNaming:
      '업계에서는 이 층을 하네스라고 하며, Polydeukes는 검사 하나하나를 규율(discipline)이라고 부릅니다. 개발자가 스스로 지키던 실천에서 비롯되었고, 연결된 표면에서 사람과 에이전트에게 똑같이 적용되기 때문입니다.',
    furtherWhy: 'Polydeukes의 설계 이유 읽기',
    furtherDocs: '전체 문서 살펴보기',
    footer: 'MIT 라이선스로 배포합니다.',
  },
};
