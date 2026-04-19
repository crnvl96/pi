---
name: to-prd
description: Turn `/tmp/plan.md` into a detailed PRD written to `/tmp/prd.md`. Use when user wants to create a PRD from the current context or from a completed planning session.
---

This skill takes the planning output in `/tmp/plan.md`, combines it with codebase understanding and relevant conversation context, and produces a complete PRD in `/tmp/prd.md`.

Treat `/tmp/plan.md` as the primary source of truth, then refine it using what you learn from the codebase.

Do NOT create a GitHub issue.

Do NOT interview the user unless critical information is missing, contradictory, or cannot be inferred from `/tmp/plan.md` or the codebase.

## Inputs and outputs

- Input: `/tmp/plan.md`
- Output: `/tmp/prd.md`

You must read `/tmp/plan.md` before writing the PRD.

If `/tmp/plan.md` does not exist, stop and tell the user that this skill requires `/tmp/plan.md`.

`/tmp/prd.md` must be self-contained. It must fully stand on its own and must not depend on the reader also having `/tmp/plan.md`. Do not write a PRD that says "see /tmp/plan.md" for essential context. Instead, absorb the relevant information from `/tmp/plan.md`, resolve it into a clear structure, and restate it clearly in `/tmp/prd.md`.

Do not merely paraphrase `/tmp/plan.md`. Tighten it into a polished product and implementation document.

## Process

1. Read `/tmp/plan.md`.

2. Explore the repo to understand the current state of the codebase, if needed, so the PRD reflects reality rather than only the plan.

3. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

4. If this module sketch exposes material ambiguities, contradictions, or unresolved choices not settled in `/tmp/plan.md`, ask only the minimum clarifying questions needed before writing the PRD.

5. Write `/tmp/prd.md` using the template below.

The PRD should synthesize the relevant contents of `/tmp/plan.md`, clarify the final intended solution, and present it as a polished product and implementation document. It should be complete enough that someone new to the project can understand the problem, the solution, the decisions, and the expected implementation shape without reading any other planning artifact.

If the plan and the actual codebase differ in important ways, reflect that explicitly in the PRD instead of silently copying outdated assumptions.

<prd-template>

# PRD

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all major aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built or modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions
- Constraints and assumptions that materially affect implementation

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (for example, similar types of tests in the codebase)
- Important edge cases and failure modes that testing should cover

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature, such as rollout considerations, dependencies, open questions that remain, or implementation sequencing constraints.

</prd-template>
