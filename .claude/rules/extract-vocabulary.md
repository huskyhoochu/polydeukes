---
paths:
  - "packages/pdks/src/covenant/extract.rs"
  - "packages/pdks/src/core/declaration.rs"
---

# Registering an extract step

The unary extract vocabulary is open — it grows whenever a discipline needs a value the current
steps cannot produce — but it grows only through `STEP_NAMES` in
`packages/pdks/src/core/declaration.rs` and only by a release. A declaration cannot name a step that
list does not carry: `compile_declaration` in that module answers with a config fault before
anything runs. The relation position (seven names) and the binary combinators (`union` · `onlyIn` ·
`intersect`) are closed and are not registered here.

Adding one step is one S-sized ticket, and the ticket delivers all six of these.

1. **One measured demand.** A roadmap row, or a discipline someone tried to write that the current
   steps cannot express.
2. **One step definition** — add its name to `STEP_NAMES`, its variant to `Step`, and its argument
   validation to `parse_step` and `build_step` in `packages/pdks/src/core/declaration.rs`; add its
   execution to `run_step` in `packages/pdks/src/covenant/extract.rs`. Validation rejects a wrong
   type or an unknown key with a config fault that names the location. Execution maps
   `Items → Items`. A step that compares two world values against each other is not a unary step —
   that comparison is a combinator's, and the combinators are three. A constant in the declaration
   (a regex, a bound, a field name) is what a unary step compares against.
3. **An argument-negative fixture per argument key** — one invalid value for every accepted key,
   each asserting the fault's location. A constraint with no fixture is unverified whichever side of
   the schema it sits on.
4. **Run fixtures at both ends of every axis** — the empty input, the element the step drops, and an
   input whose order the output must preserve. Then ask which axis still has no fixture; that
   question is the criterion, not the assertion count.
5. **Keep the vocabulary in `STEP_NAMES`.** `algebra-vocabulary.md` names the _kinds_ (unary,
   combinator, relation) and stays untouched.
6. **Zero schema lines.** `algebra-declaration.schema.json` leaves the unary position open, so a new
   step changes nothing there. Declaration compilation checks the step name against `STEP_NAMES`.

## What a step may not do

- Return anything but `Items`. The last comparison of a judgment happens in the relation position; a
  step that answers yes/no has moved it, and the closed relation list is then empty of meaning.
- Throw. A step drops elements it cannot handle (a non-object where `field` expects one) and returns
  the rest. The two things that fail are `json` (a supply failure, named by source) and compilation
  (a config fault).
- Read the world. `source` is the one step that reaches into `World`, and it reads by the name the
  declaration gave; every other step sees only the items the previous step produced.
- Sort or deduplicate on its own account. `sort` is the step for ordering and it is explicit; every
  other step preserves input order, because the witness order two surfaces agree on is derived from
  it.
