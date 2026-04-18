---
name: to-issues
description: Turn root-level prd.md and plan.md into independently grabbable, self-contained GitHub issues using tracer-bullet vertical slices. Treat prd.md as primary and strongly consult plan.md for additional context. Use when user wants to convert a PRD into implementation issues that together deliver a feature, refactor, bug fix, or other enhancement.
---

# To Issues

Turn `prd.md` and `plan.md` at the repository root into a set of detailed, complete, self-contained GitHub issues.

Treat `prd.md` as the primary source of truth. Strongly consult `plan.md` as a complementary source to better contextualize the issue breakdown, then refine the breakdown using relevant conversation context and what you learn from the codebase.

This skill is intended to be used after the planning pipeline:

1. `grill-me` produces `plan.md`
2. `to-prd` turns `plan.md` into `prd.md`
3. `to-issues` uses `prd.md` as primary input and `plan.md` as complementary context to turn the plan into implementation issues

The final issue set should collectively represent the full enhancement described by the PRD, whether that enhancement is a feature, refactor, bug fix, migration, or other meaningful codebase change.

## Core requirements

- Use `prd.md` at the repository root as the primary source of truth.
- Read `prd.md` before proposing any breakdown.
- Strongly consult `plan.md` at the repository root as a complementary source of truth that adds planning intent, implementation rationale, and nuance that may not be fully captured in `prd.md`.
- If `prd.md` does not exist, stop and tell the user that this skill requires `prd.md` at the repository root.
- If `plan.md` exists, read it and use it to improve issue quality, sequencing, and context.
- Create issues that are self-contained. A person should be able to read a single issue and understand the relevant context, scope, requirements, constraints, blast radius, implementation expectations, and definition of done without also reading `prd.md` or `plan.md`.
- Prefer tracer-bullet vertical slices over horizontal layer-by-layer breakdowns.
- The full set of issues should cover the intended outcome in `prd.md`, while incorporating relevant nuance, sequencing, and implementation context from `plan.md` when available.
- Each issue should be detailed enough that an engineer can pick it up later with minimal additional context.
- Collectively, the issues should form a workable implementation sequence rather than an unordered pile of tasks.

## Process

### 1. Gather context

Read `prd.md` from the repository root.

If `plan.md` exists at the repository root, read it as well. Use it to recover planning context, tradeoffs, sequencing logic, and implementation detail that complements `prd.md`.

If important implementation details are still unclear, explore the codebase to ground the issue breakdown in the current reality of the repository.

If the user passes a GitHub issue number or URL as an argument, fetch it with `gh issue view <number> --comments` and use it as parent or umbrella context, but keep `prd.md` as the primary planning input and `plan.md` as a strongly encouraged complement when available.

### 2. Explore the codebase

Explore the codebase enough to understand:

- the current architecture
- the modules and systems likely affected
- the likely blast radius of the PRD
- existing patterns and conventions that the implementation should follow
- meaningful seams for vertical slicing

### 3. Draft vertical slices

Break the PRD into tracer-bullet issues, using `plan.md` to sharpen sequencing, rationale, and implementation context. Each issue should represent a thin but complete slice through the system, not a single horizontal implementation layer.

Slices may be `HITL` or `AFK`.

- `HITL`: requires human interaction, approval, design input, migration coordination, or another explicit checkpoint
- `AFK`: can be implemented and merged without human interaction

Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but complete path through all relevant layers
- A completed slice is demoable, testable, or otherwise verifiable on its own
- Prefer many thin slices over few thick ones
- Avoid slices such as "update backend" or "add UI" with no end-to-end behavior
- Avoid placeholder issues such as "investigate" unless they are true HITL slices tied to a concrete decision or review outcome
- If a foundational issue is required, it must still have a concrete outcome and clear definition of done
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices, if any, must complete first
- **PRD coverage**: which goals, user stories, or implementation decisions it covers
- **Why this is a vertical slice**: a short explanation of the end-to-end value delivered

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependencies correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?
- Does the full set of issues cover the intended outcome from `prd.md`, with the right nuance and implementation context carried over from `plan.md` when relevant?

Iterate until the user approves the breakdown.

### 5. Create the GitHub issues

For each approved slice, create a GitHub issue using `gh issue create`.

Do not create any issues until the user has approved the breakdown.

Create issues in dependency order so blockers are created first and can be referenced by number.

Each issue must be self-contained and complete. Do not assume the implementer has read `prd.md` or `plan.md`. Restate all relevant context from the PRD, plus any important complementary detail from `plan.md`, inside each issue.

Each issue should clearly communicate:

- what problem this slice solves
- why this slice exists in the overall sequence
- the expected scope and blast radius
- requirements and constraints
- implementation patterns or architectural guidelines to follow
- concrete implementation steps or workstreams
- testing expectations
- definition of done
- blockers and dependencies

Issue titles should be polished, specific, and descriptive enough that the sequence is understandable from the issue list alone.

Use the issue body template below.

<issue-template>
## Parent

#<parent-issue-number> (if a parent or umbrella issue exists, otherwise omit this section)

## Summary

A concise description of this slice and the end-to-end outcome it delivers.

## Context

A self-contained explanation of the relevant product, technical, and architectural context for this slice. Include enough background that the reader does not need to open `prd.md` or `plan.md` to understand the work.

## Scope

Describe exactly what this issue includes.

## Out of Scope

Describe what this issue explicitly does not include, especially if nearby work is deferred to other slices.

## Requirements

List the functional and non-functional requirements for this slice.

## Blast Radius

Describe the areas of the system likely to be affected, such as user flows, services, schemas, jobs, APIs, UI surfaces, tests, deployment steps, docs, observability, or operational workflows.

## Implementation Notes

Document the important implementation expectations for this slice. Include patterns, constraints, interfaces, migration expectations, sequencing concerns, and any project conventions that should guide the work.

## Suggested Steps

Provide a practical, high-level sequence of steps for implementing the slice. These should be actionable, but should not depend on brittle file-path-specific instructions.

## Testing and Verification

Describe how to verify the slice. Include expected tests, important edge cases, failure modes, and any manual verification that should happen.

## Definition of Done

- [ ] The slice delivers the intended end-to-end behavior
- [ ] The implementation follows the required architectural and codebase patterns
- [ ] Tests cover the expected external behavior and important edge cases
- [ ] Any required docs, instrumentation, or operational updates are included
- [ ] The slice is independently demoable, verifiable, or safely mergeable

## Blocked by

- Blocked by #<issue-number> (if any)

Or `None - can start immediately` if no blockers.

</issue-template>

Do NOT close or modify any parent issue unless the user explicitly asks for that.
