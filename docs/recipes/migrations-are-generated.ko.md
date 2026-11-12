# 생성된 마이그레이션의 직접 편집 막기

[English](./migrations-are-generated.md) · **한국어**

이 규율(discipline)은 생성된 SQL, 스냅샷, 마이그레이션 기록 파일을 대상으로 하는 편집 도구 호출을
차단합니다. 예시는 drizzle-kit과 루트의 `drizzle/` 디렉터리를 사용합니다. 생성기의 출력 경로에 맞춰
네 곳을 바꾸세요. `scope.include`의 세 패턴과 `extract.handEdited`의 `matches`에 있는 `^drizzle/`
접두사입니다.

세션 표면 · 연결된 세션에서 차단 · 편집 경로를 읽음 · 수정할 값: 출력 경로 세 곳과 경로 접두사.
증거: [파일 편집](../reference/host-support.ko.md#file-edits).

아래는 완전한 `polydeukes.config.yaml`입니다. 설정이 없으면 프로젝트 루트에 저장하세요.
`sessionDisciplines:`가 이미 있으면 그 아래의 항목만 추가하고 기존 항목을 유지하세요. 파일에 해당
키가 없으면 블록 전체를 덧붙이세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  # drizzle-kit generate owns these three shapes. Editing the SQL, a snapshot or _journal.json by
  # hand corrupts migration ordering silently.
  # The entry is session-only: a direct edit call names its target path, while a finished change
  # set cannot show whether a person or the generator wrote it.
  - id: "migrations-are-generated"
    why: "Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error."
    enforce: block
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "target.path"
        include:
          - '^drizzle/\d{4}_[^/]+\.sql$'
          - '^drizzle/meta/_journal\.json$'
          - '^drizzle/meta/\d{4}_snapshot\.json$'
      supply: { actor: "empty" }
      extract:
        handEdited:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "^drizzle/" }
      relate:
        - id: "generated"
          relation: { op: "empty", of: "handEdited" }
          message: "{value} is owned by drizzle-kit"
      # No adapter emits a drizzle-kit actor, so this witness does not open in a session.
      witness:
        extract:
          generator:
            - { op: "source", of: "actor" }
            - { op: "select", path: "agentType" }
            - { op: "matches", re: "^drizzle-kit$" }
        relate:
          - id: "generator-actor"
            relation: { op: "nonEmpty", of: "generator" }
            message: "the actor is not drizzle-kit"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트의 Claude Code나 Codex에 붙여 넣으세요.

````text
Add the entry below under sessionDisciplines: in this project's polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve every other entry,
protected path and witness setting. If the same id exists, report it and stop.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the line for migrations-are-generated.
Confirm enforce: block on the line.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  # drizzle-kit generate owns these three shapes. Editing the SQL, a snapshot or _journal.json by
  # hand corrupts migration ordering silently.
  # The entry is session-only: a direct edit call names its target path, while a finished change
  # set cannot show whether a person or the generator wrote it.
  - id: "migrations-are-generated"
    why: "Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error."
    enforce: block
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "target.path"
        include:
          - '^drizzle/\d{4}_[^/]+\.sql$'
          - '^drizzle/meta/_journal\.json$'
          - '^drizzle/meta/\d{4}_snapshot\.json$'
      supply: { actor: "empty" }
      extract:
        handEdited:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "^drizzle/" }
      relate:
        - id: "generated"
          relation: { op: "empty", of: "handEdited" }
          message: "{value} is owned by drizzle-kit"
      # No adapter emits a drizzle-kit actor, so this witness does not open in a session.
      witness:
        extract:
          generator:
            - { op: "source", of: "actor" }
            - { op: "select", path: "agentType" }
            - { op: "matches", re: "^drizzle-kit$" }
        relate:
          - id: "generator-actor"
            relation: { op: "nonEmpty", of: "generator" }
            message: "the actor is not drizzle-kit"
```
````

<a id="try-it"></a>
## 직접 해보기

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 아래 두 입력도 저장하세요.
`pdks covenant check`는 JSON을 판정하며 안에 적힌 명령이나 편집을 실행하지 않습니다.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "drizzle/0003_add_orders.sql" },
      "fileChange": {
        "kind": "modify",
        "path": "drizzle/0003_add_orders.sql",
        "pre": "ALTER TABLE a;\n",
        "post": "ALTER TABLE b;\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "src/db/schema.ts" },
      "fileChange": { "kind": "modify", "path": "src/db/schema.ts", "pre": "a\n", "post": "b\n" }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`fileChange`는 관측한 편집의 경로와 전후 내용입니다. `tools`는 편집 도구와 셸 도구를 식별합니다.
실제 세션에서는 어댑터가 이 값을 제공합니다.

먼저 강제 수준 플래그 없이 실행하세요.

```sh
pdks covenant check < violating.json
```

표준 오류:

```text
discipline 'migrations-are-generated' broken on drizzle/0003_add_orders.sql: drizzle/0003_add_orders.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0.

세션의 강제 수준으로 위반 입력을 확인하세요.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류:

```text
discipline 'migrations-are-generated' broken on drizzle/0003_add_orders.sql: drizzle/0003_add_orders.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
```

종료 코드: 2.

정상 입력을 확인하세요.

```sh
pdks covenant check --enforce block < valid.json
```

출력 없음.

종료 코드: 0.

항목과 실행의 강제 수준 중 더 느슨한 쪽을 따릅니다. 이 항목은 `--enforce block`에서 차단하고
플래그가 없으면 권고합니다.

`.polydeukes/roi.log`에 추가된 행입니다. 실행마다 타임스탬프와 임시 디렉터리 경로는 달라집니다.

```text
2026-11-12T15:15:47.429Z	advised	migrations-are-generated	drizzle/0003_add_orders.sql	[{"id":"generated","witnesses":[{"key":"0","value":"drizzle/0003_add_orders.sql"}],"total":1}]
2026-11-12T15:15:47.432Z	blocked	migrations-are-generated	drizzle/0003_add_orders.sql	[{"id":"generated","witnesses":[{"key":"0","value":"drizzle/0003_add_orders.sql"}],"total":1}]
2026-11-12T15:15:47.434Z	passed	covenant-check	src/db/schema.ts
```

**다른 입력**

아래는 `violating.json`의 편집을 바꿔 볼 입력입니다. 각 항목의 `pre`와 `post`는 JSON 문자열 표기이며
`\n`은 줄바꿈입니다. 경로를 바꾸면 `args.file_path`와 `fileChange.path`를 함께 바꾸세요. 도구 이름,
`kind`, 이력을 따로 적은 경우에는 그 값도 바꾸세요. 각 입력은 독립적으로 실행하며 아래 출력 블록은
서로 다른 진단을 모은 것입니다.

- `drizzle/0007_add_invoice_status.sql`: `Edit`, `kind: modify`; `pre`:
  `"ALTER TABLE \"invoices\" ADD COLUMN \"status\" text;\n"`; `post`:
  `"ALTER TABLE \"invoices\" ADD COLUMN \"status\" text DEFAULT 'open' NOT NULL;\n"`. `blocked`;
  종료 코드 2 (`--enforce block`).
- `drizzle/meta/_journal.json`: `Edit`, `kind: modify`; `pre`: `"{\"entries\":[]}\n"`; `post`:
  `"{\"entries\":[{\"idx\":0}]}\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `drizzle/0004_add_invoices.sql`: `Write`, `kind: create`; `pre`: `""`; `post`:
  `"CREATE TABLE invoices (id int);\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `drizzle/meta/0003_snapshot.json`: `Edit`, `kind: modify`; `pre`: `"{}\n"`; `post`:
  `"{\"version\":\"7\"}\n"`. `blocked`; 종료 코드 2 (`--enforce block`).

각 입력의 첫 진단입니다. 권고 실행에는 위의 `covenant advisory: …` 요약도 뒤따릅니다.

```text
discipline 'migrations-are-generated' broken on drizzle/0007_add_invoice_status.sql: drizzle/0007_add_invoice_status.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/meta/_journal.json: drizzle/meta/_journal.json is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/0004_add_invoices.sql: drizzle/0004_add_invoices.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/meta/0003_snapshot.json: drizzle/meta/0003_snapshot.json is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
```

**변경 집합 표면에서**

다음을 `change.diff`로 저장하세요.

```diff
--- a/drizzle/0003_add_orders.sql
+++ b/drizzle/0003_add_orders.sql
@@ -1 +1 @@
-ALTER TABLE a;
+ALTER TABLE b;
```

```sh
pdks covenant check --diff < change.diff
```

출력 없음.

종료 코드: 0. 추가된 행:

```text
2026-11-12T15:15:47.437Z	passed	covenant-check	drizzle/0003_add_orders.sql
```

**실제 세션에서**

```sh
pdks explain
```

종료 코드: 0. 항목의 세션 줄:

```text
  declare  migrations-are-generated scoped-valve · change,actor · empty generated · scope target.path · include 3 · exclude 0 · sources 0 · valve ✓ · why ✓ · enforce: block · unattended: judge
```

어댑터를 연결하고 범위 안의 편집을 수행한 뒤 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결하기](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 바꿔 쓰기

`scope.include`의 세 패턴을 사용하는 생성기의 SQL, 기록 파일, 스냅샷 경로로 바꾸세요.
`extract.handEdited`의 `matches`에 있는 `^drizzle/` 접두사도 같은 출력 디렉터리로 바꾸세요. 예시의
SQL과 스냅샷 이름은 숫자 네 자리를 요구합니다.

`witness` 블록은 `scoped-valve`가 요구하는 구조입니다. `actor.agentType`을 읽어 이름이 정확히
`drizzle-kit`이면 받아들입니다. 현재 어댑터는 이 actor를 내지 않습니다. 셸에서 생성기를 실행할 수
있는 이유는 이 항목이 편집 도구 호출을 판정하기 때문입니다. 생성기 actor를 공급받는 것은 아닙니다.
경로를 바꿀 때 증인 구조는 유지하세요.

권고로 바꾸려면 `enforce: block`을 지우세요. 규율을 없애려면 항목을 삭제하세요. 수정 후
`pdks explain`과 두 입력 검사를 실행하세요.

<a id="limits"></a>
## 한계

`scope.include`의 세 접두사만 `^drizzle/`에서 `^migrations/`로 바꾸고 `extract.handEdited`의
`matches` 접두사를 `^drizzle/`로 두면, `migrations/0003_add_orders.sql`의 `ALTER TABLE a;`를
`ALTER TABLE b;`로 바꾸는 `Edit`는 `--enforce block`에서도 `passed`와 종료 코드 0을 기록합니다. 네
곳을 함께 바꾸세요.

생성기가 빈 SQL 파일을 만들고 사람이 내용을 채우는 drizzle-kit custom migration 같은 흐름도 경로로
판정합니다. 빈 `drizzle/0005_seed.sql`에 `INSERT INTO users (id) VALUES (1);`를 채우는 `Edit`는
`--enforce block`에서 `blocked`와 종료 코드 2를 기록합니다. 이런 파일은 에이전트 세션 밖의
터미널이나 편집기에서 고치세요.

이 항목은 편집 도구 호출을 경로로 판정하며 SQL 내용을 검사하지 않습니다.
`drizzle/0003_add_orders.sql`을 `ALTER TABLE a;`에서 `ALTER TABLE b;`로 고치거나, 기록 파일과
스냅샷을 고치거나, `CREATE TABLE invoices (id int);` 내용으로 `drizzle/0004_add_invoices.sql`을
만들면 `--enforce block`에서 차단됩니다.

생성기가 셸에서 쓰는 파일은 이 판정을 받지 않습니다. `npx drizzle-kit generate` Bash 호출은
`passed covenant-check`만 기록합니다. `fileChange` 없이 수동 셸 쓰기
`echo 'ALTER TABLE a;' > drizzle/0005_hand_written.sql`을 입력하면 `no-observation` 사유로
`skipped`를 기록합니다. `drizzle/0003_add_orders.sql`의 `ALTER TABLE a;`를 `ALTER TABLE b;`로 바꾸는
diff도 `--enforce block` 여부와 관계없이 `passed covenant-check`만 기록합니다. 완성된 diff에는 누가
생성했는지에 대한 증거가 없습니다.

`witness` 블록은 `scoped-valve`가 요구하는 구조이며, 현재 어댑터는 `drizzle-kit` actor를 공급하지
않습니다. 손으로 쓴 입력에서 `violating.json`에 `actor: {"agentType":"drizzle-kit"}`를 추가하면 위반
진단을 그대로 출력하면서 `witnessed`와 종료 코드 0을 기록합니다. `{}`,
`{"agentType":"implementer"}`, `{"agentType":"drizzle-kit-fork"}`는 모두 차단됩니다. 이 actor 예시는
판정기의 동작을 보이며 호스트가 생성기를 식별했다는 뜻은 아닙니다.

`src/db/schema.ts`, `drizzle/README.md`, `drizzle/meta/notes.json`, `drizzle/seeds/0001_users.sql`,
`drizzle/001_init.sql`, `apps/server/drizzle/0003_add_orders.sql`에서 `a\n`을 `b\n`으로 바꾸면 범위
밖이므로 `passed covenant-check`만 기록합니다. 손으로 쓴 Bash 입력에
`args.command: "rm drizzle/0003_add_orders.sql"`과 `fileChange.kind: "delete"`를 넣으면 차단됩니다.
실제 호스트가 이 삭제를 보고하는지는 별도로 관측해야 합니다.

이 JSON 입력은 판정기를 확인하며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나 판정기가
시작되지 못하면 호출은 판정 없이 진행됩니다. 연결 후 기록 행을 확인하세요.
