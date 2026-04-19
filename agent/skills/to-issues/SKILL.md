---
name: to-issues
description: Turn `/tmp/prd.md` and `/tmp/plan.md` into independently grabbable, self-contained implementation issues collected in `/tmp/issues.md` using tracer-bullet vertical slices. Treat both inputs as equal-priority sources of truth. Use when user wants to convert planning artifacts into implementation issues that together deliver a feature, refactor, bug fix, or other enhancement.
---

# To Issues

Turn `/tmp/prd.md` and `/tmp/plan.md` into a set of detailed, complete, self-contained implementation issues collected in `/tmp/issues.md`.

Treat `/tmp/prd.md` and `/tmp/plan.md` as equal-priority sources of truth. Reconcile them together, then refine the breakdown using relevant conversation context and what you learn from the codebase.

This skill is intended to be used after the planning pipeline:

1. `grill-me` produces `/tmp/plan.md`
2. `to-prd` turns `/tmp/plan.md` into `/tmp/prd.md`
3. `to-issues` uses both `/tmp/plan.md` and `/tmp/prd.md` to turn the plan into implementation issues written to `/tmp/issues.md`

The final issue set should collectively represent the full enhancement described by the planning artifacts, whether that enhancement is a feature, refactor, bug fix, migration, or other meaningful codebase change.

## Core requirements

- Use `/tmp/prd.md` and `/tmp/plan.md` as equal-priority sources of truth.
- Read both files before proposing any breakdown.
- If either `/tmp/prd.md` or `/tmp/plan.md` does not exist, stop and tell the user that this skill requires both files.
- If the two files differ in meaningful ways, reconcile the differences explicitly instead of silently favoring one over the other.
- Create issues that are self-contained. A person should be able to read a single issue and understand the relevant context, scope, requirements, constraints, blast radius, implementation expectations, and definition of done without also reading `/tmp/prd.md` or `/tmp/plan.md`.
- Prefer tracer-bullet vertical slices over horizontal layer-by-layer breakdowns.
- The full set of issues should cover the intended outcome in both planning artifacts.
- Each issue should be detailed enough that an engineer can pick it up later with minimal additional context.
- Collectively, the issues should form a workable implementation sequence rather than an unordered pile of tasks.
- Write all final issues to `/tmp/issues.md`.
- All issues must coexist in the same file, with a clear separator between issues.

## Process

### 1. Gather context

Read `/tmp/prd.md` and `/tmp/plan.md`.

If important implementation details are still unclear, explore the codebase to ground the issue breakdown in the current reality of the repository.

### 2. Explore the codebase

Explore the codebase enough to understand:

- the current architecture
- the modules and systems likely affected
- the likely blast radius of the planning artifacts
- existing patterns and conventions that the implementation should follow
- meaningful seams for vertical slicing

### 3. Draft vertical slices

Break the planning artifacts into tracer-bullet issues. Each issue should represent a thin but complete slice through the system, not a single horizontal implementation layer.

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

- **ID**: `ISSUE-01`, `ISSUE-02`, and so on
- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices, if any, must complete first
- **Planning coverage**: which goals, user stories, requirements, or implementation decisions from `/tmp/prd.md` and `/tmp/plan.md` it covers
- **Why this is a vertical slice**: a short explanation of the end-to-end value delivered

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependencies correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?
- Does the full set of issues cover the intended outcome from both planning artifacts, with the right nuance and implementation context carried over?

Iterate until the user approves the breakdown.

### 5. Write `/tmp/issues.md`

Do not write `/tmp/issues.md` until the user has approved the breakdown.

Once approved, write every issue into the single file `/tmp/issues.md`.

Each issue must be self-contained and complete. Do not assume the implementer has read `/tmp/prd.md` or `/tmp/plan.md`. Restate all relevant context from both inputs inside each issue.

Assign each issue a stable local ID such as `ISSUE-01`, `ISSUE-02`, and so on. Use those IDs in dependency references instead of GitHub issue numbers.

Issue titles should be polished, specific, and descriptive enough that the sequence is understandable from the issue list alone.

Use the file template below.

<issues-file-template>
# Issues

For each issue, use this exact separator line before the issue:

================================================================================

Then use this issue template:

## ISSUE-<nn>: <title>

Type: HITL | AFK
Blocked by: ISSUE-<nn>, ISSUE-<nn> | None - can start immediately

### Summary

A concise description of this slice and the end-to-end outcome it delivers.

### Context

A self-contained explanation of the relevant product, technical, and architectural context for this slice. Include enough background that the reader does not need to open `/tmp/prd.md` or `/tmp/plan.md` to understand the work.

### Scope

Describe exactly what this issue includes.

### Out of Scope

Describe what this issue explicitly does not include, especially if nearby work is deferred to other slices.

### Requirements

List the functional and non-functional requirements for this slice.

### Blast Radius

Describe the areas of the system likely to be affected, such as user flows, services, schemas, jobs, APIs, UI surfaces, tests, deployment steps, docs, observability, or operational workflows.

### Implementation Notes

Document the important implementation expectations for this slice. Include patterns, constraints, interfaces, migration expectations, sequencing concerns, and any project conventions that should guide the work.

### Suggested Steps

Provide a practical, high-level sequence of steps for implementing the slice. These should be actionable, but should not depend on brittle file-path-specific instructions.

### Testing and Verification

Describe how to verify the slice. Include expected tests, important edge cases, failure modes, and any manual verification that should happen.

### Definition of Done

- [ ] The slice delivers the intended end-to-end behavior
- [ ] The implementation follows the required architectural and codebase patterns
- [ ] Tests cover the expected external behavior and important edge cases
- [ ] Any required docs, instrumentation, or operational updates are included
- [ ] The slice is independently demoable, verifiable, or safely mergeable

</issues-file-template>
