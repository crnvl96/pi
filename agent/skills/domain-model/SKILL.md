---
name: domain-model
description: Grilling session that challenges a plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallize. Use when user wants to stress-test a plan against a project's language and documented decisions.
disable-model-invocation: true
---

# Domain Model

## General Guidelines

### 1. Interview Relentlessly

**One question at a time. Recommend an answer. Wait for feedback.**

- Interview the user about every aspect of the plan until you reach shared understanding.
- Walk down each branch of the design tree and resolve dependencies between decisions one by one.
- For each question, provide your recommended answer.
- Ask one question at a time, then wait for the user's feedback before continuing.
- If a question can be answered by exploring the codebase, explore the codebase instead.

### 2. Read The Existing Domain Model

**Use the project's language and decisions before challenging the plan.**

During codebase exploration, look for existing documentation:

- `CONTEXT-MAP.md` for multi-context repositories
- `CONTEXT.md` for a single context or for each context listed in `CONTEXT-MAP.md`
- ADRs in `docs/adr/`

A single-context repository usually looks like this:

```text
/
|-- CONTEXT.md
|-- docs/
|   `-- adr/
|       |-- 0001-event-sourced-orders.md
|       `-- 0002-postgres-for-write-model.md
`-- src/
```

Create files lazily. If no `CONTEXT.md` exists, create one when the first term is resolved. If no `docs/adr/` exists, create it when the first ADR is needed.

Use the reference formats only when writing documentation:

- [CONTEXT.md format](references/CONTEXT-FORMAT.md)
- [ADR format](references/ADR-FORMAT.md)

### 3. Challenge Language

**Make terminology precise and consistent.**

- When the user uses a term that conflicts with `CONTEXT.md`, call it out immediately. Example: "Your glossary defines 'cancellation' as X, but you seem to mean Y - which is it?"
- When the user uses vague or overloaded terms, propose a precise canonical term. Example: "You are saying 'account' - do you mean the Customer or the User? Those are different things."
- Do not couple `CONTEXT.md` to implementation details. Only include terms that are meaningful to domain experts.

### 4. Test With Scenarios And Code

**Use concrete cases and the codebase to expose hidden contradictions.**

- When domain relationships are being discussed, stress-test them with specific scenarios.
- Invent scenarios that probe edge cases and force precise boundaries between concepts.
- When the user states how something works, check whether the code agrees.
- If code contradicts the user, surface it. Example: "Your code cancels entire Orders, but you just said partial cancellation is possible - which is right?"

### 5. Update CONTEXT.md Inline

**Capture resolved language as it crystallizes.**

- When a term is resolved, update `CONTEXT.md` right there.
- Do not batch context updates.
- Use [CONTEXT.md format](references/CONTEXT-FORMAT.md).
- If multiple contexts exist, infer which context the topic belongs to. If unclear, ask.

### 6. Offer ADRs Sparingly

**Record only decisions that future readers will need.**

Only offer to create an ADR when all three are true:

1. **Hard to reverse** - the cost of changing the decision later is meaningful.
2. **Surprising without context** - a future reader will wonder why the project works this way.
3. **The result of a real trade-off** - there were genuine alternatives and one was chosen for specific reasons.

If any criterion is missing, skip the ADR. Use [ADR format](references/ADR-FORMAT.md).
