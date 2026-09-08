# `polydeukes`

**English** · [한국어](./README.ko.md)

Polydeukes is the umbrella package. Install this package; it ships the `pdks` bin, the judge,
both surfaces' composition roots, the session-surface runner subpath, and the bundled schema
artifact.

<a id="overview"></a>
## Overview

Public contract entry points:

- `pdks` / `polydeukes` — the bin
- `polydeukes/schema.json`

CLI commands:

- `pdks covenant check`
- `pdks init`
- `pdks-grok init` (ships with `@polydeukes/adapter-grok`)
- `pdks explain`
- `pdks docs [topic]`

<a id="public-symbols"></a>
## Public symbols

None. This package publishes no TypeScript entry point: `import 'polydeukes'` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and what a consumer reaches is the `pdks` bin and the
bundled schema. A surface hands the judge its input on stdin and reads the exit code, which
is what an agent adapter's hook does — it takes this package as a peer dependency and
spawns the bin rather than importing it.

<a id="see-also"></a>
## See also

- [`polydeukes` package reference](../../docs/reference/packages/polydeukes.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md)
- [`pdks init`](../../docs/reference/cli/init.md)
- [`pdks explain`](../../docs/reference/cli/explain.md)
