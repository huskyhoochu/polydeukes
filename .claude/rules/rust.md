---
paths:
  - "packages/pdks/**"
---

# Rust in this repository

`packages/pdks` re-implements a process contract that the TypeScript judge defined and the
fixtures in `conformance/covenant/` pin. Most of what follows exists because general Rust advice
and that contract disagree somewhere. Researched against stable 1.99.1 (2026-10-30); sources at
the end.

## Toolchain and edition

- Stable only, edition 2024, no `#![feature]`. `rust-version` is the highest MSRV among the
  crate's dependencies, not the newest toolchain: `pdks` is at 1.89 because `serde-saphyr` is.
- Edition 2024 gives let chains (`if let Some(x) = a && x > 0`), stable since 1.88. Use them
  instead of nested `if let` ladders.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` run in CI beside
  `cargo test`. Format with rustfmt defaults; no `rustfmt.toml`.

## Lints live in `Cargo.toml`

```toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
pedantic = { level = "warn", priority = -1 }
unwrap_used = "warn"
panic = "warn"
todo = "warn"
unimplemented = "warn"
indexing_slicing = "warn"
string_slice = "warn"
get_unwrap = "warn"
unwrap_in_result = "warn"
let_underscore_must_use = "warn"
map_err_ignore = "warn"
print_stdout = "warn"
dbg_macro = "warn"
```

The `restriction` group is opted into lint by lint, never as a whole: it contains lints that
contradict each other. Silence one site with `#[expect(lint, reason = "...")]`, not `#[allow]`;
`expect` fails once the code it excused is gone.

## Why these lints, in this crate

- **A panic is an exit code nobody promised.** An unwinding panic ends the process with 101; the
  contract has 0, 2 and 3. Input from stdin, the config and the tree reaches no `unwrap`, no
  indexing and no slicing that can fail. `expect("why this cannot fail")` is reserved for an
  invariant the code itself established a few lines up.
- **`covenant check` writes nothing to stdout.** The fixture runner fails a case whose stdout is
  not empty, so `print_stdout` stays on; stderr goes through `eprintln!` or an explicit writer.
- **Strings are UTF-8 here and UTF-16 in the original.** A TS `length`, `slice` or index counts
  UTF-16 code units. Port string walks with `char_indices` or byte offsets the scan itself
  produced; `string_slice` catches the rest.
- **A dropped `Result` is a missing telemetry row.** Telemetry writes are fail-open by design, and
  that is stated where it happens (`let _ = ...` behind an `#[expect]` with the reason), never
  left implicit.

## Errors

- The binary owns its error text: stderr substrings are contract, compared by the fixtures. Errors
  are an enum or a `reason: String` whose `Display` is the exact line the TS judge wrote. No
  `anyhow` or `Box<dyn Error>` context chains, whose `a: b: c` format the contract does not use.
- Exit codes are one enum (0 · 2 · 3) mapped in `main`. No other function calls
  `std::process::exit`.

## Values that cross the process boundary

- `serde_json` with `preserve_order`: JS iterates object keys in insertion order and the judge's
  routing and row order follow it.
- A JS number is an `f64` that `JSON.stringify` prints without a fractional part when it is
  integral (`1`, not `1.0`). Keep integers as `u64`/`i64` in `serde_json::Value`; a value parsed
  from JSON already is one.
- Time is milliseconds since the epoch as `i64`, formatted as ISO-8601 UTC with milliseconds
  (`2026-10-30T00:00:00.000Z`), the shape `Date.prototype.toISOString` produces.
- Deserialize input with `serde` structs where the shape is fixed, but never
  `deny_unknown_fields` on the IR: the TS reader accepts top-level keys it does not read.
- Patterns in the config are JS `RegExp` source, and real configs use lookahead. Compile them with
  `regress` (ECMAScript syntax), never the `regex` crate, which rejects lookaround.
- `Path::join` with an absolute argument discards the base; Node's `path.join` appends it. A
  configured or observed path joined onto the repository root goes through one helper that keeps
  it under the root, never a bare `join`.

## Shape of the code

- No `async`, no threads, no `Rc`/`Arc`: one process judges one input and exits.
- No trait with a single implementation, no builder for a struct literal, no module object for
  test injection; the TS judge had those for in-process callers this crate does not have.
- `enum` instead of a `bool` parameter whose meaning is not obvious at the call site; named
  fields instead of tuples beyond a newtype.
- No glob imports except `use super::*` in a test module.
- Direct `for` loops over long combinator chains that mutate outside state.
- Comments follow `comments.md`: the crate is public source.

## Sources

1. Rust 1.99.0 and 1.99.1 release notes, <https://doc.rust-lang.org/stable/releases.html>
2. Rust 1.88.0 announcement (let chains, 2024 edition only), <https://blog.rust-lang.org/2025/06/26/Rust-1.88.0>
3. Clippy lint groups and configuration, <https://doc.rust-lang.org/clippy/lints.html>, <https://doc.rust-lang.org/stable/clippy/configuration.html>
4. Google Rust style guide, <https://google.github.io/styleguide/rustguide.html>
5. Canonical, error and panic discipline, <https://canonical.github.io/rust-best-practices/error-and-panic-discipline.html>
6. E. Schwartz, "Your Clippy Config Should Be Stricter", <https://emschwartz.me/your-clippy-config-should-be-stricter>
