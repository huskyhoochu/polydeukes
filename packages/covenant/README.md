# `@polydeukes/covenant`

**English** · [한국어](./README.ko.md)

The covenant package is the judge layer. It exports the compilation, dispatch, runner,
meta-covenant, and witness APIs that the umbrella uses.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `compileDeclaration`
- `compileDisciplineRegistrations`
- `dispatchCovenants`
- `runCovenant`
- `selfModRegistration`
- `shellModRegistration`
- `transcriptModRegistration`
- `ttlWitness`
- `planSources`
- `supplySources`
- `CovenantRegistration`
- `RunCovenantSpec`
- `RunCovenantVerdict`

<a id="examples"></a>
## Examples

```ts
import { runCovenant, ttlWitness } from '@polydeukes/covenant';

const witness = ttlWitness({ token: 'covenant witness', ttlMs: 60_000 });
const verdict = await runCovenant({
  body: async () => ({ exitCode: 0 }),
  label: 'demo',
  telemetryPath: '.polydeukes/roi.log',
  witness,
});
```

<a id="see-also"></a>
## See also

- [`@polydeukes/covenant` package reference](../../docs/reference/packages/covenant.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md#disciplines)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md)
