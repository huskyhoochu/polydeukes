# Input IR and schemas

**English** · [한국어](./core.ko.md)

<a id="contract"></a>
## Where the contract lives

Configuration and input IR are data validated by the Rust judge. Public schemas live in the
repository schema directory, and transport types in all three SDKs are generated from them.
Installing the executable does not install a JavaScript core library.

<a id="schemas"></a>
## Schemas

| File                                                                                 | Contract            |
| ------------------------------------------------------------------------------------ | ------------------- |
| [polydeukes.schema.json](../../../schema/polydeukes.schema.json)                     | Configuration       |
| [algebra-declaration.schema.json](../../../schema/algebra-declaration.schema.json)   | Declaration grammar |
| [covenant-input.schema.json](../../../schema/covenant-input.schema.json)             | Judgment input IR   |
| [memory-search-output.schema.json](../../../schema/memory-search-output.schema.json) | Search response     |

Point editors at schemas matching your release. Generated types and runtime validation are separate;
callers must still handle CLI errors.

<a id="input-ir"></a>
## Input IR

Top-level IR arrays are toolCalls, subagentSpawns, and userMessages. Supply host tools, session, and
actor evidence according to the contract. A caller-provided world key is refused. File pre/post
content and tool roles must describe the actual observation.
[covenant
check](../cli/covenant-check.md)
documents shapes, failures, and surfaces.

<a id="consumer-contract"></a>
## Choose an SDK

[TypeScript](./sdk-ts.md) · [Rust](./sdk-rust.md) · [Python](./sdk-python.md)

SDKs invoke a separately installed pdks executable. Supply its explicit path or PATH and the project
root, and distinguish judgment results from process failures. Memory search also requires the
separate memory extension.
