---
name: plan
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation inline as decisions crystallise.
disable-model-invocation: true
---

- Interview me relentlessly about every aspect of this plan until we reach a shared understanding.
- Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.
- Ask the questions one at a time, waiting for feedback on each question before continuing.
- If a question can be answered by exploring the codebase, explore the codebase instead.
- When shared understanding is reached don't implement anythig. Present it to the user, declare the grilling session has ended, and ask for the next steps.

## 1. Domain awareness

- During codebase exploration, also look for existing documentation:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

- Create files lazily — only when you have something to write.
- If no `CONTEXT.md` exists, create one when the first term is resolved.
- If no `docs/adr/` exists, create it when the first ADR is needed.

## 2. Challenge against the glossary

- When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately.
- "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

## 3. Sharpen fuzzy language

- When the user uses vague or overloaded terms, propose a precise canonical term.
- "You're saying 'account' — do you mean the Customer or the User? Those are different things."

## 4. Discuss concrete scenarios

- When domain relationships are being discussed, stress-test them with specific scenarios.
- Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

## 5. Cross-reference with code

- When the user states how something works, check whether the code agrees.
- If you find a contradiction, surface it.
- "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

## 6. Update CONTEXT.md inline

- When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen.
- Use the format in [context-format.md](./references/context-format.md).
- Don't couple `CONTEXT.md` to implementation details.
- Only include terms that are meaningful to domain experts.

## 7. Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. Hard to reverse. The cost of changing your mind later is meaningful
2. Surprising without context. A future reader will wonder "why did they do it this way?"
3. The result of a real trade-off. There were genuine alternatives and you picked one for specific reasons

- If any of the three is missing, skip the ADR. Use the format in [adr-format.md](./references/adr-format.md).
- If a decision is easy to reverse, skip it — you'll just reverse it.
- If it's not surprising, nobody will wonder why.
- If there was no real alternative, there's nothing to record beyond "we did the obvious thing."
