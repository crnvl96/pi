---
name: tdd
description: |
  Guide implementation work with Test-Driven Development: red, green, refactor.
  Use when the user asks to "implement a plan using tdd", requests "test driven development", asks for a TDD approach, or wants an implementation plan executed test-first.
compatibility: Requires a project with an executable test command or enough context to add one.
---

# TDD

Use a Test-Driven Development workflow for implementation plans: write a failing test first, make it pass with the smallest production change, then refactor while keeping tests green.

## Workflow

1. Clarify the behavior to implement and the expected observable outcome.
2. Identify the test framework, existing test style, and targeted test command before editing.
3. If implementing in an existing codebase, run the relevant existing tests first when practical to establish a baseline.
4. Convert the implementation plan into small TDD increments. Each increment should have:
   - Red: the specific failing test to add or update.
   - Green: the minimal production change needed to pass.
   - Refactor: cleanup allowed only after tests pass.
   - Verify: the exact test command to run.
5. Execute one increment at a time:
   - Write the test first.
   - Run it and confirm it fails for the expected reason.
   - Write the smallest production code needed to pass.
   - Run the targeted test until it passes.
   - Refactor only if it improves clarity or removes duplication.
   - Rerun the targeted test after refactoring.
6. After all increments pass, run the broader relevant test suite if practical.
7. Report what tests were added, what implementation changed, and which commands verified the work.

## Planning Output

When asked for a TDD implementation plan, use a numbered plan where each item includes:

```txt
1. [Behavior]
   Red: [test to write and expected failure]
   Green: [minimal implementation]
   Refactor: [cleanup, if any]
   Verify: [test command]
```

Keep increments small enough that each can be completed and verified independently.

## Test Design Rules

- Test behavior and public contracts, not private implementation details.
- Prefer focused, fast, deterministic tests.
- Follow the project's existing test patterns, naming, fixtures, and assertion style.
- Cover the main success path first, then important edge cases and regressions.
- Avoid excessive mocking; mock only slow, external, nondeterministic, or hard-to-control dependencies.
- Do not add production code without a failing test unless the change is mechanical or genuinely untestable.

## Guardrails

- If no test framework or test command exists, identify the smallest appropriate test setup and ask before adding substantial tooling.
- If a test cannot be made to fail for the expected reason, stop and diagnose before implementing.
- If existing tests fail before changes, report the baseline failure and avoid claiming your work caused or fixed it unless verified.
- Do not skip the refactor decision: explicitly decide whether cleanup is needed.
- Do not overbuild beyond the behavior covered by the current test.
