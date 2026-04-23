---
name: tdd
description: Guide a feature or bug fix through a red-green-refactor, test-first workflow. Use when the user explicitly asks for TDD, test-first development, or a red-green-refactor implementation.
---

# Test-Driven Development

## Philosophy

Core principle: tests should verify behavior through public interfaces, not implementation details. Code can change entirely; the tests should still hold.

Good tests are integration-style: they exercise real code paths through public APIs. They describe what the system does, not how it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they do not care about internal structure.

Bad tests are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means like querying a database directly instead of using the interface. Warning sign: your test breaks when you refactor, but behavior has not changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

See [references/tests.md](references/tests.md) for examples and [references/mocking.md](references/mocking.md) for mocking guidelines.

## Anti-Pattern: Horizontal Slices

Do not write all tests first, then all implementation. This is horizontal slicing - treating RED as "write all tests" and GREEN as "write all code."

This produces bad tests:

- Tests written in bulk test imagined behavior, not actual behavior
- You end up testing the shape of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

Correct approach: vertical slices via tracer bullets. One test -> one implementation -> repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED -> GREEN: test1 -> impl1
  RED -> GREEN: test2 -> impl2
  RED -> GREEN: test3 -> impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:

- [ ] Confirm with the user what interface changes are needed
- [ ] Confirm with the user which behaviors to test and prioritize
- [ ] Identify opportunities for [deep modules](references/deep-modules.md)
- [ ] Design interfaces for [testability](references/interface-design.md)
- [ ] List the behaviors to test, not implementation steps
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

You cannot test everything. Confirm with the user exactly which behaviors matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write one test that confirms one thing about the system:

```
RED:   Write test for first behavior -> test fails
GREEN: Write minimal code to pass -> test passes
```

This is your tracer bullet. It proves the path works end to end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test -> fails
GREEN: Minimal code to pass -> passes
```

Rules:

- One test at a time
- Only enough code to pass the current test
- Do not anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](references/refactoring.md):

- [ ] Extract duplication
- [ ] Deepen modules by moving complexity behind simple interfaces
- [ ] Apply SOLID principles where natural
- [ ] Consider what the new code reveals about existing code
- [ ] Run tests after each refactor step

Never refactor while RED. Get to GREEN first.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```
