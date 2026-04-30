---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants integration tests, or asks for test-first development.
---

## 1. Following the PRD

- The user will reference a PRD containing details about the implementation.
- Use the User Stories and the Slices as your main guidance throughout the implementation.
- Inspect the codebase as needed to confirm and enrich information.
- Loop over the slices, implementing exclusively one at a time, end-to-end.
- After successfully completing each checkbox mark it as concluded in the PRD.
- At the end of the loop, perform a final pass in the PRD file to ensure all slices and user stories are covered.

## 2. Philosophy

- Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.
- Good tests are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.
- A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists.
- Good tests survive refactors because they don't care about internal structure.
- Bad tests are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface).
- The warning sign: your test breaks when you refactor, but behavior hasn't changed.
- If you rename an internal function and tests fail, those tests were testing implementation, not behavior.
- See [tests.md](./references/tests.md) for examples
- See [mocking.md](./references/mocking.md) for mocking guidelines.

## 3. Avoid horizontal slices

- DO NOT write all tests first, then all implementation. This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."
- Correct approach: Vertical slices via tracer bullets. One test -> one implementation -> repeat.
- Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

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

## 4. Planning

- When exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect ADRs in the area you're touching.

Before writing any code:

- Confirm with user what interface changes are needed
- Confirm with user which behaviors to test (prioritize)
- Identify opportunities for [deep modules](./references/deep-modules.md)
- Design interfaces for [testability](./references/interface-design.md)
- List the behaviors to test (not implementation steps)
- Get user approval on the plan
- Ask: "What should the public interface look like? Which behaviors are most important to test?"
- You can't test everything. Confirm with the user exactly which behaviors matter most.
- Focus testing effort on critical paths and complex logic, not every possible edge case.

## 5. Tracer bullet

- Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior -> test fails
GREEN: Write minimal code to pass -> test passes
```

## 6. Incremental loop

For each remaining behavior:

```
RED:   Write next test -> fails
GREEN: Minimal code to pass -> passes
```

- Write one test at a time
- Write only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

Checklist Per Cycle:

- Test describes behavior, not implementation
- Test uses public interface only
- Test would survive internal refactor
- Code is minimal for this test
- No speculative features added

### 7. Refactor

- After all tests pass, look for [refactor candidates](./references/refactoring.md):
- Never refactor while RED. Get to GREEN first.
