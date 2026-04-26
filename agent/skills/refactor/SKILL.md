---
name: refactor
description: Use when the agreed scope includes structural refactoring, module boundaries, interfaces, seams, abstractions, dependencies, depth, locality, architecture changes, or when implementing, designing, or discussing refactor plans; These refactoring techniques should guide planning and implementation steps whenever suitable.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Architecture guidance

Use this vocabulary consistently when discussing structural changes:

- **Module** - anything with an interface and an implementation.
- **Interface** - everything a caller must know to use the module correctly: types, invariants, ordering, errors, configuration, and performance expectations. Not just the type signature.
- **Implementation** - the code inside a module.
- **Seam** - where an interface lives; a place behavior can be altered without editing in place.
- **Adapter** - a concrete thing satisfying an interface at a seam.
- **Depth** - leverage at the interface. A **deep** module puts a lot of behavior behind a small interface. A **shallow** module has an interface nearly as complex as its implementation.
- **Leverage** - what callers get from depth: more capability per fact they must learn.
- **Locality** - what maintainers get from depth: change, bugs, knowledge, and verification concentrated in one place.

When looking for refactor opportunities:

- Use the deletion test: imagine deleting the module. If complexity vanishes, it was probably a pass-through. If complexity reappears across many callers, it was earning its keep.
- Treat the interface as the test surface. If tests need to reach past the interface, the module is probably the wrong shape.
- Prefer deepening shallow clusters over adding more pass-through modules.
- Do not introduce a seam unless something actually varies across it. One adapter is usually hypothetical; two adapters make the seam real.
- Prefer testing behavior through the deepened module's interface. Delete obsolete implementation-detail tests only after equivalent behavior is covered and only within the agreed scope.
- If several interface shapes are plausible, sketch 2-3 alternatives and recommend one. Compare them by depth, locality, seam placement, and testability.

## Process

1. Summarize the problem and ask only missing questions.
2. Explore the repo to verify the current state and test coverage.
3. Present viable options and recommend one.
4. Define scope: what will change and what will not change.
5. Define testing and verification.
6. Produce a plan of tiny commits. Each commit must leave the codebase working and include a verification command or observable check.

If the user asked for a file but did not provide a path, write the plan to `docs/refactors/YYYY-MM-DD-slug.md`. Otherwise, output it inline.

## Refactor plan template

## Problem Statement

The problem that the developer is facing, from the developer's perspective.

## Solution

The solution to the problem, from the developer's perspective.

## Commits

A detailed implementation plan in plain English, broken into the tiniest commits possible. Each commit should leave the codebase in a working state and include its verification command or observable check.

## Decision Document

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test: external behavior, not implementation details
- Which modules will be tested
- Prior art for the tests, such as similar tests in the codebase

## Out of Scope

A description of the things that are out of scope for this refactor.

## Further Notes (optional)

Any further notes about the refactor.
