# `@polydeukes/adapter-git`

**English** · [한국어](./README.ko.md)

This adapter translates staged git observations into covenant input IR and provides the git adapter
settings validator and observation reader.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `collectStagedChanges`
- `collectWorktreeChanges`
- `collectRangeChanges`
- `observationSourceReader`
- `resolveGitAdapterSettings`
- `covenantInputFromStagedChanges`
- `STAGED_WRITE`
- `STAGED_DELETE`

<a id="examples"></a>
## Examples

```ts
import { collectStagedChanges, resolveGitAdapterSettings } from '@polydeukes/adapter-git';

const settings = resolveGitAdapterSettings({ namespace: { enforce: 'advise' } });
const staged = collectStagedChanges({ repoRoot: process.cwd() });
```

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-git` package reference](../../docs/reference/packages/adapter-git.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md#adapters-git)
