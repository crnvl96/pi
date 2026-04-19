---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

After each answer, identify the highest-leverage unresolved branch of the plan and continue there.

If a question can be answered by exploring the codebase, explore the codebase instead.

Do not stop once there is "enough to start." Stop only when there is enough clarity to execute safely and the important branches of the decision tree have been resolved.

Do not stop at high-level ideas. Push on requirements, constraints, trade-offs, sequencing, dependencies, risks, edge cases, failure modes, testing strategy, rollout, and what is explicitly out of scope. Keep grilling until the plan is internally consistent and the important branches of the decision tree have been resolved.

Once the grilling is complete, you must write a complete report to `/tmp/plan.md`.

`/tmp/plan.md` is required. Do not end the task without writing it.

The report must be self-contained and complete. A reader should be able to understand the plan without reading the chat transcript. Synthesize the final understanding reached during the grilling session, not a raw transcript.

If some decisions remain unresolved, record them explicitly as open questions together with why they remain open, what options are still on the table, and what downstream decisions they affect.

Be specific. Capture concrete decisions, rationale, and constraints. The document should be detailed enough that someone new to the project could pick it up later and understand what to build and why.

The report should be thorough and include all relevant information gathered during the grilling session, including:

- the problem being solved
- goals and desired outcomes
- background and context
- assumptions and constraints
- user flows or use cases
- detailed solution overview
- key implementation decisions and the reasoning behind them
- alternatives considered and why they were rejected
- risks, edge cases, and failure modes
- testing strategy and quality considerations
- rollout or sequencing considerations
- dependencies and integration points
- what is out of scope
- any remaining open questions, if they still exist

Prefer a clear structure such as:

# Plan

## Problem Statement

## Goals

## Background and Context

## Proposed Solution

## User Flows and Use Cases

## Implementation Decisions

## Alternatives Considered

## Risks and Edge Cases

## Testing Strategy

## Rollout and Sequencing

## Dependencies and Integration Points

## Out of Scope

## Open Questions

## Further Notes
