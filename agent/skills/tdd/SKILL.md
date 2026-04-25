---
name: tdd
description: Use when changing code. TDD is the preferred approach and should guide implementation steps whenever suitable.
---

# Test-Driven Development

## Philosophy

Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests should not.

Good tests are integration-style: they exercise real code paths through public interfaces and describe what the system does, not how it does it. See [tests.md](tests.md) for examples.

Mock only at system boundaries such as external APIs, time, randomness, and sometimes databases or filesystems. Do not mock internal collaborators you control. See [mocking.md](mocking.md) for details.

## Anti-pattern: horizontal slices

Do not write all tests first, then all implementation. That treats RED as "write all tests" and GREEN as "write all code."

Correct approach: vertical slices via tracer bullets. Write one test, make it pass, then repeat. Each test responds to what you learned from the previous cycle.

```
WRONG:
  RED:   test1, test2, test3
  GREEN: impl1, impl2, impl3

RIGHT:
  RED->GREEN: test1->impl1
  RED->GREEN: test2->impl2
  RED->GREEN: test3->impl3
```

## Workflow

### 1. Plan

Before writing code:

- Run the relevant existing tests to establish a baseline.
- Confirm the public interface and priority behaviors, unless already specified.
- Keep the public interface small enough that behavior tests are natural.
- List behaviors to test, not implementation steps.
- Get user approval on the plan, unless the scope is already approved.

Ask: "What should the public interface look like? Which behaviors are most important to test?"

You cannot test everything. Focus on critical paths and complex logic.

### 2. Red

Write one test for one observable behavior.

Run it and confirm it fails for the expected behavioral reason before implementing.

### 3. Green

Write the minimum code needed to pass the current test.

Run the smallest relevant verification after it passes.

### 4. Repeat

For each remaining behavior, repeat RED then GREEN. Do not anticipate future tests.

### 5. Refactor

Only refactor while GREEN. After all tests pass:

- Remove duplication.
- Improve names and structure.
- Deepen shallow modules when the new code reveals poor locality.
- Keep tests on public behavior, not implementation details.
- Run tests after each refactor step.

## Checklist per cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test fails for the expected reason
[ ] Code is minimal for this test
[ ] Smallest relevant verification passes
[ ] No speculative features added
```
