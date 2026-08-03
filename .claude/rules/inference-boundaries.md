---
paths:
  - "packages/**"
---

# What the code may infer

## Do what you were told, where you were told

A program acting on its arguments has a finite domain: the values it received, the path it was
invoked from, the branches it contains. The moment it infers intent or state — "which directory
did they *really* mean", "what shape might this file be", "what could this key be misused for" —
the domain becomes every possible intent and every possible state, and counterexamples never run
out. Guessing is the cause; the unsatisfiable domain `claims-and-criteria.md` forbids is the
symptom.

- A CLI installs where it was invoked. A wrong directory is the user's cheap, legible mistake;
  inferring the "right" one trades it for an argument with a tool that can be wrong.
- Validate what this code will use, not what a file could contain. Reading back what you wrote
  is one question over one code path; enumerating malformed inputs never terminates.
- A default that locks the owner's own off-switch treats them as the threat. Protection lists
  ship as minimums.
