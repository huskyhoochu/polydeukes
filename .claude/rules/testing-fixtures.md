---
paths:
  - "packages/core/__tests__/**"
  - "packages/covenant/__tests__/**"
  - "packages/adapter-claude-code/__tests__/**"
  - "packages/adapter-git/__tests__/**"
  - "packages/polydeukes/__tests__/**"
---

# Fixtures and what a green test proves

Every defect this repository shipped passed its own suite first. These are the failure modes
that produced that.

## A fixture must break in the direction the contract fixes

Breaking-direction alone is not enough. `COVENANT-07b`'s fixtures broke correctly, named real
mutants, and still missed nine defects — because the set never exercised one input axis at
all. **Enumerate the contract's axes and verify both ends of each**, then ask which axis has
no fixture. That question is the acceptance criterion, not the count of assertions.

## A realistic fixture can inherit the producer's redundancy

When production writes the same fact twice, a fixture copied from production carries both
copies — so deleting the branch under test leaves the assertion green. Realism is not the
goal; **discrimination** is. Build the payload that distinguishes the branch, even if no real
producer emits exactly that shape.

## The pinned value is the mutant you killed

A fixture that is green today can still be the only thing fixing the contract — its literal is
what a mutation would have to change. Conversely a fixture that looks defective may kill
nothing. Judge a test by which mutant it rejects, never by whether it currently passes.

## An inert probe never routes

A payload that matches no registration produces no judgment, so a probe built to test the
judge can prove nothing while looking successful. Verify the probe reaches the registration
before trusting what it reports.

## `await expect(...).resolves` — never `not.toThrow` on async

An async call wrapped in `expect(fn).not.toThrow()` passes unconditionally; the rejection
escapes as an unhandled promise. The RED phase looks satisfied and the assertion is a no-op.

## The measurement shell is not the judged shell

This project's default shell is zsh, and the judge reasons about bash. A differential rig that
measures with the ambient shell measures the wrong grammar — pin the interpreter explicitly in
any test or probe that treats shell behavior as ground truth.
