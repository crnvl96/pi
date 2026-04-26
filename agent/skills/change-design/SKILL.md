---
name: change-design
description: Default skill for code-change planning. Use at the start of any task that may lead to code changes, including features, fixes, debugging, refactors, tests, migrations, behavior changes, design discussions, implementation plans, or investigations. Guides scope definition, codebase exploration, user interview, success criteria, verification planning, tradeoff analysis, and durable project-memory updates.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

Main branches:

1. **Goal** - what problem are we solving?
2. **Scope** - what will change and what will not change?
3. **Verification** - how will we know the change worked?
4. **Memory** - does this resolve durable context worth documenting?

## Domain awareness

During codebase exploration, also look for existing documentation:

### File structure

A single context at the root of repository:

```
/
|-- CONTEXT.md
|-- docs/
|   `-- adr/
|       |-- 0001-event-sourced-orders.md
|       `-- 0002-postgres-for-write-model.md
`-- src/
```

Create files lazily - only when you have something to write. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y - which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' - do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible - which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up - capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

Don't couple `CONTEXT.md` to implementation details. Only include terms that are meaningful to domain experts.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** - the cost of changing your mind later is meaningful
2. **Surprising without context** - a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** - there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
